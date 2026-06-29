import { Logger } from "../lib/Logger.js";
import { Library } from "../compat/Library.js";
import { CreatureRegistry } from "../data/CreatureRegistry.js";
import { RecipeRegistry } from "../data/RecipeRegistry.js";
import { buffRegistry } from "../data/MealBuffHandlers.js";
import { ConsolePanelRegistry } from "../ui/ConsolePanelRegistry.js";

const MODULE_ID = "ionrift-monstrous-feast";
const OVERLAY_ROOT = `ionrift-data/overlays/${MODULE_ID}`;

/**
 * Sublayers always probed, even without the overlay API, so a manually placed
 * pack is found by a direct read. `core` is the canonical free slot; `premium`
 * is the Acolyte slot the depth pack lands in (see PACK_CLASSIFICATION_POLICY).
 */
const KNOWN_SUBLAYERS = ["core", "premium"];

/** Buff-handler plugins live here inside a sublayer. */
const HANDLER_SUBDIR = "plugins/meal-buffs/handlers";

/** Paths already rooted at an absolute location are left untouched. */
const ABSOLUTE_PATH_RE = /^(https?:|\/|modules\/|ionrift-data\/|icons\/|systems\/|assets\/)/;

/**
 * Overlay content resolver for Monstrous Feast.
 *
 * Probes `ionrift-data/overlays/ionrift-monstrous-feast/<sublayer>/`, reads any
 * creature and recipe JSON it finds, feeds them into the registries through the
 * Seam C registration API, resolves pack-relative art paths to the overlay root,
 * imports buff-handler `.mjs` plugins into the kernel buff-handler registry, and
 * mounts any GM console panel the overlay manifest declares (Seam B). Premium
 * presence is therefore the pack folder being present: no separate module.
 *
 * Modelled on Resonance's SoundPackLoader (see PACK_DELIVERY_MODEL.md): the
 * probe is optional, so a world with no overlay directory loads exactly the
 * bundled-only free experience with no error. Re-resolves on the
 * `ionrift.overlayContentChanged` hook so installing or removing an overlay
 * takes effect without a reload.
 */
export class OverlayContentLoader {
    /** @type {(() => void)|null} Re-render callback for open windows. */
    static _onChanged = null;

    /** @type {boolean} */
    static _hookRegistered = false;

    /** @type {Map<string, Set<string>>} overlayId -> console panel ids it mounted. */
    static _overlayPanels = new Map();

    /**
     * Entry point. Called on ready.
     * @param {{ onChanged?: () => void }} [opts]
     */
    static async loadAll({ onChanged = null } = {}) {
        if (onChanged) this._onChanged = onChanged;
        this._registerChangeHook();

        try {
            const sublayers = await this._discoverSublayers();
            let loadedAny = false;
            for (const sublayer of sublayers) {
                const loaded = await this._loadSublayer(sublayer);
                loadedAny = loadedAny || loaded;
            }
            if (loadedAny) this._notifyChanged();
        } catch (e) {
            Logger.warn("Overlay content load failed:", e);
        }
    }

    /**
     * Discover candidate sublayers. Unions the library overlay API listing with
     * a direct browse of the module overlay root, and always probes `core` so a
     * manually placed overlay is found even without the overlay API.
     * @returns {Promise<string[]>}
     * @private
     */
    static async _discoverSublayers() {
        const found = new Set(KNOWN_SUBLAYERS);
        const overlay = Library.overlay;

        if (overlay?.listInstalledSublayers) {
            try {
                for (const sublayer of await overlay.listInstalledSublayers(MODULE_ID)) {
                    if (sublayer) found.add(sublayer);
                }
            } catch (e) {
                Logger.log("Overlay listInstalledSublayers unavailable:", e?.message ?? e);
            }
        }

        for (const sublayer of await this._browseDirs(OVERLAY_ROOT)) {
            if (sublayer) found.add(sublayer);
        }

        return [...found];
    }

    /**
     * Load one sublayer's content. No-ops cleanly when the sublayer has no
     * files. Skips a sublayer only when world state explicitly deactivates its
     * overlay, so a manual sideload (no world-state entry) still loads.
     * @param {string} sublayer
     * @returns {Promise<boolean>} whether any content was registered
     * @private
     */
    static async _loadSublayer(sublayer) {
        const root = `${OVERLAY_ROOT}/${sublayer}`;
        const manifest = await this._readJson(sublayer, "overlay-manifest.json");
        const overlayId = manifest?.overlayId ?? `${MODULE_ID}-${sublayer}-overlay`;

        if (this._isDeactivated(overlayId)) {
            this._removeOverlay(overlayId);
            return false;
        }

        // Re-resolve cleanly: drop anything this overlay registered before.
        this._removeOverlay(overlayId);

        let registered = 0;
        registered += await this._loadCreatures(sublayer, root, overlayId);
        registered += await this._loadRecipes(sublayer, root, overlayId);
        registered += await this._loadBuffHandlers(sublayer, overlayId);
        registered += this._loadConsolePanel(manifest, overlayId);

        if (registered > 0) {
            Logger.info(`Overlay "${overlayId}" contributed ${registered} item(s) from ${sublayer}.`);
        }
        return registered > 0;
    }

