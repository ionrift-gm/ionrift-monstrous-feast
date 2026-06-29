import { CookEngine } from "../engine/CookEngine.js";
import { MealService } from "../services/MealService.js";
import { RecipeRegistry } from "../data/RecipeRegistry.js";
import { DiscoveryService } from "../services/DiscoveryService.js";
import { inscribeRecipePage } from "../services/RecipePageService.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { buildCodex } from "../data/CodexModel.js";
import { CodexController } from "../ui/CodexController.js";
import { CookbookMirror } from "../services/CookbookMirror.js";
import { CookbookLauncher } from "../handlers/CookbookLauncher.js";
import { bindTabs, bindFlyouts } from "../ui/TabBinder.js";
import { attachImageFallback } from "../ui/ImageFallback.js";
import { buildCookPhaseContext, buildCookSuccessContext } from "../engine/CookPhaseModel.js";
import { emitCookCompleted } from "../services/CookSignal.js";
import { MealBuffHandlers } from "../data/MealBuffHandlers.js";

const MODULE_ID = "ionrift-monstrous-feast";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** @type {Map<string, LivingCookbookApp>} */
const OPEN_BY_BOOK = new Map();

/** @type {LivingCookbookApp|null} */
let READONLY_APP = null;

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

    /** @type {boolean} */
    #readOnly = false;

    /**
     * Optional callback invoked once when a cook resolves, set by whoever opened
     * the cookbook (Respite uses it to consume the cook's rest activity).
     * @type {Function|null}
     */
    #onCooked = null;

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
            rollForCook: LivingCookbookApp.#onRollForCook,
            closeFailed: LivingCookbookApp.#onCloseFailed,
            serveCook: LivingCookbookApp.#onServeCook,
            finishCook: LivingCookbookApp.#onFinishCook,
            shareBook: LivingCookbookApp.#onShareBook
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
    constructor(bookItem, actor, { readOnly = false, ...options } = {}) {
        super({
            ...options,
            id: readOnly
                ? "monstrous-feast-lc-readonly"
                : `monstrous-feast-lc-${bookItem?.id ?? foundry.utils.randomID()}`
        });
        this.#readOnly = readOnly;
        this.#syncRefs(bookItem, actor);
    }

    /**
     * @param {Item} bookItem
     * @param {Actor} actor
     */
    static open(bookItem, actor, { focusTab = null, onCooked = null } = {}) {
        if (!bookItem) return null;
        if (!DiscoveryService.canUserOpenCookbook(bookItem)) {
            ui.notifications.warn("Only the book keeper or the GM can open the Monster Cooking book.");
            return null;
        }

        const key = bookItem.uuid ?? bookItem.id;
        const existing = OPEN_BY_BOOK.get(key);
        if (existing) {
            existing.#syncRefs(bookItem, actor);
            if (onCooked) existing.#onCooked = onCooked;
            existing.render(false);
            existing.bringToTop?.();
            if (focusTab) existing.activateTab(focusTab);
            return existing;
        }

        const app = new LivingCookbookApp(bookItem, actor);
        app.#focusTab = focusTab;
        app.#onCooked = onCooked;
        OPEN_BY_BOOK.set(key, app);
        app.render(true);
        return app;
    }

    /**
     * Open the shared read-only viewer. Any player may open their own copy; it
     * reads the mirrored party-cookbook state and exposes no writing actions.
     * @returns {LivingCookbookApp}
     */
    static openReadOnly() {
        if (READONLY_APP?.rendered) {
            READONLY_APP.bringToTop?.();
            READONLY_APP.render(false);
            return READONLY_APP;
        }
        const app = new LivingCookbookApp(null, null, {
            readOnly: true,
            window: { title: "Party Cookbook", icon: "fas fa-book" }
        });
        READONLY_APP = app;
        app.render(true);
        return app;
    }

    /**
     * Re-render the open read-only viewer after the mirrored state changes.
     */
    static refreshReadOnly() {
        if (READONLY_APP?.rendered) READONLY_APP.render(false);
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
        this.#abandonRoll();
        this.#cookSession = null;
    }

    /**
     * Release the shared roll-request queue when the session no longer needs the
     * cook's prompt (GM stepped in, cancelled, or closed). Settled rolls treat
     * this as a no-op.
     */
    #abandonRoll() {
        this.#cookSession?.rollAbort?.abort();
    }

    #buildCookView() {
        if (!this.#cookSession) return null;

        const { phase, context, failMessage, result } = this.#cookSession;
        const isRolling = phase === "rolling";
        const view = {
            ...context,
            phase,
            failMessage,
            isPrep: phase === "prep",
            isRolling,
            isFailed: phase === "failed",
            isSuccess: phase === "success",
            gmCanRoll: isRolling && game.user.isGM && !this.#cookSession.gmRolling
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
        if (this.#readOnly) {
            if (READONLY_APP === this) READONLY_APP = null;
            return super._onClose(options);
        }
        const key = this.#bookItem?.uuid ?? this.#bookItem?.id;
        if (key) OPEN_BY_BOOK.delete(key);
        this.#clearCookSession();
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

    static #onRollForCook() {
        return this.#rollForCook();
    }

    static #onServeCook() {
        return this.#serveCook();
    }

    static #onFinishCook() {
        this.#clearCookSession();
        this.render(false);
    }

    /**
     * Serve the just-cooked dish to the party on an explicit player action. The
     * cook itself only consumes ingredients and posts the splash; serving (the
     * shared cooking-slot buff plus per-member temp HP) waits for this click.
     * The success screen closes once serving is dispatched.
     */
    async #serveCook() {
        const session = this.#cookSession;
        if (session?.phase !== "success" || !session.result?.success || session.serving) return;

        session.serving = true;
        await MealService.serveParty(this.#actor, session.result.recipe, Boolean(session.result.ambitious));

        if (this.#cookSession !== session) return;
        this.#clearCookSession();
        this.render(false);
    }

    static #onShareBook() {
        return this.#shareBook();
    }

    async #shareBook() {
        const carrier = this.#actor?.name ?? "The book keeper";
        const content = `<div class="mf-share-card">`
            + `<p><i class="fas fa-book-open"></i> <strong>${carrier}</strong> shares the party cookbook.</p>`
            + `<p>${CookbookLauncher.linkHtml()}</p>`
            + `</div>`;
        await ChatMessage.create({ user: game.user.id, content });
        ui.notifications.info("Shared the cookbook with the party.");
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
        this.#cookSession.gmRolling = false;
        this.#cookSession.resolveGmRoll = null;
        this.#cookSession.rollAbort = null;
        this.render(false);

        const { recipe, context } = this.#cookSession;
        const rollResult = await this.#awaitCookRoll(recipe, context.dcBreakdown);

        if (!this.#cookSession || rollResult == null) return;

        const result = await CookEngine.resolveCook(this.#actor, recipe.id, {
            bookItem: this.#bookItem,
            rollResult,
            dcBreakdown: context.dcBreakdown,
            serve: false
        });

        if (!this.#cookSession) return;

        // A resolved cook (pass or fail) spent ingredients: the cook committed.
        // Signal once so a host surface can consume the cook's rest activity.
        if (result && !this.#cookSession.cookSignalled) {
            this.#cookSession.cookSignalled = true;
            emitCookCompleted({
                actor: this.#actor,
                recipe,
                success: Boolean(result.success),
                onCooked: this.#onCooked
            });
        }

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

    /**
     * Resolve the cook's Survival roll. The connected cook is prompted via the
     * library roll-request; when a GM is present they can step in and roll on
     * the cook's behalf, whichever resolves first.
     * @param {object} recipe
     * @param {object} dcBreakdown
     * @returns {Promise<object>}
     */
    #awaitCookRoll(recipe, dcBreakdown) {
        const controller = new AbortController();
        if (this.#cookSession) this.#cookSession.rollAbort = controller;

        const playerRoll = CookEngine.requestSurvivalRoll(
            this.#actor, recipe, dcBreakdown, { signal: controller.signal }
        );
        if (!game.user.isGM) return playerRoll;

        const gmRoll = new Promise((resolve) => {
            if (this.#cookSession) this.#cookSession.resolveGmRoll = resolve;
        });
        return Promise.race([playerRoll, gmRoll]);
    }

    async #rollForCook() {
        const session = this.#cookSession;
        if (session?.phase !== "rolling" || typeof session.resolveGmRoll !== "function") return;

        const resolve = session.resolveGmRoll;
        session.resolveGmRoll = null;
        session.gmRolling = true;
        this.render(false);

        const result = await CookEngine.rollSurvivalForCook(
            this.#actor,
            session.recipe,
            session.context.dcBreakdown
        );
        resolve(result);
        session.rollAbort?.abort();
    }

    #prepareReadOnlyContext() {
        const state = CookbookMirror.getState();
        const discovered = new Set(state.discoveredTypes ?? []);
        const inscribed = new Set(state.inscribedRecipes ?? []);
        const codex = buildCodex({
            discoveredCreatures: discovered,
            inscribedRecipes: inscribed,
            actor: null,
            hideEntryRecipes: true
        });

        const activeTab = this.#activeTab;
        const carrier = state.carrierName?.trim();

        return {
            readOnly: true,
            bookName: state.bookName ?? "Party Cookbook",
            bookImg: state.bookImg ?? null,
            actorName: carrier || "the party",
            carrierName: carrier || "",
            bookPresent: state.present,
            systemLabel: SystemBridge.launchLabel(),
            discoveredCount: codex.unlockedCount,
            inscribedCount: codex.inscribedCount,
            recipeTotal: codex.recipeTotal,
            totalCount: codex.totalCount,
            hasActor: false,
            cookableRecipes: [],
            pendingPages: [],
            cookActive: false,
            cook: null,
            activeTab,
            creaturesTabActive: activeTab === "creatures",
            recipesTabActive: activeTab === "recipes",
            ...codex
        };
    }

    _buffLines(recipe) {
        return MealBuffHandlers.summaries(recipe.partyEffect ?? {}, false);
    }

    async _prepareContext() {
        if (this.#readOnly) return this.#prepareReadOnlyContext();

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
        attachImageFallback(this.element);
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
