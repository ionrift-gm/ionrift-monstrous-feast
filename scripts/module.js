import { Logger } from "./lib/Logger.js";
import { Library } from "./compat/Library.js";
import { SystemBridge } from "./compat/SystemBridge.js";
import { ButcherEngine } from "./engine/ButcherEngine.js";
import { CreatureRegistry } from "./data/catalogs/CreatureRegistry.js";
import { RecipeRegistry } from "./data/catalogs/RecipeRegistry.js";
import { CookbookApp } from "./apps/CookbookApp.js";
import { LivingCookbookApp } from "./apps/LivingCookbookApp.js";
import { ChatHandler } from "./handlers/ChatHandler.js";
import { ItemSheetHandler } from "./handlers/ItemSheetHandler.js";
import { RecipePageHandler } from "./handlers/RecipePageHandler.js";
import { GMRelay } from "./services/GMRelay.js";
import { MealEffects } from "./services/meals/MealEffects.js";
import { registerMonsterDish } from "./services/meals/MealBuffs.js";
import { DiscoveryService } from "./services/cookbook/DiscoveryService.js";
import { CookbookMirror } from "./services/cookbook/CookbookMirror.js";
import { CookbookLauncher, ensurePartyCookbookJournal } from "./handlers/CookbookLauncher.js";
import { RespiteIntegration } from "./compat/RespiteIntegration.js";
import { OverlayContentLoader } from "./services/content/OverlayContentLoader.js";
import { ensureBuiltinBuffHandlers } from "./services/meals/MealBuffHandlers.js";
import { ButcherCorpseMarker } from "./services/ButcherCorpseMarker.js";
import { getButcherState, BUTCHER_STATE } from "./services/butcher/ButcherTokenState.js";
import { HomebrewStore } from "./services/content/HomebrewStore.js";
import { MODULE_ID, MODULE_LABEL } from "./data/moduleId.js";
import { createMonstrousFeastContext } from "./composition/createMonstrousFeastContext.js";

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
    createMonstrousFeastContext({ refreshOpenWindows });
    ChatHandler.init();

    HomebrewStore.registerSetting();

    game.settings.register(MODULE_ID, "promptOnCombatEnd", {
        name: "Offer Butchering After Combat",
        hint: "Shows canvas markers and chat offers when eligible creatures die and after combat. Harvested corpses show a check marker.",
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

    // Legacy key kept config:false so old world values do not surface as a second
    // debug toggle. Butcher marker verbosity now follows Debug Mode.
    game.settings.register(MODULE_ID, "debugButcherMarker", {
        name: "Debug Butcher Markers",
        hint: "Deprecated. Use Debug Mode.",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "debug", {
        name: "Debug Mode",
        hint: "Verbose console logging for Monstrous Feast, including butcher marker decisions.",
        scope: "client",
        config: false,
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
            `modules/${MODULE_ID}/templates/partials/codex.hbs`,
            `modules/${MODULE_ID}/templates/partials/cook-session.hbs`,
            `modules/${MODULE_ID}/templates/partials/lc-recipe-row.hbs`
        ]);
    } catch (e) {
        Logger.warn("Failed to register codex partial:", e);
    }

    const notice = SystemBridge.unsupportedNotice();
    if (notice) ui.notifications.warn(notice);

    try {
        const { SettingsLayout } = await import(
            "../../ionrift-library/scripts/utils/SettingsLayout.js"
        );
        SettingsLayout.registerFooter(MODULE_ID);
    } catch (e) {
        Logger.warn("Settings layout integration unavailable:", e);
    }
});

Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user?.isGM || !controls) return;

    if (game.ionrift?.hud?.registerSceneControl) {
        game.ionrift.hud.registerSceneControl(controls, {
            group: "tokens",
            name: "monstrous-feast",
            title: MODULE_LABEL,
            icon: "fas fa-drumstick-bite",
            order: 11,
            onClick: () => game.ionrift.monstrousFeast.openCookbook()
        });
        return;
    }

    const tokenGroup = Array.isArray(controls)
        ? controls.find(c => c.name === "token" || c.name === "tokens")
        : (controls.tokens || controls.token);
    if (!tokenGroup) return;

    const tool = {
        name: "monstrous-feast",
        title: MODULE_LABEL,
        icon: "fas fa-drumstick-bite",
        button: true,
        order: 11
    };

    if (Array.isArray(tokenGroup.tools)) {
        tool.onClick = () => game.ionrift.monstrousFeast.openCookbook();
        tokenGroup.tools.push(tool);
    } else {
        tool.onChange = () => game.ionrift.monstrousFeast.openCookbook();
        if (!tokenGroup.tools) tokenGroup.tools = {};
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
    if (hp === undefined) return;
    if (Number(hp) > 0) {
        await ButcherEngine.revokeButcherOffer(actor);
        return;
    }
    await ButcherEngine.onCreatureDeath(actor);
    await ButcherEngine.scanSceneCorpses({ createChat: false, reason: "updateActor-death" });
});

Hooks.on("dnd5e.restCompleted", (actor, result) => {
    MealEffects.onShortRestCompleted(actor, result);
    MealEffects.onLongRestCompleted(actor, result);
});

Hooks.on("renderTokenHUD", (hud, html) => {
    if (!game.user?.isGM) return;
    const token = hud.object;
    if (!token?.actor || SystemBridge.isPlayerCharacter(token.actor)) return;

    const state = getButcherState(token);
    const isLoot = ButcherEngine.isLootContainer(token.actor, token);
    const target = ButcherEngine.buildTargetFromActor(token.actor, token, { allowResolved: true, allowLoot: true });

    if (!target && !state) return;
    if (isLoot && !state) return;

    const isActive = state === BUTCHER_STATE.READY
        || ButcherEngine.getPendingTargetsList().some(p => p.tokenId === (token.document?.id ?? token.id));

    const title = isActive
        ? "Monstrous Feast: Butchering enabled (click to disable)"
        : "Monstrous Feast: Butchering disabled (click to enable)";

    const el = html instanceof HTMLElement ? html : (html[0] ?? html);
    const col = el.querySelector?.(".col.left") ?? el.querySelector?.(".col.right");
    if (!col) return;

    const btn = document.createElement("div");
    btn.className = `control-icon ${isActive ? "active" : ""}`;
    btn.dataset.action = "mf-toggle-butcher";
    btn.title = title;
    btn.innerHTML = `<i class="fas fa-drumstick-bite"></i>`;
    btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await ButcherEngine.toggleButcherOffer(token);
        hud.render(true);
    });
    col.appendChild(btn);
});
