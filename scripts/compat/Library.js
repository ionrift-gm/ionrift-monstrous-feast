import { Logger } from "../lib/Logger.js";

const MIN_LIBRARY_VERSION = "2.5.2";
let _warned = false;

function _api() {
    return game.ionrift?.library ?? null;
}

/**
 * Kernel access adapter. Monstrous Feast hard-requires ionrift-library, so the
 * API is present at install. A hard dependency guarantees presence, not API
 * stability across versions, so every call routes through here with a runtime
 * guard that degrades to a clear notification instead of a stack trace.
 */
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

    /**
     * Surface a single, clear notification when the kernel is missing or older
     * than the pinned minimum. Called once on ready and again before any guarded
     * call that finds the API absent.
     */
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

    /** Overlay service used to deliver the premium depth pack. */
    get overlay() {
        return _api()?.overlay ?? null;
    }
};
