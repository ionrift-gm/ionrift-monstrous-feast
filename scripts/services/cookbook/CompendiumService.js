import { MODULE_ID } from "../../data/moduleId.js";

export const STARTER_PACK_NAME = "mf-starter";

/** Systems where the dnd5e-locked starter compendium is expected to load. */
const STARTER_PACK_SYSTEMS = new Set(["dnd5e"]);

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
     * True when the starter compendium is loaded or when the active system
     * does not use it (the pack is dnd5e-locked; other systems load starter
     * content from the creature and recipe registries instead).
     * @returns {boolean}
     */
    isStarterContentAvailable() {
        if (CompendiumService.getStarterPack()) return true;
        const systemId = game.system?.id;
        return !!systemId && !STARTER_PACK_SYSTEMS.has(systemId);
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
