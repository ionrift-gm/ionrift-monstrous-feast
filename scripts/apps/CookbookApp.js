import { SystemBridge } from "../compat/SystemBridge.js";
import { CreatureRegistry } from "../data/catalogs/CreatureRegistry.js";
import { RecipeRegistry } from "../data/catalogs/RecipeRegistry.js";
import { buildCodex } from "../data/cookbook/CodexModel.js";
import { CodexController } from "../ui/cookbook/CodexController.js";
import { DiscoveryService } from "../services/cookbook/DiscoveryService.js";
import { LivingCookbookApp } from "./LivingCookbookApp.js";
import { CompendiumService } from "../services/cookbook/CompendiumService.js";
import { bindTabs, bindFlyouts } from "../ui/TabBinder.js";
import { attachImageFallback } from "../ui/ImageFallback.js";
import { ConsolePanelRegistry } from "../ui/ConsolePanelRegistry.js";
import { Logger } from "../lib/Logger.js";
import { HomebrewStore } from "../services/content/HomebrewStore.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Fallback when a registry entry has no display label.
 * @param {string} id
 * @returns {string}
 */
function displayLabelForId(id) {
    return String(id ?? "")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, ch => ch.toUpperCase());
}

/**
 * Client-side filter for Manage → party cookbook progress lists.
 * @param {HTMLElement} root
 */
function bindProgressFilters(root) {
    for (const input of root.querySelectorAll("[data-progress-filter]")) {
        const block = input.closest(".mf-cookbook-progress-block");
        const list = block?.querySelector("[data-progress-list]");
        const empty = block?.querySelector("[data-progress-filter-empty]");
        if (!list) continue;

        const apply = () => {
            const query = input.value.trim().toLowerCase();
            let visible = 0;
            for (const row of list.children) {
                if (!(row instanceof HTMLElement)) continue;
                const label = row.querySelector("[data-progress-label]")?.textContent?.toLowerCase() ?? "";
                const match = !query || label.includes(query);
                row.hidden = !match;
                if (match) visible += 1;
            }
            if (empty) empty.hidden = visible > 0 || !query;
        };

        input.addEventListener("input", apply);
        apply();
    }
}

/**
 * @returns {object|null}
 */
