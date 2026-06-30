import { Logger } from "./lib/Logger.js";
import { Library } from "./compat/Library.js";
import { SystemBridge } from "./compat/SystemBridge.js";
import { ButcherEngine } from "./engine/ButcherEngine.js";
import { CookEngine } from "./engine/CookEngine.js";
import { CreatureRegistry } from "./data/CreatureRegistry.js";
import { RecipeRegistry } from "./data/RecipeRegistry.js";
import { CookbookApp } from "./apps/CookbookApp.js";
import { LivingCookbookApp } from "./apps/LivingCookbookApp.js";
import { FeastServingApp } from "./apps/FeastServingApp.js";
import { ChatHandler } from "./handlers/ChatHandler.js";
import { ItemSheetHandler, grantMonsterCookingBook } from "./handlers/ItemSheetHandler.js";
import { RecipePageHandler } from "./handlers/RecipePageHandler.js";
import { grantRecipePage, inscribeRecipePage } from "./services/RecipePageService.js";
import { GMRelay } from "./services/GMRelay.js";
import { MealEffects } from "./services/MealEffects.js";
import { registerMonsterDish } from "./services/MealBuffs.js";
import { CompendiumService } from "./services/CompendiumService.js";
import { DiscoveryService } from "./services/DiscoveryService.js";
import { CookbookMirror } from "./services/CookbookMirror.js";
import { CookbookLauncher, ensurePartyCookbookJournal } from "./handlers/CookbookLauncher.js";
import { RespiteIntegration } from "./compat/RespiteIntegration.js";
import { OverlayContentLoader } from "./services/OverlayContentLoader.js";
import { ensureBuiltinBuffHandlers } from "./data/MealBuffHandlers.js";
import { ConsolePanelRegistry } from "./ui/ConsolePanelRegistry.js";
import { ButcherCorpseMarker } from "./services/ButcherCorpseMarker.js";
import { HomebrewStore } from "./services/HomebrewStore.js";

const MODULE_ID = "ionrift-monstrous-feast";

/**
 * Re-render any open GM console and player cookbook windows. Called after the
 * overlay resolver adds or drops content so newly discovered creatures and
 * recipes surface without a reload.
 */
function refreshOpenWindows() {
    const instances = foundry.applications?.instances;
    const apps = instances?.values ? [...instances.values()] : [];
    for (const app of apps) {
        if ((app instanceof CookbookApp || app instanceof LivingCookbookApp) && app.rendered) {
            app.render(false);
        }
    }
}

