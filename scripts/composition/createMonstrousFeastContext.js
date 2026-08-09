import { ButcherEngine } from "../engine/ButcherEngine.js";
import { CookEngine } from "../engine/cooking/CookEngine.js";
import { CreatureRegistry } from "../data/catalogs/CreatureRegistry.js";
import { RecipeRegistry } from "../data/catalogs/RecipeRegistry.js";
import { CookbookApp } from "../apps/CookbookApp.js";
import { LivingCookbookApp } from "../apps/LivingCookbookApp.js";
import { FeastServingApp } from "../apps/FeastServingApp.js";
import { InscribeCeremonyApp } from "../apps/InscribeCeremonyApp.js";
import { grantMonsterCookingBook } from "../handlers/ItemSheetHandler.js";
import {
    configureRecipePageService,
    grantRecipePage,
    inscribeRecipePage
} from "../services/cookbook/RecipePageService.js";
import { CookbookLauncher } from "../handlers/CookbookLauncher.js";
import { CompendiumService } from "../services/cookbook/CompendiumService.js";
import { DiscoveryService } from "../services/cookbook/DiscoveryService.js";
import { RespiteIntegration } from "../compat/RespiteIntegration.js";
import { OverlayContentLoader } from "../services/content/OverlayContentLoader.js";
import { ConsolePanelRegistry } from "../ui/ConsolePanelRegistry.js";
import { ButcherCorpseMarker } from "../services/ButcherCorpseMarker.js";
import { HomebrewStore } from "../services/content/HomebrewStore.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { GMRelay, GM_RELAY_ACTIONS } from "../services/GMRelay.js";
import { MealEffects } from "../services/meals/MealEffects.js";
import { createServingRelayHandler } from "../services/meals/FeastServingRelay.js";
import { createPersistButcherStateHandler } from "../services/butcher/ButcherTokenState.js";
import { handleGrantYieldsRelay } from "../services/butcher/ItemFactory.js";

export function createMonstrousFeastDependencies(overrides = {}) {
    return {
        butcherEngine: ButcherEngine,
        cookEngine: CookEngine,
        creatureRegistry: CreatureRegistry,
        recipeRegistry: RecipeRegistry,
        cookbookApp: CookbookApp,
        livingCookbookApp: LivingCookbookApp,
        feastServingApp: FeastServingApp,
        inscribeCeremonyApp: InscribeCeremonyApp,
        cookbookLauncher: CookbookLauncher,
        configureRecipePageService,
        grantMonsterCookingBook,
        grantRecipePage,
        inscribeRecipePage,
        compendiumService: CompendiumService,
        discoveryService: DiscoveryService,
        respiteIntegration: RespiteIntegration,
        overlayContentLoader: OverlayContentLoader,
        consolePanelRegistry: ConsolePanelRegistry,
        butcherCorpseMarker: ButcherCorpseMarker,
        homebrewStore: HomebrewStore,
        systemBridge: SystemBridge,
        gmRelay: GMRelay,
        mealEffects: MealEffects,
        createServingRelayHandler,
        createPersistButcherStateHandler,
        handleGrantYieldsRelay,
        ...overrides
    };
}

/**
 * Assemble runtime collaborators, then build and expose the stable public API.
 * @param {{ refreshOpenWindows: () => void }} runtime
 * @param {object} [dependencyOverrides]
 * @returns {object}
 */
