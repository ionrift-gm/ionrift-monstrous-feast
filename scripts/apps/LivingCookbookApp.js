import { CookEngine } from "../engine/CookEngine.js";
import { RecipeRegistry } from "../data/RecipeRegistry.js";
import { DiscoveryService } from "../services/DiscoveryService.js";
import { inscribeRecipePage } from "../services/RecipePageService.js";
import { MealEffects } from "../services/MealEffects.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { buildCodex } from "../data/CodexModel.js";
import { CodexController } from "../ui/CodexController.js";
import { CookCeremonyApp } from "./CookCeremonyApp.js";
import { FeastServingApp } from "./FeastServingApp.js";
import { bindTabs, bindFlyouts } from "../ui/TabBinder.js";
import { build as buildCookDcBreakdown } from "../engine/CookDcBreakdown.js";
import { formatDcLine } from "../ui/DcBreakdown.js";

const MODULE_ID = "ionrift-monstrous-feast";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** @type {Map<string, LivingCookbookApp>} */
const OPEN_BY_BOOK = new Map();

/**
 * Player-facing Living Cookbook opened from the Monster Cooking item.
 */
export class LivingCookbookApp extends HandlebarsApplicationMixin(ApplicationV2) {
    /** @type {Item|null} */
    #bookItem = null;

    /** @type {Actor|null} */
    #actor = null;

    /** @type {string|null} */
    #focusTab = null;

    static DEFAULT_OPTIONS = {
        classes: ["ionrift-window", "monstrous-feast-living-cookbook"],
        position: { width: 900, height: 820 },
        window: {
            title: "Monster Cooking",
            icon: "fas fa-book-open",
            resizable: true
        },
        actions: {
            cookRecipe: LivingCookbookApp.#onCookRecipe,
            inscribePage: LivingCookbookApp.#onInscribePage
        }
    };

    static PARTS = {
        body: { template: "modules/ionrift-monstrous-feast/templates/living-cookbook.hbs" }
    };

    /**
     * @param {Item} bookItem
     * @param {Actor} actor
     * @param {object} [options]
     */
    constructor(bookItem, actor, options = {}) {
        super({
            ...options,
            id: `monstrous-feast-lc-${bookItem?.id ?? foundry.utils.randomID()}`
        });
        this.#syncRefs(bookItem, actor);
    }

    /**
     * @param {Item} bookItem
     * @param {Actor} actor
     */
    static open(bookItem, actor, { focusTab = null } = {}) {
        if (!bookItem) return null;
        if (!DiscoveryService.canUserOpenCookbook(bookItem)) {
            ui.notifications.warn("Only the book keeper or the GM can open the Monster Cooking book.");
            return null;
        }

        const key = bookItem.uuid ?? bookItem.id;
        const existing = OPEN_BY_BOOK.get(key);
        if (existing) {
            existing.#syncRefs(bookItem, actor);
            existing.render(false);
            existing.bringToTop?.();
            if (focusTab) existing.activateTab(focusTab);
            return existing;
        }

        const app = new LivingCookbookApp(bookItem, actor);
        app.#focusTab = focusTab;
        OPEN_BY_BOOK.set(key, app);
        app.render(true);
        return app;
    }

    /**
     * Re-render any open cookbook window for this book item (after inscribe, etc.).
     * @param {Item} bookItem
     */
    static refreshForBook(bookItem) {
        if (!bookItem) return;
        const key = bookItem.uuid ?? bookItem.id;
        const app = OPEN_BY_BOOK.get(key);
        if (!app?.rendered) return;
        app.#bookItem = bookItem;
        app.render(false);
    }

