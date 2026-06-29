const MODULE_ID = "ionrift-monstrous-feast";
const RESPITE_ID = "ionrift-respite";

/** World setting key controlling how Monstrous Feast integrates with Respite. */
export const RESPITE_INTEGRATION_SETTING = "respiteIntegration";

/**
 * Setting choices. `automatic` mirrors the historical passive detection (use
 * Respite when it is installed). `on` and `off` force the integration state
 * regardless of whether Respite is present.
 */
export const RESPITE_INTEGRATION_MODES = Object.freeze({
    automatic: "automatic",
    on: "on",
    off: "off"
});

/**
 * Single resolver for the effective Monstrous Feast / Respite integration state.
 *
 * Every integration decision on the Monstrous Feast side routes through
 * {@link RespiteIntegration.isActive} so one switch governs the behaviour:
 *   - `off`        -> standalone, even when Respite is installed;
 *   - `on`         -> integrated, even before Respite finishes loading;
 *   - `automatic`  -> integrated when Respite is active (the default, and the
 *                     exact behaviour the module had before the setting existed).
 */
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