Hooks.once("init", () => {
    Logger.log("Initializing...");

    game.ionrift = game.ionrift || {};
    game.ionrift.monstrousFeast = {
        openCookbook: () => new CookbookApp().render(true),
        openStarterCompendium: () => CompendiumService.openStarterCompendium(),
        openLivingCookbook: (bookItem, actor) => LivingCookbookApp.open(bookItem, actor),
        openPartyCookbook: () => LivingCookbookApp.openReadOnly(),
        openCookPhase: ({ actor, recipeId, bookItem } = {}) => {
            const book = bookItem ?? DiscoveryService.findPartyCookbook();
            if (!book) {
                ui.notifications.warn("No Monster Cooking book found.");
                return null;
            }
            const carrier = actor
                ?? (book.parent?.documentName === "Actor" ? book.parent : null);
            const app = LivingCookbookApp.open(book, carrier, { focusTab: "recipes" });
            if (!app?.startCookSession(recipeId)) return null;
            return app;
        },
        // Stable entry point for another module's cooking surface (Respite's rest
        // cooking) to hand off into the Monstrous Feast cookbook. Opens the party
        // cookbook on the recipes tab for the cook, no specific recipe selected.
        openCooking: ({ actor, bookItem, onCooked } = {}) => {
            const book = bookItem ?? DiscoveryService.findPartyCookbook();
            if (!book) {
                ui.notifications.warn("No Monster Cooking book found.");
                return null;
            }
            const carrier = actor
                ?? (book.parent?.documentName === "Actor" ? book.parent : null);
            return LivingCookbookApp.open(book, carrier, { focusTab: "recipes", onCooked });
        },
        openFeastServing: (args) => FeastServingApp.open(args),
        grantBook: (actor) => grantMonsterCookingBook(actor),
        grantRecipePage: (actor, recipeId) => grantRecipePage(actor, recipeId),
        inscribePage: (pageItem, actor) => inscribeRecipePage(pageItem, actor),
        removeInscribedRecipe: (recipeId) => {
            const book = DiscoveryService.findPartyCookbook();
            if (!book) return Promise.resolve(false);
            return DiscoveryService.removeInscribedRecipe(book, recipeId);
        },
        clearInscribedRecipes: () => {
            const book = DiscoveryService.findPartyCookbook();
            if (!book) return Promise.resolve(false);
            return DiscoveryService.clearInscribedRecipes(book);
        },
        resetCookbook: () => {
            const book = DiscoveryService.findPartyCookbook();
            if (!book) return Promise.resolve(false);
            return DiscoveryService.resetBookProgress(book);
        },
        discovery: DiscoveryService,
        testButcher: () => ButcherEngine.testSelectedButcher(),
        inspectButcher: (token) => ButcherEngine.inspectButcherEligibility(token ?? canvas.tokens.controlled[0]),
        scanButcherCorpses: (opts) => ButcherEngine.scanSceneCorpses(opts),
        refreshButcherMarkers: () => ButcherEngine.refreshMarkers(),
        butcherMarkerState: () => ({
            ...ButcherEngine.getMarkerDebugState(),
            overlay: ButcherCorpseMarker.getDebugState()
        }),
        cook: (actor, recipeId) => CookEngine.cook(actor, recipeId),
        engine: ButcherEngine,
        cookEngine: CookEngine,
        registry: CreatureRegistry,
        recipes: RecipeRegistry,
        reloadRegistries: async () => {
            await CreatureRegistry.reload();
            await RecipeRegistry.reload();
            await OverlayContentLoader.loadAll({ onChanged: refreshOpenWindows });
            HomebrewStore.applyToRegistries();
            return RecipeRegistry.all().length;
        },
        reloadOverlays: () => OverlayContentLoader.loadAll({ onChanged: refreshOpenWindows }),
        // Lets an installed premium tool contribute a GM console panel/tab.
        registerConsolePanel: (panel) => {
            const ok = ConsolePanelRegistry.register(panel);
            if (ok) refreshOpenWindows();
            return ok;
        },
        // Single switch for the Respite integration, honored on both sides: the
        // serve and butcher paths here, and Respite's cooking handoff gate.
        isRespiteIntegrationEnabled: () => RespiteIntegration.isActive(),
        homebrew: HomebrewStore,
        system: SystemBridge
    };

    HomebrewStore.registerSetting();

    game.settings.register(MODULE_ID, "promptOnCombatEnd", {
        name: "Offer Butchering After Combat",
        hint: "When eligible creatures die, show canvas markers and chat offers. Markers appear when HP hits 0 (including mid-combat) and again when combat ends. Harvested corpses show a dim check marker; passed corpses show none.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "requireHandbook", {
        name: "Require Monster Cooking Book",
        hint: "Only characters carrying the Monster Cooking book can butcher creatures.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "acceptGenericOil", {
        name: "Any Oil Counts as Cooking Oil",
        hint: "Let a plain flask of oil stand in for Cooking Oil when frying. Turn off to require the module's own Cooking Oil.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, RespiteIntegration.SETTING_KEY, {
        name: "Respite Integration",
        hint: "Automatic uses Respite when it is installed. Always on keeps the shared cooking and rest handoff active. Always off keeps Monstrous Feast standalone even when Respite is installed.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            automatic: "Automatic",
            on: "Always on",
            off: "Always off"
        },
        default: "automatic"
    });

    game.settings.register(MODULE_ID, "debugButcherMarker", {
        name: "Debug Butcher Markers",
        hint: "Log butcher marker decisions to the console (GM only). Turn off after debugging.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "debug", {
        name: "Debug Mode",
        hint: "Enable verbose logging for Monstrous Feast.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });

    CookbookMirror.registerSetting(() => LivingCookbookApp.refreshReadOnly());
});

Hooks.once("ready", async () => {
    Logger.log("Ready.");
    Library.warnOnce();
    ChatHandler.init();
    ItemSheetHandler.init();
    RecipePageHandler.init();
    GMRelay.init();
    CookbookLauncher.init();
    CookbookMirror.initHooks();

    await CreatureRegistry.load();
    await RecipeRegistry.load();
    ButcherEngine.init();
    ButcherCorpseMarker.init();

    // Migrate the built-in meal buffs onto the shared buff-handler seam so the
    // four core buffs register the same way overlay buffs do.
    ensureBuiltinBuffHandlers();

    // Pull in any installed overlay content (creatures, recipes, buff handlers)
    // through the registration seams. Degrades to bundled-only when none exists.
    await OverlayContentLoader.loadAll({ onChanged: refreshOpenWindows });
    HomebrewStore.applyToRegistries();

    // Register this module's dishes with the kernel feed pipeline when present.
    // Recipes must be loaded first so buff translation can read them.
    registerMonsterDish(Library.cooking);

    await ensurePartyCookbookJournal();

    if (game.user.isGM && DiscoveryService.findAllPartyCookbooks().length > 1) {
        const message = "Multiple Monster Cooking books detected in the party. Only one shared cookbook is supported; extra copies will not track party progress.";
        ui.notifications.warn(message);
        Logger.warn(message);
    }

    try {
        await foundry.applications.handlebars.loadTemplates([
            "modules/ionrift-monstrous-feast/templates/partials/codex.hbs",
            "modules/ionrift-monstrous-feast/templates/partials/cook-session.hbs",
            "modules/ionrift-monstrous-feast/templates/partials/lc-recipe-row.hbs"
        ]);
    } catch (e) {
        Logger.warn("Failed to register codex partial:", e);
    }

    const notice = SystemBridge.unsupportedNotice();
    if (notice) ui.notifications.warn(notice);

    try {
        const { SettingsLayout } = await import("../../ionrift-library/scripts/SettingsLayout.js");
        SettingsLayout.registerFooter(MODULE_ID);
    } catch (e) {
        Logger.warn("Settings layout integration unavailable:", e);
    }
});

Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;

    const tokenGroup = Array.isArray(controls)
        ? controls.find(c => c.name === "token")
        : controls.tokens;
    if (!tokenGroup) return;

    const tool = {
        name: "monstrous-feast",
        title: "Monstrous Feast",
        icon: "fas fa-drumstick-bite",
        button: true,
        onClick: () => game.ionrift.monstrousFeast.openCookbook()
    };

    if (Array.isArray(tokenGroup.tools)) {
        tokenGroup.tools.push(tool);
    } else {
        tokenGroup.tools[tool.name] = tool;
    }
});

