import { Logger } from "../lib/Logger.js";

const MODULE_ID = "ionrift-monstrous-feast";
const CHANNEL = `module.${MODULE_ID}`;

const ACTION_DISCOVER = "recordDiscovery";
const ACTION_INSCRIBE = "inscribeRecipe";
const ACTION_SERVING = "openFeastServing";
const ACTION_APPLY_EFFECT = "applyMealEffect";
const ACTION_CLEAR_EFFECT = "clearMealEffect";
const ACTION_PERSIST_BUTCHER = "persistButcherState";

/** @type {((data: object) => void)|null} */
let _bound = null;

/** @type {Set<string>} */
const _seen = new Set();

/**
 * Decide where a cross-actor meal write should run. A player can only write to
 * actors they own; everything else is relayed to a connected GM. With no GM
 * online the write cannot resolve.
 * @param {{ isOwner?: boolean, hasActiveGM?: boolean }} ctx
 * @returns {"local"|"relay"|"blocked"}
 */
export function decideEffectRoute({ isOwner = false, hasActiveGM = false } = {}) {
    if (isOwner) return "local";
    if (hasActiveGM) return "relay";
    return "blocked";
}

/**
 * Routes privileged Monster Cooking book writes to a GM.
 *
 * A non-GM player can record a discovery or inscribe a recipe even when the
 * single party cookbook is carried by another actor they do not own. Foundry
 * blocks cross-owner document writes, so those writes are emitted over
 * game.socket and applied by the responsible GM. Mirrors the library's
 * RollRequestService socket shape.
 */
