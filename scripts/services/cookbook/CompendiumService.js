import { MODULE_ID } from "../../data/moduleId.js";

export const STARTER_PACK_NAME = "mf-starter";

/**
 * Compendium helpers for the Monstrous Feast starter item pack.
 */
export const CompendiumService = {
    /**
     * @returns {CompendiumCollection|null}
     */
    getStarterPack() {
        return game.packs.get(`${MODULE_ID}.${STARTER_PACK_NAME}`) ?? null;
    },

    /**
     * Open the starter compendium in the Foundry sidebar.
     * @returns {boolean}
     */
    openStarterCompendium() {
        const pack = CompendiumService.getStarterPack();
        if (!pack) {
            ui.notifications.warn(
                "Monstrous Feast starter compendium is not loaded. Reload the world after enabling the module."
            );
            return false;
        }
        pack.render(true);
        return true;
    }
};
