import { SystemBridge } from "../compat/SystemBridge.js";
import { CreatureRegistry } from "../data/CreatureRegistry.js";
import { RecipeRegistry } from "../data/RecipeRegistry.js";
import { ButcherEngine } from "../engine/ButcherEngine.js";
import { grantMonsterCookingBook } from "../handlers/ItemSheetHandler.js";
import { buildCodex } from "../data/CodexModel.js";
import { CodexController } from "../ui/CodexController.js";
import { grantRecipePage } from "../services/RecipePageService.js";
import { DiscoveryService } from "../services/DiscoveryService.js";
import { LivingCookbookApp } from "./LivingCookbookApp.js";
import { CompendiumService } from "../services/CompendiumService.js";
import { bindTabs, bindFlyouts } from "../ui/TabBinder.js";
import { attachImageFallback } from "../ui/ImageFallback.js";
import { resolveBookImg } from "../data/BookAssets.js";

const PREMIUM_MODULE_ID = "ionrift-monstrous-feast-premium";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @returns {object|null}
 */
function buildPartyBookSnapshot() {
    const book = DiscoveryService.findPartyCookbook();
    if (!book) return null;

    const actor = book.actor ?? book.parent ?? null;
    return {
        name: book.name,
        img: book.img,
        carrierName: actor?.name ?? "Unknown",
        inscribedRecipes: DiscoveryService.getInscribedRecipes(book).map(id => ({
            id,
            name: RecipeRegistry.get(id)?.name ?? id
        })),
        discoveredCreatures: DiscoveryService.getDiscoveredTypes(book).map(id => {
            const entry = CreatureRegistry.get(id);
            return { id, label: entry?.label ?? id };
        })
    };
}

/**
 * GM console: registry browse, system status, and GM test hooks.
 */
export class CookbookApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static PREMIUM_MODULE_ID = PREMIUM_MODULE_ID;

    static isPremiumAuthoringAvailable() {
        return Boolean(game.modules.get(PREMIUM_MODULE_ID)?.active);
    }

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
            testButcher: CookbookApp.#onTestButcher,
            grantBook: CookbookApp.#onGrantBook,
            grantRecipePage: CookbookApp.#onGrantRecipePage,
            openCookbook: CookbookApp.#onOpenCookbook,
            openCompendium: CookbookApp.#onOpenCompendium,
            removeInscribedRecipe: CookbookApp.#onRemoveInscribedRecipe,
            clearInscribedRecipes: CookbookApp.#onClearInscribedRecipes,
            removeDiscoveredType: CookbookApp.#onRemoveDiscoveredType,
            clearDiscoveredTypes: CookbookApp.#onClearDiscoveredTypes,
            resetCookbook: CookbookApp.#onResetCookbook,
            reloadRegistry: CookbookApp.#onReloadRegistry
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
            recipePages: RecipeRegistry.all().map(r => ({
                id: r.id,
                name: r.name
            })),
            isGM: game.user.isGM,
            hasPartyBook: Boolean(partyBook),
            partyBook,
            starterPackReady: Boolean(CompendiumService.getStarterPack()),
            homebrewPath: "modules/ionrift-monstrous-feast/data/homebrew/",
            premiumAuthoring: CookbookApp.isPremiumAuthoringAvailable()
        };
    }

    _onRender(context, options) {
        attachImageFallback(this.element);
        CodexController.attach(this.element);
        bindTabs(this.element);
        bindFlyouts(this.element);
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

    static async #onTestButcher() {
        if (!game.user.isGM) return;
        await ButcherEngine.testSelectedButcher();
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

    static async #onGrantBook() {
        if (!game.user.isGM) return;
        const token = canvas.tokens.controlled[0];
        const actor = token?.actor ?? game.user.character;
        if (!actor) {
            ui.notifications.warn("Select a token or assign a character first.");
            return;
        }
        await grantMonsterCookingBook(actor);
        ui.notifications.info(`Monster Cooking book added to ${actor.name}.`);
        await this.render(false);
    }

    static async #onGrantRecipePage(_event, target) {
        if (!game.user.isGM) return;
        const recipeId = target?.dataset?.recipeId;
        if (!recipeId) return;
        const token = canvas.tokens.controlled[0];
        const actor = token?.actor ?? game.user.character;
        if (!actor) {
            ui.notifications.warn("Select a token or assign a character first.");
            return;
        }
        const page = await grantRecipePage(actor, recipeId);
        if (page) {
            ui.notifications.info(`Recipe page added to ${actor.name}. Inscribe it from the item sheet.`);
        }
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
            content: `<p>Remove every inscribed recipe from <strong>${book.name}</strong>? Creature discoveries stay logged.</p>`,
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

        ui.notifications.info(`${entry?.label ?? typeId} removed from ${book.name}.`);
        await CookbookApp.#refreshBookViews(book, this);
    }

    static async #onClearDiscoveredTypes() {
        if (!game.user.isGM) return;
        const book = CookbookApp.#partyBookOrWarn();
        if (!book) return;

        const confirmed = await Dialog.confirm({
            title: "Clear creature log",
            content: `<p>Remove every logged creature from <strong>${book.name}</strong>? Inscribed recipes stay.</p>`,
            yes: () => true,
            no: () => false,
            defaultYes: false
        });
        if (!confirmed) return;

        await DiscoveryService.clearDiscoveredTypes(book);
        ui.notifications.info(`Creature log cleared on ${book.name}.`);
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
        await CreatureRegistry.reload();
        await RecipeRegistry.reload();
        ui.notifications.info("Monstrous Feast registries reloaded from bundled and homebrew JSON.");
        await this.render(false);
    }
}