    #syncRefs(bookItem, actor) {
        this.#bookItem = bookItem?.uuid ? bookItem : game.items.get(bookItem?.id) ?? bookItem;
        this.#actor = actor?.uuid ? actor : game.actors.get(actor?.id) ?? actor;
    }

    _onClose(options) {
        const key = this.#bookItem?.uuid ?? this.#bookItem?.id;
        if (key) OPEN_BY_BOOK.delete(key);
        return super._onClose(options);
    }

    static #onCookRecipe(event, target) {
        return this.cookRecipe(event, target);
    }

    static #onInscribePage(event, target) {
        return this.inscribePage(event, target);
    }

    async inscribePage(_event, target) {
        const pageId = target?.dataset?.pageId;
        if (!pageId || !this.#actor) return;
        const pageItem = this.#actor.items.get(pageId);
        if (!pageItem) return;

        const recipeId = pageItem.getFlag(MODULE_ID, "recipeId");
        const inscribed = await inscribeRecipePage(pageItem, this.#actor);
        if (inscribed && recipeId) {
            const dupeIds = this.#actor.items
                .filter(item =>
                    item.getFlag?.(MODULE_ID, "isRecipePage") === true &&
                    item.getFlag(MODULE_ID, "recipeId") === recipeId)
                .map(item => item.id);
            if (dupeIds.length) await this.#actor.deleteEmbeddedDocuments("Item", dupeIds);
        }
        this.render(false);
    }

    async cookRecipe(_event, target) {
        const recipeId = target?.dataset?.recipeId;
        if (!recipeId || !this.#actor || !this.#bookItem) return;

        const recipe = RecipeRegistry.get(recipeId);
        if (!recipe) return;

        if (!DiscoveryService.isRecipeInscribed(this.#bookItem, recipeId)) {
            ui.notifications.warn("Inscribe this recipe page before cooking.");
            return;
        }

        const check = CookEngine.checkIngredients(this.#actor, recipe);
        if (!check.ok) {
            ui.notifications.warn(`Missing ingredients: ${check.missing.join(", ")}`);
            return;
        }

        const consumes = (recipe.ingredients ?? [])
            .map(i => `${i.quantity}x ${i.name}`)
            .join(", ");
        const buffs = this._buffLines(recipe).join(", ") || "party meal effect";

        const seasoning = CookEngine.findSeasoning(this.#actor, recipe);
        const seasoningLine = seasoning
            ? `<p class="mf-cook-confirm">Seasoned with <strong>${seasoning}</strong>: a plain success becomes the better meal.</p>`
            : "";

        let overwriteLine = "";
        if (MealEffects.producesManagedBuff(recipe.partyEffect)) {
            const affected = MealEffects.membersWithMealEffect();
            if (affected.length) {
                const names = affected.map(actor => actor.name).join(", ");
                overwriteLine = `<p class="mf-cook-warn"><i class="fas fa-triangle-exclamation"></i> This replaces the active meal buff on <strong>${names}</strong>. Only one Monstrous Feast meal effect holds at a time.</p>`;
            }
        }

        const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
        const dcBreakdown = buildCookDcBreakdown(this.#actor, recipe);
        const dcLine = formatDcLine(dcBreakdown, SystemBridge.survivalLabel?.() ?? "Survival");
        const confirmed = await confirmFn({
            title: `Cook ${recipe.name}?`,
            content: `<p class="mf-cook-confirm">Consumes: <strong>${consumes}</strong></p>${seasoningLine}<p class="mf-cook-confirm">Party gains: <strong>${buffs}</strong></p>${overwriteLine}${dcLine}`,
            yes: () => true,
            no: () => false,
            defaultYes: false
        });
        if (!confirmed) return;

        const result = await CookEngine.cook(this.#actor, recipeId, { bookItem: this.#bookItem });
        if (result?.success) {
            await CookCeremonyApp.play({
                recipe: result.recipe,
                ambitious: result.ambitious,
                cookName: this.#actor?.name ?? ""
            });
            if (result.tempFormula) {
                FeastServingApp.open({
                    recipe: result.recipe,
                    ambitious: result.ambitious,
                    tempFormula: result.tempFormula,
                    cookName: this.#actor?.name ?? ""
                });
            }
        }
        this.render(false);
    }

    _buffLines(recipe) {
        const fx = recipe.partyEffect ?? {};
        const lines = [];
        if (fx.tempHP) lines.push(`${fx.tempHP} temp HP`);
        if (fx.strengthAdvantage) lines.push("Strength advantage");
        if (fx.darkvisionFeet) lines.push(`Darkvision ${fx.darkvisionFeet} ft`);
        if (fx.perceptionAdvantageDim) lines.push("Keen senses in dim light");
        return lines;
    }

    async _prepareContext() {
        this.#bookItem = this.#bookItem?.uuid
            ? this.#bookItem
            : game.items.get(this.#bookItem?.id) ?? this.#bookItem;
        this.#actor = this.#actor?.uuid
            ? this.#actor
            : game.actors.get(this.#actor?.id) ?? this.#actor;

        const discovered = new Set(DiscoveryService.getDiscoveredTypes(this.#bookItem));
        const inscribed = new Set(DiscoveryService.getInscribedRecipes(this.#bookItem));
        const codex = buildCodex({
            discoveredCreatures: discovered,
            inscribedRecipes: inscribed,
            actor: this.#actor
        });

        return {
            bookName: this.#bookItem?.name ?? "Monster Cooking",
            bookImg: this.#bookItem?.img ?? null,
            actorName: this.#actor?.name ?? "Unknown",
            systemLabel: SystemBridge.launchLabel(),
            discoveredCount: codex.unlockedCount,
            inscribedCount: codex.inscribedCount,
            recipeTotal: codex.recipeTotal,
            totalCount: codex.totalCount,
            hasActor: codex.hasActor,
            cookableRecipes: codex.cookableRecipes,
            pendingPages: this.#pendingPages(inscribed),
            ...codex
        };
    }

    /**
     * Recipe pages the carrier holds that are not yet inscribed in this book.
     * @param {Set<string>} inscribed
     * @returns {object[]}
     */
    #pendingPages(inscribed) {
        const actor = this.#actor;
        if (!actor?.items) return [];

        const pages = [];
        const seen = new Set();
        for (const item of actor.items) {
            if (item.getFlag?.(MODULE_ID, "isRecipePage") !== true) continue;
            const recipeId = item.getFlag(MODULE_ID, "recipeId");
            if (!recipeId || inscribed.has(recipeId) || seen.has(recipeId)) continue;
            const recipe = RecipeRegistry.get(recipeId);
            if (!recipe) continue;
            seen.add(recipeId);
            pages.push({
                pageId: item.id,
                recipeId,
                name: recipe.name,
                img: recipe.output?.img ?? item.img,
                buffs: this._buffLines(recipe)
            });
        }
        return pages;
    }

    /**
     * Switch the active tab in an already-rendered window.
     * @param {string} tab
     */
    activateTab(tab) {
        const root = this.element;
        if (!root || !tab) return;
        for (const btn of root.querySelectorAll("[data-mf-tab]")) {
            btn.classList.toggle("active", btn.dataset.mfTab === tab);
        }
        for (const panel of root.querySelectorAll("[data-mf-panel]")) {
            panel.classList.toggle("active", panel.dataset.mfPanel === tab);
        }
    }

    _onRender(context, options) {
        CodexController.attach(this.element);
        bindTabs(this.element);
        bindFlyouts(this.element);

        if (this.#focusTab) {
            this.activateTab(this.#focusTab);
            this.#focusTab = null;
        }
    }
}
