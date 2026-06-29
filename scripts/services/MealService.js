import { MealEffects } from "./MealEffects.js";
import { Library } from "../compat/Library.js";
import { translatePartyEffect, buildServeReportLines, SHARED_BUFF_SLOT } from "./MealBuffs.js";
import { FeastServingApp } from "../apps/FeastServingApp.js";
import { FeastServingRelay } from "./FeastServingRelay.js";
import { Logger } from "../lib/Logger.js";

const MODULE_ID = "ionrift-monstrous-feast";

/**
 * Serves a freshly cooked dish to the whole party. A Monstrous Feast meal is
 * eaten on the spot: it is never stored as an inventory item. Serving applies
 * the meal's shared buff into the single cooking slot and rolls temp HP per
 * party member. Players who want to stockpile food cook Respite meals instead.
 */
export const MealService = {
    /**
     * Build a transient in-memory meal descriptor for a finished dish. This is
     * not an inventory Item: it carries only what the cooking layer needs to
     * recognise the dish (the monsterDish flag and recipe) and to label the
     * serve. Nothing is created on an actor.
     * @param {object} recipe
     * @param {boolean} ambitious
     * @returns {object}
     */
    buildMealDescriptor(recipe, ambitious) {
        const output = ambitious ? (recipe.ambitiousOutput ?? recipe.output) : recipe.output;
        return {
            name: output?.name ?? recipe.name,
            img: output?.img,
            flags: {
                [MODULE_ID]: {
                    monsterDish: true,
                    recipeId: recipe.id,
                    ambitious: Boolean(ambitious)
                }
            }
        };
    },

    /**
     * Serve a freshly cooked dish to the party: apply the meal's shared buff and
     * roll temp HP per member. No inventory item exists, so nothing is consumed.
     * @param {Actor} actor
     * @param {object} recipe
     * @param {boolean} ambitious
     * @returns {Promise<{ effectLines: string[], tempFormula: string }>}
     */
    async serveParty(actor, recipe, ambitious) {
        if (MealEffects.serveNeedsAbsentGM()) {
            ui.notifications.warn("No game master is connected to serve the feast to the party. Ask a GM to join, then serve again.");
            return { effectLines: [], tempFormula: null };
        }

        const cooking = Library.cooking;
        const effectLines = cooking?.feed?.serveDish
            ? await this._servePersistentBuffs(actor, recipe, ambitious, cooking)
            : await MealEffects.applyPartyEffect(recipe.partyEffect, ambitious, { mealName: recipe.name });
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

        Logger.log(`Served ${recipe.name} to the party${ambitious ? " (ambitious)" : ""}.`);
        return { effectLines, tempFormula };
    },

    /**
     * Apply a meal's persistent buffs through the kernel feed pipeline. The dish
     * descriptor is recognised by this module's registered dish matcher, so the
     * shared cooking-buff slot is cleared and rewritten (no stacking). The
     * descriptor is transient, so nothing is consumed. Temp HP is handled
     * separately, per member, in serveParty.
     *
     * Meals with no persistent buff (temp HP only) do not touch the slot, so a
     * standing buff from an earlier meal is left in place.
     * @param {Actor} actor
     * @param {object} recipe
     * @param {boolean} ambitious
     * @param {object} cooking The game.ionrift.library.cooking namespace.
     * @returns {Promise<string[]>}
     */
    async _servePersistentBuffs(actor, recipe, ambitious, cooking) {
        const buffs = translatePartyEffect(recipe.partyEffect, ambitious);
        if (!buffs.length) return [];

        const members = MealEffects.getPartyMembers();
        const descriptor = this.buildMealDescriptor(recipe, ambitious);

        await cooking.feed.serveDish(descriptor, {
            cookActor: actor,
            recipients: members,
            slot: SHARED_BUFF_SLOT,
            title: recipe.name ? `Monstrous Feast: ${recipe.name}` : "Monstrous Feast",
            consume: false
        });

        return buildServeReportLines(members, recipe.partyEffect, ambitious);
    }
};
