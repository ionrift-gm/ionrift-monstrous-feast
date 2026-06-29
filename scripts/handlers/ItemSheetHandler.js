import { LivingCookbookApp } from "../apps/LivingCookbookApp.js";
import { DiscoveryService } from "../services/DiscoveryService.js";
import { MealService } from "../services/MealService.js";
import { RecipeRegistry } from "../data/RecipeRegistry.js";
import { Logger } from "../lib/Logger.js";

const MODULE_ID = "ionrift-monstrous-feast";

export const ItemSheetHandler = {
    init() {
        Hooks.on("renderItemSheet", (app, html, data) => {
            ItemSheetHandler._injectOpenButton(app, html);
            ItemSheetHandler._injectServeButton(app, html);
        });
        Hooks.on("renderItemSheet5e", (app, html, data) => {
            ItemSheetHandler._injectOpenButton(app, html);
            ItemSheetHandler._injectServeButton(app, html);
        });
        Hooks.on("dnd5e.getItemContextOptions", (item, options) => {
            ItemSheetHandler._injectServeContext(item, options);
        });
    },

    /**
     * Add a right-click "Serve to Party" option to a packed dish. Uses the same
     * dnd5e inventory hook Respite uses, so it works standalone and appears
     * alongside Respite's per-person Eat when both are installed.
     * @param {Item} item
     * @param {object[]} options
     */
    _injectServeContext(item, options) {
        if (item?.getFlag?.(MODULE_ID, "monsterDish") !== true) return;

        const actor = item.parent;
        if (!actor?.isOwner) return;

        const recipeId = item.getFlag(MODULE_ID, "recipeId");
        const recipe = recipeId ? RecipeRegistry.get(recipeId) : null;
        if (!recipe) return;

        const ambitious = Boolean(item.getFlag(MODULE_ID, "ambitious"));
        options.push({
            name: "Serve to Party",
            icon: '<i class="fas fa-bowl-food"></i>',
            group: "action",
            condition: () => (item.system?.quantity ?? 1) > 0,
            callback: () => MealService.serveParty(actor, recipe, ambitious, { sourceItem: item })
        });
    },

    /**
     * @param {Application} app
     * @param {HTMLElement|jQuery} html
     */
    _injectOpenButton(app, html) {
        const item = app.item ?? app.object;
        if (!item?.getFlag?.(MODULE_ID, "isButcherCookbook")) return;

        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root || root.querySelector(".mf-open-living-cookbook")) return;

        const actor = item.actor ?? item.parent;
        if (!DiscoveryService.canUserOpenCookbook(item)) return;

        const footer = root.querySelector(".sheet-footer")
            ?? root.querySelector("footer")
            ?? root.querySelector(".window-content");
        if (!footer) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "mf-open-living-cookbook";
        button.innerHTML = '<i class="fas fa-book-open"></i> Open Cookbook';
        button.addEventListener("click", (event) => {
            event.preventDefault();
            LivingCookbookApp.open(item, actor);
        });
        footer.prepend(button);
    },

    /**
     * Add a serve action to a packed dish so the owner can feed the party later.
     * @param {Application} app
     * @param {HTMLElement|jQuery} html
     */
    _injectServeButton(app, html) {
        const item = app.item ?? app.object;
        if (!item?.getFlag?.(MODULE_ID, "monsterDish")) return;

        const actor = item.actor ?? item.parent;
        if (!actor?.isOwner) return;

        const recipeId = item.getFlag(MODULE_ID, "recipeId");
        const recipe = recipeId ? RecipeRegistry.get(recipeId) : null;
        if (!recipe) return;

        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root || root.querySelector(".mf-serve-dish")) return;

        const footer = root.querySelector(".sheet-footer")
            ?? root.querySelector("footer")
            ?? root.querySelector(".window-content");
        if (!footer) return;

        const ambitious = Boolean(item.getFlag(MODULE_ID, "ambitious"));
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mf-serve-dish";
        button.innerHTML = '<i class="fas fa-bowl-food"></i> Serve to Party';
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            await MealService.serveParty(actor, recipe, ambitious, { sourceItem: item });
            app.close();
        });
        footer.prepend(button);
    }
};

/**
 * Grant the Monster Cooking book item to an actor from bundled JSON.
 * @param {Actor} actor
 */
export async function grantMonsterCookingBook(actor) {
    if (!actor) return null;
    const response = await fetch("modules/ionrift-monstrous-feast/scripts/data/items/monster-cooking-book.json");
    const data = await response.json();
    const existing = actor.items.find(item => item.getFlag(MODULE_ID, "itemRef") === "monster-cooking-book");
    if (existing) return existing;

    const carriedBook = DiscoveryService.findPartyCookbook();
    const carrier = carriedBook?.actor ?? carriedBook?.parent ?? null;
    if (carriedBook && carrier && carrier.id !== actor.id) {
        const message = "The party already carries a Monster Cooking book. Only one shared cookbook is supported; the extra copy will not track party progress.";
        ui.notifications.warn(message);
        Logger.warn(message);
    }

    const created = await actor.createEmbeddedDocuments("Item", [data]);
    return created[0] ?? null;
}

export { DiscoveryService };
