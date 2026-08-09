import { Logger } from "../lib/Logger.js";
import { MODULE_ID } from "../data/moduleId.js";

const CHANNEL = `module.${MODULE_ID}`;

export const GM_RELAY_ACTIONS = Object.freeze({
    discover: "recordDiscovery",
    inscribe: "inscribeRecipe",
    serving: "openFeastServing",
    applyEffect: "applyMealEffect",
    clearEffect: "clearMealEffect",
    persistButcher: "persistButcherState",
    grantYields: "grantButcherYields"
});

/** @type {((data: object) => void)|null} */
let _bound = null;

/** @type {Set<string>} */
const _seen = new Set();

/** @type {Map<string, (data: object) => unknown>} */
const _handlers = new Map();

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
 * Socket transport for privileged writes. Domain handlers are registered by
 * the composition root, keeping this service independent of implementations.
 */
export const GMRelay = {
    /**
     * @param {string} action
     * @param {(data: object) => unknown} handler
     * @returns {boolean}
     */
    registerHandler(action, handler) {
        if (!action || typeof handler !== "function") return false;
        _handlers.set(action, handler);
        return true;
    },

    /**
     * @param {Record<string, (data: object) => unknown>} handlers
     */
    registerHandlers(handlers = {}) {
        for (const [action, handler] of Object.entries(handlers)) {
            GMRelay.registerHandler(action, handler);
        }
    },

    clearHandlers() {
        _handlers.clear();
    },

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
            .filter(user => user.isGM && user.active)
            .sort((left, right) => left.id.localeCompare(right.id));
        return activeGMs[0]?.id === game.user.id;
    },

    /**
     * Whether any GM is currently connected to apply relayed writes.
     * @returns {boolean}
     */
    hasActiveGM() {
        return (game.users?.filter(user => user.isGM && user.active).length ?? 0) > 0;
    },

    /**
     * @param {Item} book
     * @param {string} typeId
     * @returns {Promise<void>}
     */
    async recordDiscovery(book, typeId) {
        if (!book || !typeId) return;
        if (book.isOwner) {
            await GMRelay._dispatch(GM_RELAY_ACTIONS.discover, { book, typeId });
            return;
        }
        GMRelay._emit(GM_RELAY_ACTIONS.discover, { bookUuid: book.uuid, typeId });
    },

    /**
     * @param {Item} book
     * @param {string} recipeId
     * @returns {Promise<void>}
     */
    async inscribeRecipe(book, recipeId) {
        if (!book || !recipeId) return;
        if (book.isOwner) {
            await GMRelay._dispatch(GM_RELAY_ACTIONS.inscribe, { book, recipeId });
            return;
        }
        GMRelay._emit(GM_RELAY_ACTIONS.inscribe, { bookUuid: book.uuid, recipeId });
    },

    /**
     * @param {string} actorUuid
     * @param {object} effectData
     */
    async applyMealEffect(actorUuid, effectData) {
        if (!actorUuid || !effectData) return;
        GMRelay._emit(GM_RELAY_ACTIONS.applyEffect, { actorUuid, effectData });
    },

    /**
     * @param {string} actorUuid
     */
    async clearMealEffect(actorUuid) {
        if (!actorUuid) return;
        GMRelay._emit(GM_RELAY_ACTIONS.clearEffect, { actorUuid });
    },

    /**
     * @param {{ tokenId?: string|null, actorUuid?: string|null }} payload
     */
    persistButcherState(payload) {
        if (!payload?.tokenId && !payload?.actorUuid) return;
        GMRelay._emit(GM_RELAY_ACTIONS.persistButcher, payload);
    },

    /**
     * @param {string} actorUuid
     * @param {object[]} yields
     * @param {string} creatureName
     * @param {string} tier
     */
    async grantButcherYields(actorUuid, yields, creatureName, tier) {
        if (!actorUuid || !yields?.length) return;
        const actor = await fromUuid(actorUuid);
        if (!actor) return;
        if (actor.isOwner) {
            await GMRelay._dispatch(GM_RELAY_ACTIONS.grantYields, {
                actor,
                yields,
                creatureName,
                tier
            });
            return;
        }
        GMRelay._emit(GM_RELAY_ACTIONS.grantYields, {
            actorUuid,
            yields,
            creatureName,
            tier
        });
    },

    /**
     * @param {string} action
     * @param {object} payload
     */
    _emit(action, payload) {
        if (!game.socket) return;
        game.socket.emit(CHANNEL, {
            action,
            requestId: foundry.utils.randomID(),
            ...payload
        });
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
        await GMRelay._dispatch(data.action, data);
    },

    /**
     * @param {string} action
     * @param {object} data
     */
    async _dispatch(action, data) {
        const handler = _handlers.get(action);
        if (!handler) {
            Logger.warn(`GMRelay: no handler registered for ${action}.`);
            return;
        }
        return handler(data);
    }
};
