import { Logger } from "../lib/Logger.js";

const MODULE_ID = "ionrift-monstrous-feast";
const CHANNEL = `module.${MODULE_ID}`;

const ACTION_DISCOVER = "recordDiscovery";
const ACTION_INSCRIBE = "inscribeRecipe";
const ACTION_SERVING = "openFeastServing";

/** @type {((data: object) => void)|null} */
let _bound = null;

/** @type {Set<string>} */
const _seen = new Set();

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
     * @param {string} action
     * @param {object} payload
     */
    _emit(action, payload) {
        if (!game.socket) return;
        game.socket.emit(CHANNEL, { action, requestId: foundry.utils.randomID(), ...payload });
        Logger.log(`GMRelay: emitted ${action} for ${payload.bookUuid}.`);
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
    }
};
