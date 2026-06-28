import { GMRelay } from "./GMRelay.js";

const CHANNEL = "module.ionrift-monstrous-feast";
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
