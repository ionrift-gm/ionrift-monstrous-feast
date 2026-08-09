import { Logger } from "../lib/Logger.js";

const MIN_LIBRARY_VERSION = "2.5.12";
let _warned = false;

function _api() {
    return game.ionrift?.library ?? null;
}

/** Guarded access to game.ionrift.library (version-pinned). */
export const Library = {
    MIN_VERSION: MIN_LIBRARY_VERSION,

    /** True when the library API namespace is exposed. */
    available() {
        return Boolean(_api());
    },

    /** True when an active library meets the pinned minimum version. */
    versionOk() {
        const mod = game.modules.get("ionrift-library");
        if (!mod?.active) return false;
        if (mod.version === MIN_LIBRARY_VERSION) return true;
        return foundry.utils.isNewerVersion(mod.version, MIN_LIBRARY_VERSION);
    },

    /** Warn once when the kernel is missing or below the pinned minimum. */
    warnOnce() {
        if (_warned) return;
        if (this.available() && this.versionOk()) return;
        _warned = true;
        const msg = `Monstrous Feast needs Ionrift Library ${MIN_LIBRARY_VERSION} or newer. Update Ionrift Library to enable monster classification and content.`;
        Logger.warn(msg);
        ui.notifications?.warn(msg);
    },

    /**
     * Creature classification, guarded. Returns null when unavailable.
     * @param {Actor} actor
     * @returns {object|null}
     */
    classify(actor) {
        const api = _api();
        if (!api?.classifyCreature) { this.warnOnce(); return null; }
        try {
            return api.classifyCreature(actor);
        } catch (e) {
            Logger.warn("Classification failed:", e);
            return null;
        }
    },

    /** System adapter registry (level, type, and item queries across systems). */
    get system() {
        return _api()?.system ?? null;
    },

    /** Shared cooking/feeding API, or null on older kernels. */
    get cooking() {
        return _api()?.cooking ?? null;
    },

    /** Overlay service used to read manually supplied content. */
    get overlay() {
        return _api()?.overlay ?? null;
    },

    /** Read a Library-owned world setting through its public API. */
    getWorldSetting(key, fallback = undefined) {
        const read = _api()?.getWorldSetting;
        if (typeof read !== "function") return fallback;
        try {
            return read(key, fallback);
        } catch {
            return fallback;
        }
    },

    /** Shared token reach checks (Arms Reach delegation + grid fallback). */
    get reach() {
        return _api()?.reach ?? null;
    }
};
