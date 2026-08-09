import { Logger } from "../../lib/Logger.js";
import {
    HOMEBREW_LIMITS,
    normalizeImportPayload,
    sanitizeHomebrew,
    validateHomebrewStore
} from "../../data/catalogs/HomebrewValidator.js";
import { CreatureRegistry } from "../../data/catalogs/CreatureRegistry.js";
import { RecipeRegistry } from "../../data/catalogs/RecipeRegistry.js";
import { MODULE_ID } from "../../data/moduleId.js";

export const HOMEBREW_SETTING = "homebrewContent";

const EMPTY_STORE = Object.freeze({
    creatures: {},
    recipes: []
});

/** @type {string[]} Most recent validation messages for the GM console. */
let _lastMessages = [];

/**
 * World-scoped homebrew store for custom creatures and recipes.
 * Loads at homebrew precedence alongside the optional file drop-in folder.
 */
export const HomebrewStore = {
    SETTING_KEY: HOMEBREW_SETTING,
    LIMITS: HOMEBREW_LIMITS,

    registerSetting() {
        game.settings.register(MODULE_ID, HOMEBREW_SETTING, {
            name: "Homebrew Content",
            hint: "Custom Monstrous Feast creatures and recipes for this world.",
            scope: "world",
            config: false,
            type: Object,
            default: { creatures: {}, recipes: [] }
        });
    },

    /**
     * @returns {{ creatures: object, recipes: object[] }}
     */
    get() {
        try {
            const raw = game.settings.get(MODULE_ID, HOMEBREW_SETTING);
            return {
                creatures: isPlainObject(raw?.creatures) ? raw.creatures : {},
                recipes: Array.isArray(raw?.recipes) ? raw.recipes : []
            };
        } catch {
            return { creatures: {}, recipes: [] };
        }
    },

    /**
     * @returns {{ creatures: object, recipes: object[] }}
     */
    getSanitized() {
        return sanitizeHomebrew(this.get()).sanitized;
    },

    /**
     * @returns {{ creatureCount: number, recipeCount: number, messages: string[], hasContent: boolean }}
     */
    summary() {
        const store = this.get();
        return {
            creatureCount: Object.keys(store.creatures).length,
            recipeCount: store.recipes.length,
            messages: _lastMessages.slice(0, 8),
            messagesTruncated: _lastMessages.length > 8,
            hasContent: Object.keys(store.creatures).length > 0 || store.recipes.length > 0
        };
    },

    /**
     * @returns {string[]}
     */
    lastMessages() {
        return [..._lastMessages];
    },

    /**
     * @param {{ creatures?: object, recipes?: object[] }} data
     * @returns {Promise<{ saved: boolean, errors: string[], dropped: { creatures: number, recipes: number } }>}
     */
    async set(data) {
        const { sanitized, errors, dropped } = sanitizeHomebrew(data);
        await game.settings.set(MODULE_ID, HOMEBREW_SETTING, sanitized);
        _lastMessages = errors;
        return { saved: true, errors, dropped };
    },

    /**
     * @returns {Promise<void>}
     */
    async clear() {
        await game.settings.set(MODULE_ID, HOMEBREW_SETTING, foundry.utils.deepClone(EMPTY_STORE));
        _lastMessages = [];
    },

    /**
     * Apply world homebrew entries onto the registries.
     * @returns {{ creatureCount: number, recipeCount: number, errors: string[] }}
     */
    applyToRegistries() {
        const { sanitized, errors } = sanitizeHomebrew(this.get());
        const creatureCount = CreatureRegistry.applyWorldHomebrew(sanitized.creatures);
        const recipeCount = RecipeRegistry.applyWorldHomebrew(sanitized.recipes);
        if (errors.length) _lastMessages = errors;
        return { creatureCount, recipeCount, errors };
    },

    /**
     * @returns {object}
     */
    exportPayload() {
        const store = this.getSanitized();
        return {
            _meta: {
                format: "ionrift-monstrous-feast-homebrew",
                version: "1",
                exportedAt: new Date().toISOString()
            },
            creatures: store.creatures,
            recipes: store.recipes
        };
    },

    /**
     * Trigger a browser download of the current world homebrew.
     */
    exportJsonFile() {
        const payload = this.exportPayload();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "ionrift-monstrous-feast-homebrew.json";
        anchor.click();
        URL.revokeObjectURL(url);
    },

    /**
     * @param {unknown} parsed
     * @returns {{ ok: boolean, errors: string[], dropped: { creatures: number, recipes: number }, sanitized: { creatures: object, recipes: object[] }|null }}
     */
    validateImport(parsed) {
        const normalized = normalizeImportPayload(parsed);
        if (!normalized) {
            return {
                ok: false,
                errors: ["Unrecognised JSON shape. Expected { creatures, recipes }."],
                dropped: { creatures: 0, recipes: 0 },
                sanitized: null
            };
        }

        const result = validateHomebrewStore(normalized);
        const keptCreatures = Object.keys(result.sanitized.creatures).length;
        const keptRecipes = result.sanitized.recipes.length;
        if (!keptCreatures && !keptRecipes && result.errors.length) {
            return {
                ok: false,
                errors: result.errors,
                dropped: result.dropped,
                sanitized: null
            };
        }

        return {
            ok: true,
            errors: result.errors,
            dropped: result.dropped,
            sanitized: result.sanitized
        };
    },

    /**
     * @param {unknown} parsed
     * @returns {Promise<{ ok: boolean, errors: string[], dropped: { creatures: number, recipes: number } }>}
     */
    async importPayload(parsed) {
        const check = this.validateImport(parsed);
        if (!check.ok || !check.sanitized) {
            _lastMessages = check.errors;
            return { ok: false, errors: check.errors, dropped: check.dropped };
        }

        await game.settings.set(MODULE_ID, HOMEBREW_SETTING, check.sanitized);
        _lastMessages = check.errors;
        return { ok: true, errors: check.errors, dropped: check.dropped };
    },

    /**
     * Open a file picker and import JSON into the world store.
     * @returns {Promise<{ ok: boolean, errors: string[], dropped: { creatures: number, recipes: number } }|null>}
     */
    importJsonFile() {
        return new Promise((resolve) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".json,application/json";
            input.addEventListener("change", async () => {
                const file = input.files?.[0];
                if (!file) {
                    resolve(null);
                    return;
                }
                try {
                    const parsed = JSON.parse(await file.text());
                    resolve(await this.importPayload(parsed));
                } catch (err) {
                    Logger.warn("Homebrew import parse failed:", err);
                    _lastMessages = ["Could not parse JSON."];
                    resolve({ ok: false, errors: ["Could not parse JSON."], dropped: { creatures: 0, recipes: 0 } });
                }
            }, { once: true });
            input.click();
        });
    }
};

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
