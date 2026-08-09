import { MODULE_ID } from "../data/moduleId.js";

const RESPITE_ID = "ionrift-respite";

/** World setting key controlling how Monstrous Feast integrates with Respite. */
export const RESPITE_INTEGRATION_SETTING = "respiteIntegration";

/** Setting choices: automatic | on | off. */
export const RESPITE_INTEGRATION_MODES = Object.freeze({
    automatic: "automatic",
    on: "on",
    off: "off"
});

/** Resolves effective Respite integration from the world setting. */
export const RespiteIntegration = {
    SETTING_KEY: RESPITE_INTEGRATION_SETTING,
    MODES: RESPITE_INTEGRATION_MODES,

    /**
     * Read the configured mode, defaulting to automatic when the setting is not
     * registered yet (early init) or unreadable.
     * @returns {string}
     * @private
     */
    _mode() {
        try {
            return game.settings?.get?.(MODULE_ID, RESPITE_INTEGRATION_SETTING)
                || RESPITE_INTEGRATION_MODES.automatic;
        } catch {
            return RESPITE_INTEGRATION_MODES.automatic;
        }
    },

    /**
     * Whether Respite is physically installed and active.
     * @returns {boolean}
     */
    respitePresent() {
        return game.modules?.get?.(RESPITE_ID)?.active === true;
    },

    /**
     * Effective integration state after applying the setting.
     * @returns {boolean}
     */
    isActive() {
        const mode = this._mode();
        if (mode === RESPITE_INTEGRATION_MODES.on) return true;
        if (mode === RESPITE_INTEGRATION_MODES.off) return false;
        return this.respitePresent();
    }
};