export const GMRelay = {
    init() {
        if (!game.socket) {
            Logger.warn("GMRelay.init: game.socket unavailable.");
            return;
        }
        if (_bound) game.socket.off(CHANNEL, _bound);
        _bound = (data) => GMRelay._onMessage(data);
        game.socket.on(CHANNEL, _bound);
    },

    /**
     * Only one GM should apply a relayed write. Pick the lowest-id active GM.
     * @returns {boolean}
     */
    isResponsibleGM() {
        if (!game.user.isGM) return false;
        const activeGMs = game.users
            .filter(u => u.isGM && u.active)
            .sort((a, b) => a.id.localeCompare(b.id));
        return activeGMs[0]?.id === game.user.id;
    },

    /**
     * Whether any GM is currently connected to apply relayed writes.
     * @returns {boolean}
     */
    hasActiveGM() {
        return (game.users?.filter(u => u.isGM && u.active).length ?? 0) > 0;
    },

    /**
     * Record a creature discovery on a book, routing through a GM if needed.
     * @param {Item} book
     * @param {string} typeId
     * @returns {Promise<void>}
     */
    async recordDiscovery(book, typeId) {
        if (!book || !typeId) return;
        if (book.isOwner) {
            await GMRelay._applyDiscovery(book, typeId);
            return;
        }
        GMRelay._emit(ACTION_DISCOVER, { bookUuid: book.uuid, typeId });
    },

    /**
     * Inscribe a recipe on a book, routing through a GM if needed.
     * @param {Item} book
     * @param {string} recipeId
     * @returns {Promise<void>}
     */
    async inscribeRecipe(book, recipeId) {
        if (!book || !recipeId) return;
        if (book.isOwner) {
            await GMRelay._applyInscribe(book, recipeId);
            return;
        }
        GMRelay._emit(ACTION_INSCRIBE, { bookUuid: book.uuid, recipeId });
    },

    /**
     * Apply this module's managed meal effect to an actor, routing through a GM
     * when the caller does not own that actor. Foundry blocks cross-owner
     * ActiveEffect writes, so a player serving the party emits the effect for
     * the responsible GM to apply.
     * @param {string} actorUuid
     * @param {object} effectData
     * @returns {Promise<void>}
     */
    async applyMealEffect(actorUuid, effectData) {
        if (!actorUuid || !effectData) return;
        GMRelay._emit(ACTION_APPLY_EFFECT, { actorUuid, effectData });
    },

    /**
     * Clear this module's managed meal effect from an actor, routing through a
     * GM when the caller does not own that actor. A player whose long rest
     * touches a party member they do not own cannot delete the effect directly,
     * so the removal is emitted for the responsible GM to apply.
     * @param {string} actorUuid
     * @returns {Promise<void>}
     */
    async clearMealEffect(actorUuid) {
        if (!actorUuid) return;
        GMRelay._emit(ACTION_CLEAR_EFFECT, { actorUuid });
    },

    /**
     * Persist butcher corpse marker state on the scene (GM-owned write).
     * @param {{ tokenId?: string|null, actorUuid?: string|null, actorName?: string|null, state?: string|null }} payload
     */
    persistButcherState(payload) {
        if (!payload?.tokenId && !payload?.actorUuid) return;
        GMRelay._emit(ACTION_PERSIST_BUTCHER, payload);
    },

    /**
     * @param {string} action
     * @param {object} payload
     */
    _emit(action, payload) {
        if (!game.socket) return;
        game.socket.emit(CHANNEL, { action, requestId: foundry.utils.randomID(), ...payload });
        Logger.log(`GMRelay: emitted ${action}.`);
    },

    /**
     * @param {object} data
     */
    async _onMessage(data) {
        if (!data?.action || !GMRelay.isResponsibleGM()) return;
        if (data.requestId) {
            if (_seen.has(data.requestId)) return;
            _seen.add(data.requestId);
            setTimeout(() => _seen.delete(data.requestId), 120_000);
        }

        if (data.action === ACTION_SERVING) {
            await GMRelay._applyServing(data);
            return;
        }

        if (data.action === ACTION_APPLY_EFFECT) {
            await GMRelay._applyMealEffect(data);
            return;
        }

        if (data.action === ACTION_CLEAR_EFFECT) {
            await GMRelay._clearMealEffect(data);
            return;
        }

        if (data.action === ACTION_PERSIST_BUTCHER) {
            await GMRelay._applyButcherState(data);
            return;
        }

        const book = data.bookUuid ? await fromUuid(data.bookUuid) : null;
        if (!book) {
            Logger.warn(`GMRelay: book not found for ${data.bookUuid}.`);
            return;
        }

        if (data.action === ACTION_DISCOVER) {
            await GMRelay._applyDiscovery(book, data.typeId);
        } else if (data.action === ACTION_INSCRIBE) {
            await GMRelay._applyInscribe(book, data.recipeId);
        } else if (data.action === ACTION_SERVING) {
            await GMRelay._applyServing(data);
        }
    },

    /**
     * @param {Item} book
     * @param {string} typeId
     */
    async _applyDiscovery(book, typeId) {
        if (!typeId) return;
        const set = new Set(book.getFlag(MODULE_ID, "discoveredTypes") ?? []);
        if (set.has(typeId)) return;
        set.add(typeId);
        await book.setFlag(MODULE_ID, "discoveredTypes", [...set]);
    },

    /**
     * @param {Item} book
     * @param {string} recipeId
     */
    async _applyInscribe(book, recipeId) {
        if (!recipeId) return;
        const set = new Set(book.getFlag(MODULE_ID, "inscribedRecipes") ?? []);
        if (set.has(recipeId)) return;
        set.add(recipeId);
        await book.setFlag(MODULE_ID, "inscribedRecipes", [...set]);
    },

    /**
     * GM-side handler: apply a relayed meal effect to the target actor.
     * @param {object} data
     */
    async _applyMealEffect(data) {
        const actor = data.actorUuid ? await fromUuid(data.actorUuid) : null;
        if (!actor) {
            Logger.warn(`GMRelay: actor not found for ${data.actorUuid}.`);
            return;
        }
        const { MealEffects } = await import("./MealEffects.js");
        await MealEffects._writeMealEffect(actor, data.effectData);
    },

    /**
     * GM-side handler: remove this module's meal effect from the target actor.
     * @param {object} data
     */
    async _clearMealEffect(data) {
        const actor = data.actorUuid ? await fromUuid(data.actorUuid) : null;
        if (!actor) {
            Logger.warn(`GMRelay: actor not found for ${data.actorUuid}.`);
            return;
        }
        const { MealEffects } = await import("./MealEffects.js");
        await MealEffects._clearMealEffects(actor);
    },

    /**
     * @param {object} data
     */
    async _applyServing(data) {
        const { RecipeRegistry } = await import("../data/RecipeRegistry.js");
        const { FeastServingApp } = await import("../apps/FeastServingApp.js");
        const recipe = RecipeRegistry.get(data.recipeId);
        if (!recipe || !data.tempFormula) return;
        FeastServingApp.open({
            recipe,
            ambitious: !!data.ambitious,
            tempFormula: data.tempFormula,
            cookName: data.cookName ?? ""
        });
    },

    /**
     * @param {object} data
     */
    async _applyButcherState(data) {
        const { setButcherState, resolveTokenFromRegistryEntry } = await import("./ButcherTokenState.js");
        const token = resolveTokenFromRegistryEntry(data.tokenId, data)
            ?? canvas?.tokens?.get?.(data.tokenId)
            ?? null;
        const target = {
            tokenId: data.tokenId ?? token?.document?.id ?? token?.id ?? null,
            actorName: data.actorName ?? token?.actor?.name ?? null
        };
        let actor = token?.actor ?? null;
        if (!actor && data.actorUuid) {
            try {
                const doc = await fromUuid(data.actorUuid);
                actor = doc?.actor ?? doc ?? null;
            } catch {
                actor = null;
            }
        }
        target.actor = actor;
        await setButcherState(token, data.state ?? null, target);
    }
};
