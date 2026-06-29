import { ConsolePanelRegistry } from "../ui/ConsolePanelRegistry.js";
import { CreatureRegistry } from "../data/CreatureRegistry.js";
import { RecipeRegistry } from "../data/RecipeRegistry.js";

/**
 * Reserved id for a future standalone premium tool module.
 *
 * Premium presence is driven by overlay content dropped into `ionrift-data`
 * (see OverlayContentLoader), not by a separate module. This id is retained
 * only so a future real authoring tool shipped as its own Foundry module would
 * still register as present. No such module ships today.
 */
const PREMIUM_MODULE_ID = "ionrift-monstrous-feast-premium";

/**
 * Premium capability detection.
 *
 * Generalises the old one-off `isPremiumAuthoringAvailable()` boolean into a
 * capability helper other seams can read: "is a premium tool or overlay
 * present?". The primary signal is overlay content: registry entries sourced
 * from an overlay and any console panel the overlay manifest mounts. The
 * reserved module check stays as a secondary signal for a future standalone
 * tool. Nothing here gates the free experience; it only decides whether premium
 * surfaces have something real to mount.
 */
export const Premium = {
    PREMIUM_MODULE_ID,

    /** Whether the reserved future premium tool module is installed and active. */
    hasPremiumModule() {
        return Boolean(game.modules.get(PREMIUM_MODULE_ID)?.active);
    },

    /** Whether any premium tool has contributed a console panel. */
    hasConsolePanels() {
        return ConsolePanelRegistry.list().length > 0;
    },

    /** Whether any registry content arrived from an overlay. */
    hasOverlayContent() {
        const overlaySourced = (registry) => {
            for (const meta of registry._sources?.values?.() ?? []) {
                if (meta.source === "overlay") return true;
            }
            return false;
        };
        return overlaySourced(CreatureRegistry) || overlaySourced(RecipeRegistry);
    },

    /**
     * Capability flag: a premium tool or overlay is present in any form.
     * @returns {boolean}
     */
    isPresent() {
        return this.hasPremiumModule() || this.hasConsolePanels() || this.hasOverlayContent();
    }
};
