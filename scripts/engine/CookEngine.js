import { Logger } from "../lib/Logger.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { RecipeRegistry } from "../data/RecipeRegistry.js";
import { buildYieldItemData } from "../services/ItemFactory.js";
import { countIngredient, consumeIngredient } from "../services/IngredientMatcher.js";
import { DiscoveryService } from "../services/DiscoveryService.js";
import { MealEffects } from "../services/MealEffects.js";
import { buildCookFailCard, buildMealSplash } from "../ui/MealCards.js";

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

        const rollResult = await SystemBridge.rollSurvival(
            actor,
            recipe.dc,
            `Cooking ${recipe.name}`
        );

        const ambitious = rollResult.natural === 20
            || rollResult.total >= recipe.dc + 5;
        const success = rollResult.total >= recipe.dc;

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
        await actor.createEmbeddedDocuments("Item", [this._buildMealItem(recipe, ambitious)]);

        const effectLines = await MealEffects.applyPartyEffect(recipe.partyEffect, ambitious);

        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: buildMealSplash(recipe, actor.name, ambitious)
                + (effectLines.length
                    ? `<ul class="mf-meal-effects">${effectLines.map(line => `<li>${line}</li>`).join("")}</ul>`
                    : "")
        });

        Logger.log(`Cooked ${recipe.name} (${ambitious ? "ambitious" : "standard"}).`);
        return { success: true, recipe, ambitious, effectLines };
    }
};
