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
import { CompendiumService } from "./services/CompendiumService.js";
import { DiscoveryService } from "./services/DiscoveryService.js";

const MODULE_ID = "ionrift-monstrous-feast";

Hooks.once("init", () => {
    Logger.log("Initializing...");

    game.ionrift = game.ionrift || {};
    game.ionrift.monstrousFeast = {
        openCookbook: () => new CookbookApp().render(true),
        openStarterCompendium: () => CompendiumService.openStarterCompendium(),
        openLivingCookbook: (bookItem, actor) => LivingCookbookApp.open(bookItem, actor),
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
        cook: (actor, recipeId) => CookEngine.cook(actor, recipeId),
        engine: ButcherEngine,
        cookEngine: CookEngine,
        registry: CreatureRegistry,
        recipes: RecipeRegistry,
        reloadRegistries: async () => {
            await CreatureRegistry.reload();
            return RecipeRegistry.reload();
        },
        system: SystemBridge
    };

    game.settings.register(MODULE_ID, "promptOnCombatEnd", {
        name: "Offer Butchering After Combat",
        hint: "When a combat ends, offer to butcher slain creatures for ingredients.",
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

    game.settings.register(MODULE_ID, "debug", {
        name: "Debug Mode",
        hint: "Enable verbose logging for Monstrous Feast.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });
});

Hooks.once("ready", async () => {
    Logger.log("Ready.");
    Library.warnOnce();
    ChatHandler.init();
    ItemSheetHandler.init();
    RecipePageHandler.init();
    GMRelay.init();

    await CreatureRegistry.load();
    await RecipeRegistry.load();
    ButcherEngine.init();

    try {
        await foundry.applications.handlebars.loadTemplates([
            "modules/ionrift-monstrous-feast/templates/partials/codex.hbs",
            "modules/ionrift-monstrous-feast/templates/partials/cook-session.hbs"
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

Hooks.on("deleteCombat", (combat) => {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "promptOnCombatEnd")) return;
    ButcherEngine.onCombatEnd(combat);
});
