import { MealEffects } from "./MealEffects.js";
import { buildYieldItemData } from "./ItemFactory.js";
import { FeastServingApp } from "../apps/FeastServingApp.js";
import { FeastServingRelay } from "./FeastServingRelay.js";
import { Logger } from "../lib/Logger.js";

const MODULE_ID = "ionrift-monstrous-feast";

/**
 * Owns the life of a cooked dish: building the carriable item, and serving it to
 * the party (applying the meal's effects and rolling temp HP). A dish is created
 * with no effect; serving or eating it is what feeds the party.
 */
export const MealService = {
    /**
     * Build the createEmbeddedDocuments payload for a finished dish.
     * @param {object} recipe
     * @param {boolean} ambitious
     * @returns {object}
     */
    buildMealItem(recipe, ambitious) {
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
                ...base.flags,
                [MODULE_ID]: {
                    ...(base.flags?.[MODULE_ID] ?? {}),
                    monsterDish: true,
                    partyMeal: true,
                    recipeId: recipe.id,
                    ambitious: Boolean(ambitious)
                }
            }
        };
    },

    /**
     * Add a finished dish to an actor's inventory without feeding anyone.
     * @param {Actor} actor
     * @param {object} recipe
     * @param {boolean} ambitious
     * @returns {Promise<Item|null>}
     */
    async addDishToInventory(actor, recipe, ambitious) {
        if (!actor || !recipe) return null;
        const [created] = await actor.createEmbeddedDocuments("Item", [this.buildMealItem(recipe, ambitious)]);
        return created ?? null;
    },

    /**
     * Serve a dish to the party: apply the meal's shared effects, roll temp HP
     * per member, and consume the source dish if one was eaten from inventory.
     * @param {Actor} actor
     * @param {object} recipe
     * @param {boolean} ambitious
     * @param {object} [opts]
     * @param {Item|null} [opts.sourceItem] Inventory dish to consume one of.
     * @returns {Promise<{ effectLines: string[], tempFormula: string }>}
     */
    async serveParty(actor, recipe, ambitious, { sourceItem = null } = {}) {
        const effectLines = await MealEffects.applyPartyEffect(recipe.partyEffect, ambitious, {
            mealName: recipe.name
        });
        const tempFormula = MealEffects.getTempFormula(recipe.partyEffect, ambitious);

        const lines = effectLines.length
            ? `<ul class="mf-meal-effects">${effectLines.map(line => `<li>${line}</li>`).join("")}</ul>`
            : "";
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="mf-meal-served"><strong>${recipe.name}</strong> is served to the party.</div>${lines}`
        });

        if (tempFormula) {
            if (game.user.isGM) {
                FeastServingApp.open({
                    recipe,
                    ambitious,
                    tempFormula,
                    cookName: actor?.name ?? ""
                });
            } else {
                FeastServingRelay.requestServing({
                    recipeId: recipe.id,
                    ambitious,
                    tempFormula,
                    cookName: actor?.name ?? ""
                });
            }
        }

        if (sourceItem) {
            const qty = Number(sourceItem.system?.quantity ?? 1);
            if (qty > 1) await sourceItem.update({ "system.quantity": qty - 1 });
            else await sourceItem.delete();
        }

        Logger.log(`Served ${recipe.name} to the party${ambitious ? " (ambitious)" : ""}.`);
        return { effectLines, tempFormula };
    }
};