export function createMonstrousFeastContext(runtime, dependencyOverrides = {}) {
    const dependencies = createMonstrousFeastDependencies(dependencyOverrides);
    const {
        butcherEngine,
        cookEngine,
        creatureRegistry,
        recipeRegistry,
        cookbookApp,
        livingCookbookApp,
        feastServingApp,
        inscribeCeremonyApp,
        cookbookLauncher,
        configureRecipePageService: configureRecipePages,
        grantMonsterCookingBook: grantBook,
        grantRecipePage: grantPage,
        inscribeRecipePage: inscribePage,
        compendiumService,
        discoveryService,
        respiteIntegration,
        overlayContentLoader,
        consolePanelRegistry,
        butcherCorpseMarker,
        homebrewStore,
        systemBridge,
        gmRelay,
        mealEffects,
        createServingRelayHandler: buildServingRelayHandler,
        createPersistButcherStateHandler: buildPersistButcherStateHandler,
        handleGrantYieldsRelay: grantYieldsRelayHandler
    } = dependencies;

    butcherEngine.configure({ markerService: butcherCorpseMarker });
    butcherCorpseMarker.configure({ butcherEngine });
    cookbookLauncher.configure({
        openReadOnly: () => livingCookbookApp.openReadOnly()
    });
    configureRecipePages({
        openBook: (book, actor, options) => livingCookbookApp.open(book, actor, options),
        refreshBook: (book) => livingCookbookApp.refreshForBook(book),
        playCeremony: (options) => inscribeCeremonyApp.play(options)
    });

    gmRelay.clearHandlers();
    gmRelay.registerHandlers({
        [GM_RELAY_ACTIONS.discover]: (data) => discoveryService.applyRelayedDiscovery(data),
        [GM_RELAY_ACTIONS.inscribe]: (data) => discoveryService.applyRelayedInscribe(data),
        [GM_RELAY_ACTIONS.serving]: buildServingRelayHandler({
            recipeRegistry,
            feastServingApp
        }),
        [GM_RELAY_ACTIONS.applyEffect]: (data) => mealEffects.applyRelayedEffect(data),
        [GM_RELAY_ACTIONS.clearEffect]: (data) => mealEffects.clearRelayedEffect(data),
        [GM_RELAY_ACTIONS.persistButcher]: buildPersistButcherStateHandler({
            butcherEngine,
            butcherCorpseMarker
        }),
        [GM_RELAY_ACTIONS.grantYields]: grantYieldsRelayHandler
    });

    const api = {
        openCookbook: () => new cookbookApp().render(true),
        openStarterCompendium: () => compendiumService.openStarterCompendium(),
        openLivingCookbook: (bookItem, actor) => livingCookbookApp.open(bookItem, actor),
        openPartyCookbook: () => livingCookbookApp.openReadOnly(),
        openCookPhase: ({ actor, recipeId, bookItem } = {}) => {
            const book = bookItem ?? discoveryService.findPartyCookbook();
            if (!book) {
                ui.notifications.warn("No Monster Cooking book found.");
                return null;
            }
            const carrier = actor
                ?? (book.parent?.documentName === "Actor" ? book.parent : null);
            const app = livingCookbookApp.open(book, carrier, { focusTab: "recipes" });
            if (!app?.startCookSession(recipeId)) return null;
            return app;
        },
        openCooking: ({ actor, bookItem, onCooked } = {}) => {
            const book = bookItem ?? discoveryService.findPartyCookbook();
            if (!book) {
                ui.notifications.warn("No Monster Cooking book found.");
                return null;
            }
            const carrier = actor
                ?? (book.parent?.documentName === "Actor" ? book.parent : null);
            return livingCookbookApp.open(book, carrier, { focusTab: "recipes", onCooked });
        },
        openFeastServing: (args) => feastServingApp.open(args),
        grantBook: (actor) => grantBook(actor),
        grantRecipePage: (actor, recipeId) => grantPage(actor, recipeId),
        inscribePage: (pageItem, actor) => inscribePage(pageItem, actor),
        removeInscribedRecipe: (recipeId) => {
            const book = discoveryService.findPartyCookbook();
            if (!book) return Promise.resolve(false);
            return discoveryService.removeInscribedRecipe(book, recipeId);
        },
        clearInscribedRecipes: () => {
            const book = discoveryService.findPartyCookbook();
            if (!book) return Promise.resolve(false);
            return discoveryService.clearInscribedRecipes(book);
        },
        resetCookbook: () => {
            const book = discoveryService.findPartyCookbook();
            if (!book) return Promise.resolve(false);
            return discoveryService.resetBookProgress(book);
        },
        discovery: discoveryService,
        testButcher: () => butcherEngine.testSelectedButcher(),
        inspectButcher: (token) => butcherEngine.inspectButcherEligibility(token ?? canvas.tokens.controlled[0]),
        scanButcherCorpses: (opts) => butcherEngine.scanSceneCorpses(opts),
        refreshButcherMarkers: () => butcherEngine.refreshMarkers(),
        butcherMarkerState: () => ({
            ...butcherEngine.getMarkerDebugState(),
            overlay: butcherCorpseMarker.getDebugState()
        }),
        cook: (actor, recipeId) => cookEngine.cook(actor, recipeId),
        engine: butcherEngine,
        cookEngine,
        registry: creatureRegistry,
        recipes: recipeRegistry,
        reloadRegistries: async () => {
            await creatureRegistry.reload();
            await recipeRegistry.reload();
            await overlayContentLoader.loadAll({ onChanged: runtime.refreshOpenWindows });
            homebrewStore.applyToRegistries();
            return recipeRegistry.all().length;
        },
        reloadOverlays: () => overlayContentLoader.loadAll({ onChanged: runtime.refreshOpenWindows }),
        registerConsolePanel: (panel) => {
            const registered = consolePanelRegistry.register(panel);
            if (registered) runtime.refreshOpenWindows();
            return registered;
        },
        isRespiteIntegrationEnabled: () => respiteIntegration.isActive(),
        homebrew: homebrewStore,
        system: systemBridge
    };

    exposeMonstrousFeastApi(api);
    return api;
}

export function exposeMonstrousFeastApi(api) {
    game.ionrift = game.ionrift || {};
    game.ionrift.monstrousFeast = api;
}

export function getMonstrousFeastApi() {
    return game.ionrift?.monstrousFeast ?? null;
}
