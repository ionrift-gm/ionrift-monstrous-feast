import { Logger } from "../lib/Logger.js";

const REGISTRY_PATH = "modules/ionrift-monstrous-feast/scripts/data/creature-registry.json";
const HOMEBREW_PATH = "modules/ionrift-monstrous-feast/data/homebrew/creatures.json";

/**
 * Bundled creature-to-yield registry keyed by classifyCreature() ids.
 */
export const CreatureRegistry = {
    /** @type {Map<string, object>} */
    _entries: new Map(),
    _loaded: false,

    async load(force = false) {
        if (this._loaded && !force) return;
        this._entries.clear();
        await this._loadJson(REGISTRY_PATH, "bundled creature registry");
        await this._loadJson(HOMEBREW_PATH, "homebrew creatures", true);
        this._loaded = true;
        Logger.log(`Creature registry loaded (${this._entries.size} entries).`);
    },

    async reload() {
        this._loaded = false;
        await this.load(true);
        return this._entries.size;
    },

    /**
     * @param {string} path
     * @param {string} label
     * @param {boolean} [optional]
     */
    async _loadJson(path, label, optional = false) {
        try {
            const response = await fetch(path);
            if (!response.ok) {
                if (optional) return;
                throw new Error(`${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            const cleaned = { ...data };
            delete cleaned._meta;
            for (const [id, entry] of Object.entries(cleaned)) {
                this._entries.set(id, { id, ...entry });
            }
        } catch (e) {
            if (optional) return;
            Logger.warn(`Failed to load ${label}:`, e);
        }
    },

    hasEntries() {
        return this._entries.size > 0;
    },

    /**
     * @param {object} classification
     * @param {number} cr
     * @returns {object|null}
     */
    lookup(classification, cr = 0) {
        if (!classification?.id) return null;
        const id = classification.id;
        const entry = this._entries.get(id)
            ?? this._entries.get(id.split("_")[0])
            ?? null;
        if (!entry) return null;
        if (Number(cr) < Number(entry.minCR ?? 0)) return null;
        return entry;
    },

    /** @returns {object[]} */
    all() {
        return Array.from(this._entries.values()).sort((a, b) => {
            const tierOrder = { common: 0, uncommon: 1, rare: 2, legendary: 3 };
            return (tierOrder[a.tier] ?? 9) - (tierOrder[b.tier] ?? 9)
                || String(a.label).localeCompare(String(b.label));
        });
    },

    /**
     * @param {string} id
     * @returns {object|null}
     */
    get(id) {
        return this._entries.get(id) ?? null;
    }
};
