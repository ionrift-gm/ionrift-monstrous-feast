import { CookEngine } from "../engine/CookEngine.js";
import { RecipeRegistry } from "../data/RecipeRegistry.js";
import { DiscoveryService } from "../services/DiscoveryService.js";
import { inscribeRecipePage } from "../services/RecipePageService.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { buildCodex } from "../data/CodexModel.js";
import { CodexController } from "../ui/CodexController.js";
import { FeastServingApp } from "./FeastServingApp.js";
import { bindTabs, bindFlyouts } from "../ui/TabBinder.js";
import { buildCookPhaseContext, buildCookSuccessContext } from "../engine/CookPhaseModel.js";

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

    /** @type {"creatures"|"recipes"} */
    #activeTab = "creatures";

    /** @type {object|null} */
    #cookSession = null;

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
            inscribePage: LivingCookbookApp.#onInscribePage,
            cancelCook: LivingCookbookApp.#onCancelCook,
            beginCook: LivingCookbookApp.#onBeginCook,
            closeFailed: LivingCookbookApp.#onCloseFailed,
            serveMeal: LivingCookbookApp.#onServeMeal
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
        if (app.#cookSession?.phase === "prep") {
            app.#cookSession.context = buildCookPhaseContext(
                app.#actor,
                app.#cookSession.recipe,
                app.#bookItem
            );
        }
        app.render(false);
    }

    /**
     * Open the in-book cooking session for a recipe.
     * @param {string} recipeId
     * @returns {boolean}
     */
    startCookSession(recipeId) {
        if (!recipeId || !this.#actor || !this.#bookItem) return false;

        const recipe = RecipeRegistry.get(recipeId);
        if (!recipe) {
            ui.notifications.warn("Recipe not found.");
            return false;
        }

        if (!DiscoveryService.isRecipeInscribed(this.#bookItem, recipeId)) {
            ui.notifications.warn("Inscribe this recipe page before cooking.");
            return false;
        }

        const check = CookEngine.checkIngredients(this.#actor, recipe);
        if (!check.ok) {
            ui.notifications.warn(`Missing ingredients: ${check.missing.join(", ")}`);
            return false;
        }

        this.#cookSession = {
            recipe,
            phase: "prep",
            context: buildCookPhaseContext(this.#actor, recipe, this.#bookItem),
            failMessage: "",
            result: null
        };
        this.#activeTab = "recipes";
        this.render(false);
        return true;
    }

    #syncRefs(bookItem, actor) {
        this.#bookItem = bookItem?.uuid ? bookItem : game.items.get(bookItem?.id) ?? bookItem;
        this.#actor = actor?.uuid ? actor : game.actors.get(actor?.id) ?? actor;
    }

    #clearCookSession() {
        this.#cookSession = null;
    }

    #buildCookView() {
        if (!this.#cookSession) return null;

        const { phase, context, failMessage, result } = this.#cookSession;
        const view = {
            ...context,
            phase,
            failMessage,
            isPrep: phase === "prep",
            isRolling: phase === "rolling",
            isFailed: phase === "failed",
            isSuccess: phase === "success"
        };

        if (phase === "success" && result?.recipe) {
            Object.assign(view, buildCookSuccessContext(
                result.recipe,
                result.ambitious,
                this.#actor?.name ?? ""
            ));
        }

        return view;
    }

    _onClose(options) {
        const key = this.#bookItem?.uuid ?? this.#bookItem?.id;
        if (key) OPEN_BY_BOOK.delete(key);
        this.#cookSession = null;
        return super._onClose(options);
    }

    static #onCookRecipe(event, target) {
        return this.cookRecipe(event, target);
    }

    static #onInscribePage(event, target) {
        return this.inscribePage(event, target);
    }

    static #onCancelCook() {
        this.#clearCookSession();
        this.render(false);
    }

    static #onCloseFailed() {
        this.#clearCookSession();
        this.render(false);
    }

    static #onBeginCook() {
        return this.#beginCook();
    }

    static #onServeMeal() {
        return this.#serveMeal();
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

    cookRecipe(_event, target) {
        if (target?.disabled) return;
        const recipeId = target?.dataset?.recipeId;
        if (!recipeId) return;
        this.startCookSession(recipeId);
    }

    async #beginCook() {
        if (this.#cookSession?.phase !== "prep" || !this.#actor || !this.#cookSession.recipe) return;

        this.#cookSession.phase = "rolling";
        this.render(false);

        const { recipe, context } = this.#cookSession;
        const rollResult = await CookEngine.requestSurvivalRoll(
            this.#actor,
            recipe,
            context.dcBreakdown
        );

        if (!this.#cookSession) return;

        const result = await CookEngine.resolveCook(this.#actor, recipe.id, {
            bookItem: this.#bookItem,
            rollResult,
            dcBreakdown: context.dcBreakdown
        });

        if (!this.#cookSession) return;

        if (!result?.success) {
            this.#cookSession.phase = "failed";
            this.#cookSession.failMessage = recipe.failNarrative
                ?? "The cook did not come together. Ingredients were lost.";
            this.render(false);
            return;
        }

        this.#cookSession.phase = "success";
        this.#cookSession.result = result;
        this.render(false);
    }

    async #serveMeal() {
        const result = this.#cookSession?.result;
        this.#clearCookSession();
        this.render(false);

        if (!result?.tempFormula) return;

        if (game.user.isGM) {
            FeastServingApp.open({
                recipe: result.recipe,
                ambitious: result.ambitious,
                tempFormula: result.tempFormula,
                cookName: this.#actor?.name ?? ""
            });
        } else {
            const { FeastServingRelay } = await import("../services/FeastServingRelay.js");
            FeastServingRelay.requestServing({
                recipeId: result.recipe.id,
                ambitious: result.ambitious,
                tempFormula: result.tempFormula,
                cookName: this.#actor?.name ?? ""
            });
        }
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
            actor: this.#actor,
            hideEntryRecipes: true
        });

        const cook = this.#buildCookView();
        const activeTab = this.#cookSession ? "recipes" : this.#activeTab;

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
            cookActive: Boolean(cook),
            cook,
            activeTab,
            creaturesTabActive: activeTab === "creatures",
            recipesTabActive: activeTab === "recipes",
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
        if (!tab) return;
        this.#activeTab = tab;
        const root = this.element;
        if (!root) return;
        for (const btn of root.querySelectorAll("[data-mf-tab]")) {
            btn.classList.toggle("active", btn.dataset.mfTab === tab);
        }
        for (const panel of root.querySelectorAll("[data-mf-panel]")) {
            panel.classList.toggle("active", panel.dataset.mfPanel === tab);
        }
    }

    #bindCookbookTabHooks(root) {
        if (!root || root.dataset.lcTabHook === "true") return;
        root.dataset.lcTabHook = "true";

        root.addEventListener("click", (event) => {
            const button = event.target.closest("[data-mf-tab]");
            if (!button || !root.contains(button)) return;

            const tab = button.dataset.mfTab;
            if (!tab) return;

            this.#activeTab = tab;
            if (this.#cookSession && tab !== "recipes") {
                this.#clearCookSession();
                this.render(false);
            }
        });
    }

    _onRender(context, options) {
        CodexController.attach(this.element);
        bindTabs(this.element);
        bindFlyouts(this.element);
        this.#bindCookbookTabHooks(this.element);

        if (this.#focusTab) {
            this.#activeTab = this.#focusTab;
            this.#focusTab = null;
        }

        this.activateTab(this.#cookSession ? "recipes" : this.#activeTab);

        const root = this.element;
        if (!root) return;

        root.classList.toggle("mf-lc-cook-active", Boolean(this.#cookSession));
    }
}
