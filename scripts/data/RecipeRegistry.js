import { Logger } from "../lib/Logger.js";

const RECIPES_PATH = "modules/ionrift-monstrous-feast/scripts/data/recipes-core.json";
const HOMEBREW_PATH = "modules/ionrift-monstrous-feast/data/homebrew/recipes.json";

export const RecipeRegistry = {
    /** @type {Map<string, object>} */
    _recipes: new Map(),
    _loaded: false,

    async load(force = false) {
        if (this._loaded && !force) return;
        this._recipes.clear();
        await this._loadJson(RECIPES_PATH, "recipe registry");
        await this._loadJson(HOMEBREW_PATH, "homebrew recipes", true);
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
            for (const recipe of data?.recipes ?? []) {
                if (recipe?.id) this._recipes.set(recipe.id, recipe);
            }
        } catch (e) {
            if (optional) return;
            Logger.warn(`Failed to load ${label}:`, e);
        }
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
