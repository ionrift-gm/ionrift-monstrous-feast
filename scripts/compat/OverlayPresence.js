import { ConsolePanelRegistry } from "../ui/ConsolePanelRegistry.js";
import { CreatureRegistry } from "../data/catalogs/CreatureRegistry.js";
import { RecipeRegistry } from "../data/catalogs/RecipeRegistry.js";

/** Whether overlay content or contributed console panels are present. */
export const OverlayPresence = {
    hasConsolePanels() {
        return ConsolePanelRegistry.list().length > 0;
    },

    hasOverlayContent() {
        const overlaySourced = (registry) => {
            for (const meta of registry._sources?.values?.() ?? []) {
                if (meta.source === "overlay") return true;
            }
            return false;
        };
        return overlaySourced(CreatureRegistry) || overlaySourced(RecipeRegistry);
    },

    /** @returns {boolean} */
    isPresent() {
        return this.hasConsolePanels() || this.hasOverlayContent();
    }
};
