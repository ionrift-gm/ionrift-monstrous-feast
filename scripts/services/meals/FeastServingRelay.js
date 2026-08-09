import { MODULE_ID } from "../../data/moduleId.js";

const CHANNEL = `module.${MODULE_ID}`;
const ACTION_SERVING = "openFeastServing";

/**
 * Ask the responsible GM to open the feast serving panel when a player cooks.
 */
export const FeastServingRelay = {
    /**
     * @param {object} payload
     * @param {string} payload.recipeId
     * @param {boolean} [payload.ambitious]
     * @param {string} payload.tempFormula
     * @param {string} [payload.cookName]
     */
    requestServing(payload) {
        if (game.user.isGM) return;
        if (!game.socket) return;
        game.socket.emit(CHANNEL, {
            action: ACTION_SERVING,
            requestId: foundry.utils.randomID(),
            ...payload
        });
    }
};

/**
 * @param {{ recipeRegistry: object, feastServingApp: object }} dependencies
 * @returns {(data: object) => void}
 */
export function createServingRelayHandler({ recipeRegistry, feastServingApp }) {
    return (data) => {
        const recipe = recipeRegistry.get(data.recipeId);
        if (!recipe || !data.tempFormula) return;
        return feastServingApp.open({
            recipe,
            ambitious: !!data.ambitious,
            tempFormula: data.tempFormula,
            cookName: data.cookName ?? ""
        });
    };
}