function buildPartyBookSnapshot() {
    const book = DiscoveryService.findPartyCookbook();
    if (!book) return null;

    const actor = book.actor ?? book.parent ?? null;
    const inscribedRecipes = DiscoveryService.getInscribedRecipes(book)
        .map(id => ({
            id,
            name: RecipeRegistry.get(id)?.name ?? displayLabelForId(id)
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const discoveredCreatures = DiscoveryService.getDiscoveredTypes(book)
        .map(id => {
            const entry = CreatureRegistry.get(id);
            return { id, label: entry?.label ?? displayLabelForId(id) };
        })
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

    return {
        name: book.name,
        img: book.img,
        carrierName: actor?.name ?? "Unknown",
        inscribedRecipes,
        inscribedCount: inscribedRecipes.length,
        discoveredCreatures,
        discoveredCount: discoveredCreatures.length
    };
}

/**
 * GM console: registry browse, system status, and party cookbook tools.
 */
export class CookbookApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "monstrous-feast-cookbook",
        classes: ["ionrift-window", "monstrous-feast-cookbook"],
        position: { width: 920, height: 840 },
        window: {
            title: "Monstrous Feast",
            icon: "fas fa-drumstick-bite",
            resizable: true
        },
        actions: {
            openCookbook: CookbookApp.#onOpenCookbook,
            openCompendium: CookbookApp.#onOpenCompendium,
            removeInscribedRecipe: CookbookApp.#onRemoveInscribedRecipe,
            clearInscribedRecipes: CookbookApp.#onClearInscribedRecipes,
            removeDiscoveredType: CookbookApp.#onRemoveDiscoveredType,
            clearDiscoveredTypes: CookbookApp.#onClearDiscoveredTypes,
            resetCookbook: CookbookApp.#onResetCookbook,
            reloadRegistry: CookbookApp.#onReloadRegistry,
            exportHomebrew: CookbookApp.#onExportHomebrew,
            importHomebrew: CookbookApp.#onImportHomebrew,
            clearHomebrew: CookbookApp.#onClearHomebrew
        }
    };

    static PARTS = {
        body: { template: "modules/ionrift-monstrous-feast/templates/cookbook.hbs" }
    };

    async _prepareContext() {
        const supported = SystemBridge.isLaunchSupported();
        const partyBook = buildPartyBookSnapshot();
        const book = DiscoveryService.findPartyCookbook();
        const auditDiscovered = book ? new Set(DiscoveryService.getDiscoveredTypes(book)) : null;
        const auditInscribed = book ? new Set(DiscoveryService.getInscribedRecipes(book)) : null;
        return {
            supported,
            unsupportedNotice: SystemBridge.unsupportedNotice(),
            systemLabel: SystemBridge.launchLabel(),
            registryCount: CreatureRegistry.all().length,
            recipeCount: RecipeRegistry.all().length,
            ...buildCodex({ revealAll: true, auditDiscovered, auditInscribed }),
            hasActor: false,
            isGM: game.user.isGM,
            hasPartyBook: Boolean(partyBook),
            partyBook,
            starterPackReady: Boolean(CompendiumService.getStarterPack()),
            homebrewPath: "modules/ionrift-monstrous-feast/data/homebrew/",
            homebrewGuideUrl: "https://github.com/ionrift-gm/ionrift-library/wiki/15-Monstrous-Feast-Homebrew-JSON",
            homebrew: HomebrewStore.summary(),
            homebrewLimits: HomebrewStore.LIMITS,
            consolePanels: ConsolePanelRegistry.list().map(panel => ({
                id: panel.id,
                label: panel.label,
                icon: panel.icon ?? "fas fa-gem",
                content: panel.content ?? ""
            }))
        };
    }

    _onRender(context, options) {
        attachImageFallback(this.element);
        CodexController.attach(this.element);
        bindTabs(this.element);
        bindFlyouts(this.element);
        bindProgressFilters(this.element);

        for (const panel of ConsolePanelRegistry.list()) {
            if (typeof panel.onRender !== "function") continue;
            const panelEl = this.element.querySelector(`[data-mf-panel="${panel.id}"]`);
            if (panelEl) {
                try { panel.onRender(panelEl, this); }
                catch (e) { Logger.warn("Console panel render failed:", e); }
            }
        }
    }

    static #partyBookOrWarn() {
        const book = DiscoveryService.findPartyCookbook();
        if (!book) {
            ui.notifications.warn("No party member is carrying a Monster Cooking book yet.");
            return null;
        }
        return book;
    }

    static async #refreshBookViews(book, app) {
        LivingCookbookApp.refreshForBook(book);
        if (app?.rendered) await app.render(false);
    }

    static async #onOpenCookbook() {
        const book = DiscoveryService.findPartyCookbook();
        if (!book) {
            ui.notifications.warn("No party member is carrying a Monster Cooking book yet.");
            return;
        }
        const actor = book.actor ?? book.parent ?? null;
        LivingCookbookApp.open(book, actor);
    }

    static #onOpenCompendium() {
        if (!game.user.isGM) return;
        CompendiumService.openStarterCompendium();
    }

    static async #onRemoveInscribedRecipe(_event, target) {
        if (!game.user.isGM) return;
        const recipeId = target?.dataset?.recipeId;
        if (!recipeId) return;
        const book = CookbookApp.#partyBookOrWarn();
        if (!book) return;

        const recipe = RecipeRegistry.get(recipeId);
        const removed = await DiscoveryService.removeInscribedRecipe(book, recipeId);
        if (!removed) return;

        ui.notifications.info(`${recipe?.name ?? recipeId} removed from ${book.name}.`);
        await CookbookApp.#refreshBookViews(book, this);
    }

    static async #onClearInscribedRecipes() {
        if (!game.user.isGM) return;
        const book = CookbookApp.#partyBookOrWarn();
        if (!book) return;

        const confirmed = await Dialog.confirm({
            title: "Clear inscribed recipes",
            content: `<p>Remove every inscribed recipe from <strong>${book.name}</strong>? Known creatures stay.</p>`,
            yes: () => true,
            no: () => false,
            defaultYes: false
        });
        if (!confirmed) return;

        await DiscoveryService.clearInscribedRecipes(book);
        ui.notifications.info(`All recipes cleared from ${book.name}.`);
        await CookbookApp.#refreshBookViews(book, this);
    }

    static async #onRemoveDiscoveredType(_event, target) {
        if (!game.user.isGM) return;
        const typeId = target?.dataset?.typeId;
        if (!typeId) return;
        const book = CookbookApp.#partyBookOrWarn();
        if (!book) return;

        const entry = CreatureRegistry.get(typeId);
        const removed = await DiscoveryService.removeDiscoveredType(book, typeId);
        if (!removed) return;

        ui.notifications.info(`${entry?.label ?? displayLabelForId(typeId)} removed from ${book.name}.`);
        await CookbookApp.#refreshBookViews(book, this);
    }

    static async #onClearDiscoveredTypes() {
        if (!game.user.isGM) return;
        const book = CookbookApp.#partyBookOrWarn();
        if (!book) return;

        const confirmed = await Dialog.confirm({
            title: "Clear known creatures",
            content: `<p>Remove every known creature from <strong>${book.name}</strong>? Inscribed recipes stay.</p>`,
            yes: () => true,
            no: () => false,
            defaultYes: false
        });
        if (!confirmed) return;

        await DiscoveryService.clearDiscoveredTypes(book);
        ui.notifications.info(`Known creatures cleared on ${book.name}.`);
        await CookbookApp.#refreshBookViews(book, this);
    }

    static async #onResetCookbook() {
        if (!game.user.isGM) return;
        const book = CookbookApp.#partyBookOrWarn();
        if (!book) return;

        const confirmed = await Dialog.confirm({
            title: "Reset party cookbook",
            content: `<p>Clear all creature discoveries and inscribed recipes on <strong>${book.name}</strong>?</p>`,
            yes: () => true,
            no: () => false,
            defaultYes: false
        });
        if (!confirmed) return;

        await DiscoveryService.resetBookProgress(book);
        ui.notifications.info(`${book.name} progress reset.`);
        await CookbookApp.#refreshBookViews(book, this);
    }

    static async #onReloadRegistry() {
        if (!game.user.isGM) return;
        await game.ionrift.monstrousFeast.reloadRegistries();
        ui.notifications.info("Monstrous Feast registries reloaded.");
        await this.render(false);
    }

    static #onExportHomebrew() {
        if (!game.user.isGM) return;
        HomebrewStore.exportJsonFile();
        ui.notifications.info("Homebrew JSON exported.");
    }

    static async #onImportHomebrew() {
        if (!game.user.isGM) return;
        const summary = HomebrewStore.summary();
        if (summary.hasContent) {
            const confirmed = await Dialog.confirm({
                title: "Import homebrew JSON",
                content: `<p>This replaces the world's custom content (${summary.creatureCount} creatures, ${summary.recipeCount} recipes). Export first if you want a backup.</p>`,
                yes: () => true,
                no: () => false,
                defaultYes: false
            });
            if (!confirmed) return;
        }

        const result = await HomebrewStore.importJsonFile();
        await CookbookApp.#reportHomebrewResult(result);
        if (result?.ok) await this.render(false);
    }

    static async #onClearHomebrew() {
        if (!game.user.isGM) return;
        const summary = HomebrewStore.summary();
        if (!summary.hasContent) {
            ui.notifications.info("No world homebrew to clear.");
            return;
        }

        const confirmed = await Dialog.confirm({
            title: "Clear world homebrew",
            content: `<p>Remove all custom creatures and recipes stored in this world (${summary.creatureCount} creatures, ${summary.recipeCount} recipes)? File-based homebrew in the module folder is not affected.</p>`,
            yes: () => true,
            no: () => false,
            defaultYes: false
        });
        if (!confirmed) return;

        await HomebrewStore.clear();
        await game.ionrift.monstrousFeast.reloadRegistries();
        ui.notifications.info("World homebrew cleared.");
        await this.render(false);
    }

    /**
     * @param {{ ok: boolean, errors: string[], dropped?: { creatures: number, recipes: number } }|null} result
     */
    static async #reportHomebrewResult(result) {
        if (!result) return;

        if (!result.ok) {
            const preview = result.errors.slice(0, 2).join(" ");
            ui.notifications.error(preview || "Homebrew import failed.");
            if (result.errors.length > 2) {
                Logger.warn(`Homebrew import: ${result.errors.length} issues`, result.errors);
            }
            return;
        }

        await game.ionrift.monstrousFeast.reloadRegistries();
        const summary = HomebrewStore.summary();
        let message = `Homebrew loaded (${summary.creatureCount} creatures, ${summary.recipeCount} recipes).`;
        if (result.errors?.length) {
            message += ` ${result.errors.length} entries skipped. Check the GM console for details.`;
            Logger.warn("Homebrew import warnings:", result.errors);
        }
        ui.notifications.info(message);
    }
}
