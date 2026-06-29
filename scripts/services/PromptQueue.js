/**
 * Single-active prompt queue.
 *
 * Serialises asynchronous prompt work so only one prompt runs at a time, and
 * coalesces duplicate requests that share a key onto the same promise. The
 * queue advances whenever the active entry settles (resolve or reject), so a
 * cancelled or failed prompt can never leave the queue stuck.
 *
 * Kept free of Foundry dependencies so the ordering, dedup, and advance-on
 * settle behaviour can be exercised in isolation.
 */
export class PromptQueue {
    /** @type {{ key: string|null, run: Function, resolve: Function, reject: Function }|null} */
    #active = null;

    /** @type {Array<{ key: string|null, run: Function, resolve: Function, reject: Function }>} */
    #waiting = [];

    /** @type {Map<string, Promise<*>>} */
    #byKey = new Map();

    /**
     * Queue a prompt. When a key is supplied and a matching request is already
     * active or waiting, the existing promise is returned instead of scheduling
     * a duplicate.
     * @param {string|null} key
     * @param {() => (Promise<*>|*)} run
     * @returns {Promise<*>}
     */
    enqueue(key, run) {
        if (key != null && this.#byKey.has(key)) {
            return this.#byKey.get(key);
        }

        const promise = new Promise((resolve, reject) => {
            this.#waiting.push({ key: key ?? null, run, resolve, reject });
        });

        if (key != null) this.#byKey.set(key, promise);
        this.#pump();
        return promise;
    }

    /** @returns {boolean} Whether a prompt is currently active. */
    get busy() {
        return this.#active != null;
    }

    /** @returns {number} Entries waiting behind the active prompt. */
    get pending() {
        return this.#waiting.length;
    }

    /** @returns {string|null} Key of the active prompt, if any. */
    get activeKey() {
        return this.#active?.key ?? null;
    }

    #pump() {
        if (this.#active) return;

        const next = this.#waiting.shift();
        if (!next) return;

        this.#active = next;
        Promise.resolve()
            .then(() => next.run())
            .then(
                (value) => this.#finish(next, value, null),
                (error) => this.#finish(next, undefined, error)
            );
    }

    #finish(entry, value, error) {
        if (entry.key != null) this.#byKey.delete(entry.key);
        if (this.#active === entry) this.#active = null;

        if (error) entry.reject(error);
        else entry.resolve(value);

        this.#pump();
    }
}
