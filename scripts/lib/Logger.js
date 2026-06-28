const MODULE_LABEL = "Monstrous Feast";

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
        if (game.settings?.settings?.has("ionrift-monstrous-feast.debug") && game.settings.get("ionrift-monstrous-feast", "debug")) {
            console.log(`Ionrift ${MODULE_LABEL} |`, ...args);
        }
    },

    info(...args) {
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
