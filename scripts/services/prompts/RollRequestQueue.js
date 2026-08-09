import { PromptQueue } from "../PromptQueue.js";

/** Shared PromptQueue for library roll-requests (cook + serve). */
const _queue = new PromptQueue();

/** Sentinel resolved when a caller abandons its wait (e.g. a GM steps in). */
const ABANDONED = Symbol("rollRequestAbandoned");

/**
 * @param {AbortSignal} signal
 * @returns {Promise<typeof ABANDONED>}
 */
function whenAborted(signal) {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve(ABANDONED);
            return;
        }
        signal.addEventListener("abort", () => resolve(ABANDONED), { once: true });
    });
}

export const RollRequestQueue = {
    /**
     * Route a library roll-request through the shared queue. A request whose
     * key matches one already active or waiting is coalesced onto the same
     * promise rather than opening a second prompt.
     *
     * @param {object} opts Library rollRequest options (actorId, type, key, dc, ...).
     * @param {object} [meta]
     * @param {string|null} [meta.key] Dedup/coalesce key (cook/meal/target).
     * @param {AbortSignal|null} [meta.signal] Abandons the wait so the queue advances
     *        without cancelling the underlying flow (used when a GM steps in).
     * @returns {Promise<object|null>} The roll result, or null when abandoned.
     */
    request(opts, { key = null, signal = null } = {}) {
        const bridge = game.ionrift?.library?.rollRequest;
        if (!bridge?.request) {
            return Promise.reject(new Error("Roll-request bridge unavailable."));
        }

        return _queue.enqueue(key, () => {
            const rolled = bridge.request(opts);
            if (!signal) return rolled;
            return Promise.race([rolled, whenAborted(signal)]);
        }).then((result) => (result === ABANDONED ? null : result));
    },

    /** @returns {boolean} */
    get busy() {
        return _queue.busy;
    },

    /** @returns {number} */
    get pending() {
        return _queue.pending;
    }
};