    /**
     * @param {string} sublayer
     * @param {string} root
     * @param {string} overlayId
     * @returns {Promise<number>}
     * @private
     */
    static async _loadCreatures(sublayer, root, overlayId) {
        const data = await this._readJson(sublayer, "creatures.json");
        if (!data) return 0;
        const map = data.creatures && typeof data.creatures === "object"
            ? data.creatures
            : (() => { const c = { ...data }; delete c._meta; return c; })();

        let count = 0;
        for (const [id, raw] of Object.entries(map)) {
            if (!raw || typeof raw !== "object") continue;
            const entry = { id, ...raw };
            if (entry.art) entry.art = this._resolvePath(entry.art, root);
            if (entry.img) entry.img = this._resolvePath(entry.img, root);
            if (CreatureRegistry.register(entry, { source: "overlay", overlayId })) count++;
        }
        return count;
    }

    /**
     * @param {string} sublayer
     * @param {string} root
     * @param {string} overlayId
     * @returns {Promise<number>}
     * @private
     */
    static async _loadRecipes(sublayer, root, overlayId) {
        const data = await this._readJson(sublayer, "recipes.json");
        const recipes = Array.isArray(data?.recipes) ? data.recipes : [];
        if (!recipes.length) return 0;

        let count = 0;
        for (const recipe of recipes) {
            if (!recipe?.id) continue;
            const resolved = { ...recipe };
            if (resolved.output) resolved.output = this._resolveOutput(resolved.output, root);
            if (resolved.ambitiousOutput) resolved.ambitiousOutput = this._resolveOutput(resolved.ambitiousOutput, root);
            if (RecipeRegistry.register(resolved, { source: "overlay", overlayId })) count++;
        }
        return count;
    }

    /**
     * Import and register buff-handler `.mjs` plugins from the overlay.
     * @param {string} sublayer
     * @param {string} overlayId
     * @returns {Promise<number>}
     * @private
     */
    static async _loadBuffHandlers(sublayer, overlayId) {
        const names = await this._discoverHandlerNames(sublayer);
        if (!names.length) return 0;

        const registry = buffRegistry();
        let count = 0;
        for (const name of names) {
            const importPath = `/${OVERLAY_ROOT}/${sublayer}/${HANDLER_SUBDIR}/${name}.mjs`;
            try {
                const mod = await import(importPath);
                const handler = mod.default ?? mod.handler ?? mod;
                if (typeof handler?.id !== "string" || typeof handler?.label !== "string") {
                    Logger.warn(`Overlay buff handler "${name}" missing id/label. Skipped.`);
                    continue;
                }
                registry.register(handler, { overlayId, pluginId: name, source: "overlay" });
                count++;
                Logger.info(`Registered overlay buff handler "${handler.id}" from ${sublayer}.`);
            } catch (e) {
                Logger.warn(`Failed to import overlay buff handler "${importPath}".`, e);
            }
        }
        return count;
    }

    /**
     * Mount a GM console panel the overlay manifest declares (Seam B). The
     * panel rides on the overlay content: present when the pack is installed,
     * dropped when it is removed or deactivated. ConsolePanelRegistry validates
     * the shape, so a malformed declaration is ignored without throwing.
     * @param {object|null} manifest
     * @param {string} overlayId
     * @returns {number} 1 when a panel was registered, else 0
     * @private
     */
    static _loadConsolePanel(manifest, overlayId) {
        const panel = manifest?.consolePanel;
        if (!panel || typeof panel !== "object") return 0;
        if (!ConsolePanelRegistry.register(panel)) return 0;

        let ids = this._overlayPanels.get(overlayId);
        if (!ids) {
            ids = new Set();
            this._overlayPanels.set(overlayId, ids);
        }
        ids.add(panel.id);
        return 1;
    }

    /**
     * @param {string} sublayer
     * @returns {Promise<string[]>}
     * @private
     */
    static async _discoverHandlerNames(sublayer) {
        const overlay = Library.overlay;

        if (overlay?.readFileIndex) {
            try {
                const index = await overlay.readFileIndex(MODULE_ID, sublayer);
                if (Array.isArray(index)) {
                    const re = new RegExp(`^${HANDLER_SUBDIR}/([^/]+)\\.mjs$`);
                    const names = new Set();
                    for (const filePath of index) {
                        const match = re.exec(filePath);
                        if (match && !match[1].startsWith("_")) names.add(match[1]);
                    }
                    if (names.size) return [...names];
                }
            } catch (e) {
                Logger.log("Overlay readFileIndex unavailable:", e?.message ?? e);
            }
        }

        const files = await this._listFiles(sublayer, HANDLER_SUBDIR);
        return files
            .filter(name => name.endsWith(".mjs") && !name.startsWith("_"))
            .map(name => name.replace(/\.mjs$/, ""));
    }

