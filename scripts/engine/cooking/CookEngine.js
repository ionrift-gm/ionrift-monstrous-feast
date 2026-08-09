import { Logger } from "../../lib/Logger.js";
import { SystemBridge } from "../../compat/SystemBridge.js";
import { RecipeRegistry } from "../../data/catalogs/RecipeRegistry.js";
import { countIngredient, consumeIngredient, findAvailable } from "../../services/cooking/IngredientMatcher.js";
import { DiscoveryService } from "../../services/cookbook/DiscoveryService.js";
import { MealEffects } from "../../services/meals/MealEffects.js";
import { MealService } from "../../services/meals/MealService.js";
import { buildCookFailCard, buildMealSplash } from "../../ui/cooking/MealCards.js";
import { build as buildCookDcBreakdown } from "./CookDcBreakdown.js";
import { RollRequestQueue } from "../../services/prompts/RollRequestQueue.js";

export const CookEngine = {
    /**
     * @param {Actor} actor
     * @param {object} recipe
     * @returns {{ ok: boolean, missing: string[] }}
     */
    checkIngredients(actor, recipe) {
        const missing = [];
        for (const ing of recipe.ingredients ?? []) {
            const have = countIngredient(actor, ing);
            if (have < ing.quantity) {
                missing.push(`${ing.name} (${have}/${ing.quantity})`);
            }
        }
        return { ok: missing.length === 0, missing };
    },

    async _consumeIngredients(actor, ingredients) {
        for (const ing of ingredients ?? []) {
            await consumeIngredient(actor, ing, ing.quantity);
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

    /**
     * Prompt the chef (or GM fallback) for the Survival check. The request runs
     * through the shared roll-request queue so the cook only ever sees one
     * prompt at a time; a second request for the same cook and recipe is
     * coalesced onto the in-flight one instead of stacking a duplicate prompt.
     * @param {Actor} actor
     * @param {object} recipe
     * @param {{ total: number }} dcBreakdown
     * @param {object} [opts]
     * @param {AbortSignal} [opts.signal] Abandons the wait (queue advances) when
     *        a GM steps in or the session is cancelled.
     * @returns {Promise<{ total: number, natural: number, passed?: boolean|null }|null>}
     */
    async requestSurvivalRoll(actor, recipe, dcBreakdown, { signal = null } = {}) {
        const dc = dcBreakdown?.total ?? recipe.dc ?? 12;
        const flavor = `Cooking ${recipe.name}`;
        const skillKey = SystemBridge.survivalSkillKey();

        if (game.ionrift?.library?.rollRequest) {
            const key = `survival:${actor?.id ?? "?"}:${recipe?.id ?? "?"}`;
            try {
                const result = await RollRequestQueue.request({
                    actorId: actor.id,
                    type: "skill",
                    key: skillKey,
                    dc,
                    title: `${SystemBridge.survivalLabel()} Check`,
                    flavor,
                    offlinePolicy: "gm-fallback"
                }, { key, signal });

                if (!result) return null;
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
     * GM intervention: roll the cook's Survival check directly on the cook's
     * behalf instead of waiting on the connected player's prompt. The library
     * roll-request only auto-delegates to the GM when the cook is offline or a
     * timeout elapses, so this provides the online "GM rolls for the player"
     * path the rest of the ecosystem exposes as a GM-side affordance.
     * @param {Actor} actor
     * @param {object} recipe
     * @param {{ total: number }} dcBreakdown
     * @returns {Promise<{ total: number, natural: number }>}
     */
    async rollSurvivalForCook(actor, recipe, dcBreakdown) {
        const dc = dcBreakdown?.total ?? recipe.dc ?? 12;
        return SystemBridge.rollSurvival(actor, dc, `Cooking ${recipe.name} [GM roll]`);
    },

    /**
     * Apply a completed Survival roll to finish cooking.
     * @param {Actor} actor
     * @param {string} recipeId
     * @param {object} opts
     * @param {Item} [opts.bookItem]
     * @param {{ total: number, natural: number }} opts.rollResult
     * @param {object} [opts.dcBreakdown]
     * @param {boolean} [opts.serve] When true, a successful cook serves the party
     *        immediately. The Living Cookbook session sets this false so serving
     *        waits on an explicit player action from the success screen.
     * @returns {Promise<object|null>}
     */
    async resolveCook(actor, recipeId, { bookItem = null, rollResult, dcBreakdown = null, serve = true } = {}) {
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
        const seasoning = this.findSeasoning(actor, recipe);
        if (seasoning) {
            await consumeIngredient(actor, seasoning, recipe.seasoning.quantity ?? 1);
            ambitious = true;
            seasonedWith = seasoning;
        }

        const tempFormula = MealEffects.getTempFormula(recipe.partyEffect, ambitious);

        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: buildMealSplash(recipe, actor.name, ambitious, breakdown)
        });

        Logger.log(`Cooked ${recipe.name} (${ambitious ? "ambitious" : "standard"}${seasonedWith ? `, seasoned with ${seasonedWith}` : ""}).`);

        // A finished Monstrous Feast meal is eaten on the spot. The programmatic
        // entry point serves the whole party now; the Living Cookbook session
        // passes serve:false and serves on an explicit player action from the
        // success screen. The dish is never stored as an inventory item.
        if (serve) {
            await MealService.serveParty(actor, recipe, ambitious);
        }

        return {
            success: true,
            recipe,
            ambitious,
            seasonedWith,
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
        return this.resolveCook(actor, recipeId, { bookItem, rollResult, dcBreakdown });
    }
};
