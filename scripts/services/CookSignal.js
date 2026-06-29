import { Logger } from "../lib/Logger.js";

const MODULE_ID = "ionrift-monstrous-feast";

/** Hook fired when a cook resolves (success or failure) in the Living Cookbook. */
export const COOK_COMPLETED_HOOK = `${MODULE_ID}.cookCompleted`;

/**
 * Announce that a cook attempt resolved. A cook "completes" once ingredients are
 * spent and the roll lands, whether the dish succeeds or fails. Firing on both
 * matches the rest economy: committing to a cook spends the cooking activity.
 *
 * Two surfaces receive the signal: a global Foundry hook (for any listener) and
 * an optional per-session callback supplied by whoever opened the cookbook
 * (Respite passes one so a completed cook consumes that character's rest
 * activity). Merely opening and cancelling never reaches here, so cancelling
 * spends nothing.
 * @param {{ actor?: Actor|null, recipe?: object|null, success?: boolean, onCooked?: Function|null }} args
 */
export function emitCookCompleted({ actor = null, recipe = null, success = false, onCooked = null } = {}) {
    const detail = { actor, recipe, success: Boolean(success) };
    try {
        globalThis.Hooks?.callAll?.(COOK_COMPLETED_HOOK, detail);
    } catch (err) {
        Logger.warn("CookSignal: cookCompleted hook listener threw.", err);
    }
    if (typeof onCooked === "function") {
        try {
            onCooked(detail);
        } catch (err) {
            Logger.warn("CookSignal: onCooked callback threw.", err);
        }
    }
}
