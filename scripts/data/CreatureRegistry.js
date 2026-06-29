import { Logger } from "../lib/Logger.js";

const REGISTRY_PATH = "modules/ionrift-monstrous-feast/scripts/data/creature-registry.json";
const HOMEBREW_PATH = "modules/ionrift-monstrous-feast/data/homebrew/creatures.json";

/**
 * Source precedence for registered entries. A higher number wins on id
 * collision, so overlay content layers over bundled defaults, and homebrew
 * still overrides both. An entry is only replaced by a source of equal or
 * higher precedence.
 */
const SOURCE_PRIORITY = { bundled: 0, overlay: 1, homebrew: 2 };

/**
 * Bundled creature-to-yield registry keyed by classifyCreature() ids.
 *
 * Beyond the bundled and homebrew JSON, external sources (the overlay resolver,
 * a premium tool) register entries through {@link CreatureRegistry.register}.
 * Precedence is bundled < overlay < homebrew. Externally registered entries are
 * indistinguishable from bundled ones to every consumer (registry viewer,
 * butcher lookup, cook path).
 */
export const CreatureRegistry = {
    /** @type {Map<string, object>} */
    _entries: new Map(),
    /** @type {Map<string, { source: string, overlayId: string|null, priority: number }>} */
    _sources: new Map(),
    _loaded: false,

    async load(force = false) {
        if (this._loaded && !force) return;
        this._entries.clear();
        this._sources.clear();
        await this._loadJson(REGISTRY_PATH, "bundled creature registry", { source: "bundled" });
        await this._loadJson(HOMEBREW_PATH, "homebrew creatures", { source: "homebrew", optional: true });
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
     * @param {{ source?: string, optional?: boolean }} [opts]
     */
    async _loadJson(path, label, { source = "bundled", optional = false } = {}) {
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
                this.register({ id, ...entry }, { source });
            }
        } catch (e) {
            if (optional) return;
            Logger.warn(`Failed to load ${label}:`, e);
        }
    },

    /**
     * Register a single creature entry from any source. Honors source
     * precedence: a lower-precedence source never overwrites a higher one.
     * @param {object} entry Creature entry; must carry an `id`.
     * @param {{ source?: string, overlayId?: string }} [meta]
     * @returns {boolean} Whether the entry was stored.
     */
    register(entry, { source = "overlay", overlayId = null } = {}) {
        const id = entry?.id;
        if (!id) return false;
        const priority = SOURCE_PRIORITY[source] ?? SOURCE_PRIORITY.overlay;
        const existing = this._sources.get(id);
        if (existing && priority < existing.priority) return false;
        this._entries.set(id, { ...entry, id });
        this._sources.set(id, { source, overlayId, priority });
        return true;
    },

    /**
     * Register many entries at once.
     * @param {object[]} entries
     * @param {{ source?: string, overlayId?: string }} [meta]
     * @returns {number} how many were stored
     */
    registerMany(entries, meta = {}) {
        let count = 0;
        for (const entry of entries ?? []) {
            if (this.register(entry, meta)) count++;
        }
        return count;
    },

    /**
     * Remove every entry that came from a given source (e.g. "overlay"). Used
     * to re-resolve overlay content without disturbing bundled or homebrew.
     * @param {string} source
     * @returns {number} how many were removed
     */
    unregisterSource(source) {
        let removed = 0;
        for (const [id, meta] of this._sources) {
            if (meta.source === source) {
                this._entries.delete(id);
                this._sources.delete(id);
                removed++;
            }
        }
        return removed;
    },

    /**
     * Remove every entry contributed by a given overlay id.
     * @param {string} overlayId
     * @returns {number} how many were removed
     */
    unregisterOverlay(overlayId) {
        let removed = 0;
        for (const [id, meta] of this._sources) {
            if (meta.overlayId === overlayId) {
                this._entries.delete(id);
                this._sources.delete(id);
                removed++;
            }
        }
        return removed;
    },

    /**
     * The source descriptor for an entry, or null when unknown.
     * @param {string} id
     * @returns {{ source: string, overlayId: string|null, priority: number }|null}
     */
    sourceOf(id) {
        return this._sources.get(id) ?? null;
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
