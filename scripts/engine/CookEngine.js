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
     * @param {Actor} actor
     * @param {string} recipeId
     * @param {object} [opts]
     * @param {Item} [opts.bookItem] When set, recipe must be inscribed on this book.
     * @returns {Promise<object|null>}
     */
    async cook(actor, recipeId, { bookItem = null } = {}) {
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

        if (bookItem) {
            if (!DiscoveryService.isRecipeInscribed(bookItem, recipeId)) {
                ui.notifications.warn("This recipe is not inscribed in your cookbook.");
                return null;
            }
        }

        const check = this.checkIngredients(actor, recipe);
        if (!check.ok) {
            ui.notifications.warn(`Missing ingredients: ${check.missing.join(", ")}`);
            return null;
        }

        const dcBreakdown = buildCookDcBreakdown(actor, recipe);
        const cookDc = dcBreakdown.total;

        const rollResult = await SystemBridge.rollSurvival(
            actor,
            cookDc,
            `Cooking ${recipe.name}`
        );

        let ambitious = rollResult.natural === 20
            || rollResult.total >= cookDc + 5;
        const success = rollResult.total >= cookDc;

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

        // A spice only earns its keep when it lifts a plain success to ambitious.
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
            content: buildMealSplash(recipe, actor.name, ambitious, dcBreakdown)
                + (effectLines.length
                    ? `<ul class="mf-meal-effects">${effectLines.map(line => `<li>${line}</li>`).join("")}</ul>`
                    : "")
        });

        Logger.log(`Cooked ${recipe.name} (${ambitious ? "ambitious" : "standard"}${seasonedWith ? `, seasoned with ${seasonedWith}` : ""}).`);

        if (tempFormula && !game.user.isGM) {
            FeastServingRelay.requestServing({
                recipeId: recipe.id,
                ambitious,
                tempFormula,
                cookName: actor.name
            });
        }

        return { success: true, recipe, ambitious, seasonedWith, effectLines, tempFormula, dcBreakdown };
    }
};
