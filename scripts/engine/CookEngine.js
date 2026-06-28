import { Logger } from "../lib/Logger.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { RecipeRegistry } from "../data/RecipeRegistry.js";
import { buildYieldItemData } from "../services/ItemFactory.js";
import { countIngredient, consumeIngredient, findAvailable } from "../services/IngredientMatcher.js";
import { DiscoveryService } from "../services/DiscoveryService.js";
import { MealEffects } from "../services/MealEffects.js";
import { buildCookFailCard, buildMealSplash } from "../ui/MealCards.js";
import { build as buildCookDcBreakdown } from "./CookDcBreakdown.js";
import { FeastServingRelay } from "../services/FeastServingRelay.js";

const MODULE_ID = "ionrift-monstrous-feast";

export const CookEngine = {
    /**
     * @param {Actor} actor
     * @param {object} recipe
     * @returns {{ ok: boolean, missing: string[] }}
     */
    checkIngredients(actor, recipe) {
        const missing = [];
        for (const ing of recipe.ingredients ?? []) {
            const have = countIngredient(actor, ing.name);
            if (have < ing.quantity) {
                missing.push(`${ing.name} (${have}/${ing.quantity})`);
            }
        }
        return { ok: missing.length === 0, missing };
    },

    async _consumeIngredients(actor, ingredients) {
        for (const ing of ingredients ?? []) {
            await consumeIngredient(actor, ing.name, ing.quantity);
        }
    },

    /**
     * The optional seasoning the actor can spend on this recipe, if any.
     * A held spice promotes a standard success to the ambitious tier.
     * @param {Actor} actor
     * @param {object} recipe
     * @returns {string|null}
     */
    findSeasoning(actor, recipe) {
        const seasoning = recipe?.seasoning;
        if (!actor || !seasoning?.accepts?.length) return null;
        return findAvailable(actor, seasoning.accepts, seasoning.quantity ?? 1);
    },

    _buildMealItem(recipe, ambitious) {
        const output = ambitious ? (recipe.ambitiousOutput ?? recipe.output) : recipe.output;
        const base = buildYieldItemData(
            { name: output.name, type: "food", foodTag: "prepared", spoilsAfter: 1 },
            output.name,
            output.rarity ?? "common"
        );
        return {
            ...base,
            img: output.img,
            system: {
                ...base.system,
                description: { value: output.description ?? "" },
                rarity: output.rarity ?? "common"
            },
            flags: {
                [MODULE_ID]: {
                    ...(base.flags?.[MODULE_ID] ?? {}),
                    monsterDish: true,
                    partyMeal: true,
                    recipeId: recipe.id
                }
            }
        };
    },

    /**
     * Prompt the chef (or GM fallback) for the Survival check.
     * @param {Actor} actor
     * @param {object} recipe
     * @param {{ total: number }} dcBreakdown
     * @returns {Promise<{ total: number, natural: number, passed?: boolean|null }>}
     */
    async requestSurvivalRoll(actor, recipe, dcBreakdown) {
        const dc = dcBreakdown?.total ?? recipe.dc ?? 12;
        const flavor = `Cooking ${recipe.name}`;
        const skillKey = SystemBridge.survivalSkillKey();

        if (game.ionrift?.library?.rollRequest) {
            try {
                const result = await game.ionrift.library.rollRequest.request({
                    actorId: actor.id,
                    type: "skill",
                    key: skillKey,
                    dc,
                    title: `${SystemBridge.survivalLabel()} Check`,
                    flavor,
                    offlinePolicy: "gm-fallback"
                });
                return {
                    total: result.total,
                    natural: result.natD20 ?? result.total,
                    passed: result.passed
                };
            } catch (err) {
                Logger.warn("Survival roll request failed, falling back to local roll.", err?.message ?? err);
            }
        }

        return SystemBridge.rollSurvival(actor, dc, flavor);
    },

    /**
     * Apply a completed Survival roll to finish cooking.
     * @param {Actor} actor
     * @param {string} recipeId
     * @param {object} opts
     * @param {Item} [opts.bookItem]
     * @param {{ total: number, natural: number }} opts.rollResult
     * @param {object} [opts.dcBreakdown]
     * @returns {Promise<object|null>}
     */
    async resolveCook(actor, recipeId, { bookItem = null, rollResult, dcBreakdown = null } = {}) {
        const notice = SystemBridge.unsupportedNotice();
        if (notice) {
            ui.notifications.warn(notice);
            return null;
        }

        const recipe = RecipeRegistry.get(recipeId);
        if (!recipe) {
            ui.notifications.warn("Recipe not found.");
            return null;
        }

        if (bookItem && !DiscoveryService.isRecipeInscribed(bookItem, recipeId)) {
            ui.notifications.warn("This recipe is not inscribed in your cookbook.");
            return null;
        }

        const check = this.checkIngredients(actor, recipe);
        if (!check.ok) {
            ui.notifications.warn(`Missing ingredients: ${check.missing.join(", ")}`);
            return null;
        }

        const breakdown = dcBreakdown ?? buildCookDcBreakdown(actor, recipe);
        const cookDc = breakdown.total;
        const roll = rollResult ?? { total: 0, natural: 0 };

        let ambitious = roll.natural === 20 || roll.total >= cookDc + 5;
        const success = roll.total >= cookDc;

        if (!success) {
            await this._consumeIngredients(actor, recipe.ingredients);
            await ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker({ actor }),
                content: buildCookFailCard(recipe, actor.name, recipe.failNarrative)
            });
            return { success: false, recipe };
        }

        await this._consumeIngredients(actor, recipe.ingredients);

        let seasonedWith = null;
        if (!ambitious) {
            const seasoning = this.findSeasoning(actor, recipe);
            if (seasoning) {
                await consumeIngredient(actor, seasoning, recipe.seasoning.quantity ?? 1);
                ambitious = true;
                seasonedWith = seasoning;
            }
        }

        await actor.createEmbeddedDocuments("Item", [this._buildMealItem(recipe, ambitious)]);

        const effectLines = await MealEffects.applyPartyEffect(recipe.partyEffect, ambitious, { mealName: recipe.name });
        const tempFormula = MealEffects.getTempFormula(recipe.partyEffect, ambitious);

        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: buildMealSplash(recipe, actor.name, ambitious, breakdown)
                + (effectLines.length
                    ? `<ul class="mf-meal-effects">${effectLines.map(line => `<li>${line}</li>`).join("")}</ul>`
                    : "")
        });

        Logger.log(`Cooked ${recipe.name} (${ambitious ? "ambitious" : "standard"}${seasonedWith ? `, seasoned with ${seasonedWith}` : ""}).`);

        return {
            success: true,
            recipe,
            ambitious,
            seasonedWith,
            effectLines,
            tempFormula,
            dcBreakdown: breakdown
        };
    },

    /**
     * @param {Actor} actor
     * @param {string} recipeId
     * @param {object} [opts]
     * @param {Item} [opts.bookItem] When set, recipe must be inscribed on this book.
     * @returns {Promise<object|null>}
     */
    async cook(actor, recipeId, { bookItem = null } = {}) {
        const recipe = RecipeRegistry.get(recipeId);
        if (!recipe) {
            ui.notifications.warn("Recipe not found.");
            return null;
        }

        const dcBreakdown = buildCookDcBreakdown(actor, recipe);
        const rollResult = await this.requestSurvivalRoll(actor, recipe, dcBreakdown);
        const result = await this.resolveCook(actor, recipeId, { bookItem, rollResult, dcBreakdown });

        if (result?.success && result.tempFormula && !game.user.isGM) {
            FeastServingRelay.requestServing({
                recipeId: recipe.id,
                ambitious: result.ambitious,
                tempFormula: result.tempFormula,
                cookName: actor.name
            });
        }

        return result;
    }
};
