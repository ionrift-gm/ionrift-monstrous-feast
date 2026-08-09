import { DiscoveryService } from "./DiscoveryService.js";
import { MODULE_ID } from "../../data/moduleId.js";

const SETTING = "partyCookbookState";

const EMPTY_STATE = {
    present: false,
    bookName: "Party Cookbook",
    bookImg: null,
    carrierName: "",
    discoveredTypes: [],
    inscribedRecipes: []
};

/**
 * Mirrors the single party cookbook's shared progress into a world-scope value so
 * players who do not carry the book can read it for the read-only viewer. The GM
 * keeps the mirror current; everyone else only reads it.
 */
export const CookbookMirror = {
    registerSetting(onChange) {
        game.settings.register(MODULE_ID, SETTING, {
            scope: "world",
            config: false,
            type: Object,
            default: { ...EMPTY_STATE },
            onChange: () => onChange?.()
        });
    },

    /**
     * @returns {typeof EMPTY_STATE}
     */
    getState() {
        const state = game.settings.get(MODULE_ID, SETTING);
        return { ...EMPTY_STATE, ...(state ?? {}) };
    },

    /**
     * Recompute the mirror from the live party cookbook. GM only.
     * @returns {Promise<void>}
     */
    async sync() {
        if (!game.user.isGM) return;
        const book = DiscoveryService.findPartyCookbook();
        const next = book
            ? {
                present: true,
                bookName: book.name ?? "Party Cookbook",
                bookImg: book.img ?? null,
                carrierName: (book.actor ?? book.parent)?.name ?? "",
                discoveredTypes: DiscoveryService.getDiscoveredTypes(book),
                inscribedRecipes: DiscoveryService.getInscribedRecipes(book)
            }
            : { ...EMPTY_STATE };

        const current = this.getState();
        const equals = foundry.utils.equals ?? foundry.utils.objectsEqual;
        if (equals(current, next)) return;
        await game.settings.set(MODULE_ID, SETTING, next);
    },

    /**
     * Keep the mirror current as the book moves, changes, or updates. GM only.
     */
    initHooks() {
        const maybeSync = (item) => {
            if (item?.getFlag?.(MODULE_ID, "isButcherCookbook") === true) this.sync();
        };
        Hooks.on("updateItem", (item) => maybeSync(item));
        Hooks.on("createItem", (item) => maybeSync(item));
        Hooks.on("deleteItem", (item) => maybeSync(item));
        if (game.user.isGM) this.sync();
    }
};