Hooks.on("chatMessage", (log, message) => {
    const cmd = message.trim().toLowerCase();
    if (cmd === "/feast" || cmd === "/monstrousfeast") {
        game.ionrift.monstrousFeast.openCookbook();
        return false;
    }
});

Hooks.on("updateItem", (item, changes) => {
    if (item.getFlag?.(MODULE_ID, "isButcherCookbook") !== true) return;
    const flagChanges = changes?.flags?.[MODULE_ID];
    if (!flagChanges) return;
    if ("discoveredTypes" in flagChanges || "inscribedRecipes" in flagChanges) {
        LivingCookbookApp.refreshForBook(item);
    }
});

Hooks.on("deleteCombat", async (combat) => {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "promptOnCombatEnd")) return;
    await ButcherEngine.onCombatEnd(combat);
    await ButcherEngine.scanSceneCorpses({ createChat: false, reason: "deleteCombat" });
});

Hooks.on("updateActor", async (actor, changes) => {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "promptOnCombatEnd")) return;
    const hp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
    if (hp === undefined || Number(hp) > 0) return;
    await ButcherEngine.onCreatureDeath(actor);
    await ButcherEngine.scanSceneCorpses({ createChat: false, reason: "updateActor-death" });
});

Hooks.on("dnd5e.restCompleted", (actor, result) => {
    MealEffects.onShortRestCompleted(actor, result);
    MealEffects.onLongRestCompleted(actor, result);
});
