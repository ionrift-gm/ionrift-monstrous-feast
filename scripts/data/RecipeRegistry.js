import { Logger } from "../lib/Logger.js";

const RECIPES_PATH = "modules/ionrift-monstrous-feast/scripts/data/recipes-core.json";
const HOMEBREW_PATH = "modules/ionrift-monstrous-feast/data/homebrew/recipes.json";

/**
 * Source precedence for registered recipes. Higher wins on id collision:
 * bundled < overlay < homebrew. A recipe is only replaced by an equal- or
 * higher-precedence source.
 */
const SOURCE_PRIORITY = { bundled: 0, overlay: 1, homebrew: 2 };

export const RecipeRegistry = {
    /** @type {Map<string, object>} */
    _recipes: new Map(),
    /** @type {Map<string, { source: string, overlayId: string|null, priority: number }>} */
    _sources: new Map(),
    _loaded: false,

    async load(force = false) {
        if (this._loaded && !force) return;
        this._recipes.clear();
        this._sources.clear();
        await this._loadJson(RECIPES_PATH, "recipe registry", { source: "bundled" });
        await this._loadJson(HOMEBREW_PATH, "homebrew recipes", { source: "homebrew", optional: true });
        this._loaded = true;
        Logger.log(`Recipe registry loaded (${this._recipes.size} recipes).`);
    },

    async reload() {
        this._loaded = false;
        await this.load(true);
        return this._recipes.size;
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
            for (const recipe of data?.recipes ?? []) {
                this.register(recipe, { source });
            }
        } catch (e) {
            if (optional) return;
            Logger.warn(`Failed to load ${label}:`, e);
        }
    },

    /**
     * Register a single recipe from any source. Honors source precedence: a
     * lower-precedence source never overwrites a higher one. Externally
     * registered recipes are cookable and inscribable through the normal path.
     * @param {object} recipe Recipe object; must carry an `id`.
     * @param {{ source?: string, overlayId?: string }} [meta]
     * @returns {boolean} Whether the recipe was stored.
     */
    register(recipe, { source = "overlay", overlayId = null } = {}) {
        const id = recipe?.id;
        if (!id) return false;
        const priority = SOURCE_PRIORITY[source] ?? SOURCE_PRIORITY.overlay;
        const existing = this._sources.get(id);
        if (existing && priority < existing.priority) return false;
        this._recipes.set(id, recipe);
        this._sources.set(id, { source, overlayId, priority });
        return true;
    },

    /**
     * Register many recipes at once.
     * @param {object[]} recipes
     * @param {{ source?: string, overlayId?: string }} [meta]
     * @returns {number} how many were stored
     */
    registerMany(recipes, meta = {}) {
        let count = 0;
        for (const recipe of recipes ?? []) {
            if (this.register(recipe, meta)) count++;
        }
        return count;
    },

    /**
     * Remove every recipe that came from a given source (e.g. "overlay").
     * @param {string} source
     * @returns {number} how many were removed
     */
    unregisterSource(source) {
        let removed = 0;
        for (const [id, meta] of this._sources) {
            if (meta.source === source) {
                this._recipes.delete(id);
                this._sources.delete(id);
                removed++;
            }
        }
        return removed;
    },

    /**
     * Remove every recipe contributed by a given overlay id.
     * @param {string} overlayId
     * @returns {number} how many were removed
     */
    unregisterOverlay(overlayId) {
        let removed = 0;
        for (const [id, meta] of this._sources) {
            if (meta.overlayId === overlayId) {
                this._recipes.delete(id);
                this._sources.delete(id);
                removed++;
            }
        }
        return removed;
    },

    /**
     * The source descriptor for a recipe, or null when unknown.
     * @param {string} id
     * @returns {{ source: string, overlayId: string|null, priority: number }|null}
     */
    sourceOf(id) {
        return this._sources.get(id) ?? null;
    },

    get(id) {
        return this._recipes.get(id) ?? null;
    },

    all() {
        return Array.from(this._recipes.values());
    },

    forCreature(creatureId) {
        return this.all().filter(recipe =>
            recipe.linkedCreatures?.includes(creatureId)
        );
    }
};