    /** @private */
    static _registerChangeHook() {
        if (this._hookRegistered) return;
        this._hookRegistered = true;
        Hooks.on("ionrift.overlayContentChanged", async (payload) => {
            if (payload?.moduleId !== MODULE_ID) return;
            const { overlayId, sublayer, active } = payload;
            if (active === false) {
                if (overlayId) this._removeOverlay(overlayId);
                this._notifyChanged();
                return;
            }
            if (sublayer) {
                const loaded = await this._loadSublayer(sublayer);
                if (loaded) this._notifyChanged();
            }
        });
    }

    /**
     * Remove all content a given overlay contributed (registries + handlers).
     * @param {string} overlayId
     * @private
     */
    static _removeOverlay(overlayId) {
        CreatureRegistry.unregisterOverlay(overlayId);
        RecipeRegistry.unregisterOverlay(overlayId);
        buffRegistry().unregisterForOverlay?.(overlayId);

        const panelIds = this._overlayPanels.get(overlayId);
        if (panelIds) {
            for (const id of panelIds) ConsolePanelRegistry.unregister(id);
            this._overlayPanels.delete(overlayId);
        }
    }

    /** @private */
    static _notifyChanged() {
        try { this._onChanged?.(); } catch (e) { Logger.warn("Overlay change refresh failed:", e); }
    }

    /**
     * Whether world state explicitly marks this overlay inactive. A missing
     * entry (manual sideload) counts as active so the stub is demonstrable
     * without going through the cloud install flow.
     * @param {string} overlayId
     * @returns {boolean}
     * @private
     */
    static _isDeactivated(overlayId) {
        try {
            const map = game.settings?.get?.("ionrift-library", "overlayWorldState") ?? {};
            return map?.[overlayId]?.active === false;
        } catch {
            return false;
        }
    }

    /**
     * Read a JSON file from a sublayer. Prefers the library overlay API (handles
     * hosted CDN lookups), falling back to a direct fetch. Returns null when the
     * file is absent, never throws.
     * @param {string} sublayer
     * @param {string} relativePath
     * @returns {Promise<object|null>}
     * @private
     */
    static async _readJson(sublayer, relativePath) {
        const overlay = Library.overlay;
        if (overlay?.readOverlayFile) {
            try {
                const data = await overlay.readOverlayFile(MODULE_ID, sublayer, relativePath);
                if (data) return data;
            } catch (e) {
                Logger.log(`Overlay readOverlayFile failed for ${relativePath}:`, e?.message ?? e);
            }
        }
        try {
            const response = await fetch(`/${OVERLAY_ROOT}/${sublayer}/${relativePath}`);
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    /**
     * List file names under a sublayer subdirectory. Prefers the overlay API,
     * falling back to FilePicker.browse. Returns [] when unreadable.
     * @param {string} sublayer
     * @param {string} subDir
     * @returns {Promise<string[]>}
     * @private
     */
    static async _listFiles(sublayer, subDir) {
        const overlay = Library.overlay;
        if (overlay?.listOverlayDir) {
            try {
                const result = await overlay.listOverlayDir(MODULE_ID, sublayer, subDir);
                if (result?.files?.length) return result.files;
            } catch (e) {
                Logger.log("Overlay listOverlayDir unavailable:", e?.message ?? e);
            }
        }
        const FP = game.ionrift?.library?.platform?.FP ?? globalThis.FilePicker;
        if (!FP?.browse) return [];
        try {
            const result = await FP.browse("data", `${OVERLAY_ROOT}/${sublayer}/${subDir}`);
            return (result.files ?? []).map(f => f.split("/").pop());
        } catch {
            return [];
        }
    }

    /**
     * List subdirectory names at a path, [] when unreadable.
     * @param {string} root
     * @returns {Promise<string[]>}
     * @private
     */
    static async _browseDirs(root) {
        const FP = game.ionrift?.library?.platform?.FP ?? globalThis.FilePicker;
        if (!FP?.browse) return [];
        try {
            const result = await FP.browse("data", root);
            return (result.dirs ?? []).map(d => d.split("/").pop());
        } catch {
            return [];
        }
    }

    /**
     * @param {object} output
     * @param {string} root
     * @returns {object}
     * @private
     */
    static _resolveOutput(output, root) {
        const resolved = { ...output };
        if (resolved.img) resolved.img = this._resolvePath(resolved.img, root);
        if (resolved.art) resolved.art = this._resolvePath(resolved.art, root);
        return resolved;
    }

    /**
     * Resolve a pack-relative asset path against the overlay root. Absolute
     * paths (core icons, module paths, URLs) are returned unchanged.
     * @param {string} path
     * @param {string} root
     * @returns {string}
     * @private
     */
    static _resolvePath(path, root) {
        if (!path || typeof path !== "string") return path;
        if (ABSOLUTE_PATH_RE.test(path)) return path;
        return `${root}/${path}`;
    }
}
