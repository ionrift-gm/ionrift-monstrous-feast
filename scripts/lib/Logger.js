import { MODULE_ID, MODULE_LABEL } from "../data/moduleId.js";

/**
 * Local Logger wrapper. Delegates to the ionrift-library Logger when present,
 * falls back to console with the standard Ionrift prefix.
 */
export const Logger = {
    _lib() {
        return game.ionrift?.library?.Logger;
    },

    log(...args) {
        const lib = this._lib();
        if (lib) return lib.log(MODULE_LABEL, ...args);
        if (game.settings?.settings?.has(`${MODULE_ID}.debug`) && game.settings.get(MODULE_ID, "debug")) {
            console.log(`Ionrift ${MODULE_LABEL} |`, ...args);
        }
    },

    _verbose() {
        try {
            const bag = game.settings?.settings;
            const libraryDebug = bag?.has("ionrift-library.debug") && game.settings.get("ionrift-library", "debug");
            const moduleDebug = bag?.has(`${MODULE_ID}.debug`) && game.settings.get(MODULE_ID, "debug");
            return !!(libraryDebug || moduleDebug);
        } catch {
            return false;
        }
    },

    info(...args) {
        if (!this._verbose()) return;
        const lib = this._lib();
        if (lib) return lib.info(MODULE_LABEL, ...args);
        console.log(`Ionrift ${MODULE_LABEL} |`, ...args);
    },

    warn(...args) {
        const lib = this._lib();
        if (lib) return lib.warn(MODULE_LABEL, ...args);
        console.warn(`Ionrift ${MODULE_LABEL} |`, ...args);
    },

    error(...args) {
        const lib = this._lib();
        if (lib) return lib.error(MODULE_LABEL, ...args);
        console.error(`Ionrift ${MODULE_LABEL} |`, ...args);
    }
};
