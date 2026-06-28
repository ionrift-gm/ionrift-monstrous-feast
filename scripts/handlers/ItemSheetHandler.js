import { LivingCookbookApp } from "../apps/LivingCookbookApp.js";
import { DiscoveryService } from "../services/DiscoveryService.js";

const MODULE_ID = "ionrift-monstrous-feast";

export const ItemSheetHandler = {
    init() {
        Hooks.on("renderItemSheet", (app, html, data) => {
            ItemSheetHandler._injectOpenButton(app, html);
        });
        Hooks.on("renderItemSheet5e", (app, html, data) => {
            ItemSheetHandler._injectOpenButton(app, html);
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
    const created = await actor.createEmbeddedDocuments("Item", [data]);
    return created[0] ?? null;
}

export { DiscoveryService };
