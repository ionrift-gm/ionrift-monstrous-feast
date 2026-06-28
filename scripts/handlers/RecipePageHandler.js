import { inscribeRecipePage } from "../services/RecipePageService.js";

const MODULE_ID = "ionrift-monstrous-feast";

export const RecipePageHandler = {
    init() {
        Hooks.on("renderItemSheet", (app, html) => {
            RecipePageHandler._injectInscribeButton(app, html);
        });
        Hooks.on("renderItemSheet5e", (app, html) => {
            RecipePageHandler._injectInscribeButton(app, html);
        });

        Hooks.on("dnd5e.useItem", (item, config, options) => {
            if (!item?.getFlag?.(MODULE_ID, "isRecipePage")) return;
            inscribeRecipePage(item);
            return false;
        });
    },

    /**
     * @param {Application} app
     * @param {HTMLElement|jQuery} html
     */
    _injectInscribeButton(app, html) {
        const item = app.item ?? app.object;
        if (!item?.getFlag?.(MODULE_ID, "isRecipePage")) return;

        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root || root.querySelector(".mf-inscribe-recipe-page")) return;

        const actor = item.actor ?? item.parent;
        const canUse = actor?.isOwner || game.user.isGM;
        if (!canUse) return;

        const footer = root.querySelector(".sheet-footer")
            ?? root.querySelector("footer")
            ?? root.querySelector(".window-content");
        if (!footer) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "mf-inscribe-recipe-page";
        button.innerHTML = '<i class="fas fa-book-medical"></i> Inscribe to Cookbook';
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            await inscribeRecipePage(item, actor);
        });
        footer.prepend(button);
    }
};
