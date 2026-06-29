import { GMRelay } from "./GMRelay.js";

const MODULE_ID = "ionrift-monstrous-feast";

/**
 * Tracks creature and recipe progress on Monster Cooking book items.
 *   discoveredTypes: creature ids learned by butchering (ingredient yields).
 *   inscribedRecipes: recipe ids learned by consuming recipe page items.
 */
export const DiscoveryService = {
    /**
     * @param {Item} bookItem
     * @returns {string[]}
     */
    getDiscoveredTypes(bookItem) {
        if (!bookItem) return [];
        return bookItem.getFlag(MODULE_ID, "discoveredTypes") ?? [];
    },

    /**
     * @param {Item} bookItem
     * @returns {string[]}
     */
    getInscribedRecipes(bookItem) {
        if (!bookItem) return [];
        return bookItem.getFlag(MODULE_ID, "inscribedRecipes") ?? [];
    },

    /**
     * @param {Item} bookItem
     * @param {string} typeId
     * @returns {boolean}
     */
    isDiscovered(bookItem, typeId) {
        return this.getDiscoveredTypes(bookItem).includes(typeId);
    },

    /**
     * @param {Item} bookItem
     * @param {string} recipeId
     * @returns {boolean}
     */
    isRecipeInscribed(bookItem, recipeId) {
        return this.getInscribedRecipes(bookItem).includes(recipeId);
    },

    /**
     * Inscribe a recipe on the book, routing through a GM when the caller does
     * not own the book (single carried cookbook, owned by another player).
     * @param {Item} bookItem
     * @param {string} recipeId
     * @returns {Promise<void>}
     */
    async inscribeRecipe(bookItem, recipeId) {
        if (!bookItem || !recipeId) return;
        if (this.isRecipeInscribed(bookItem, recipeId)) return;
        await GMRelay.inscribeRecipe(bookItem, recipeId);
    },

    /**
     * Unlock a creature type on the single party cookbook, wherever it is
     * carried. The butcher still receives loot locally; only the shared journal
     * write is routed through a GM when the carrier is another player.
     * @param {Actor} _butcher
     * @param {string} typeId
     */
    async recordPartyDiscovery(_butcher, typeId) {
        if (!typeId) return;
        const book = this.findPartyCookbook();
        if (!book) return;
        if (this.isDiscovered(book, typeId)) return;
        await GMRelay.recordDiscovery(book, typeId);
    },

    /**
     * @param {Item} bookItem
     * @param {string} recipeId
     * @returns {Promise<boolean>}
     */
    async removeInscribedRecipe(bookItem, recipeId) {
        if (!bookItem || !recipeId) return false;
        const current = this.getInscribedRecipes(bookItem);
        if (!current.includes(recipeId)) return false;
        await bookItem.setFlag(
            MODULE_ID,
            "inscribedRecipes",
            current.filter(id => id !== recipeId)
        );
        return true;
    },

    /**
     * @param {Item} bookItem
     * @returns {Promise<void>}
     */
    async clearInscribedRecipes(bookItem) {
        if (!bookItem) return;
        await bookItem.setFlag(MODULE_ID, "inscribedRecipes", []);
    },

    /**
     * @param {Item} bookItem
     * @param {string} typeId
     * @returns {Promise<boolean>}
     */
    async removeDiscoveredType(bookItem, typeId) {
        if (!bookItem || !typeId) return false;
        const current = this.getDiscoveredTypes(bookItem);
        if (!current.includes(typeId)) return false;
        await bookItem.setFlag(
            MODULE_ID,
            "discoveredTypes",
            current.filter(id => id !== typeId)
        );
        return true;
    },

    /**
     * @param {Item} bookItem
     * @returns {Promise<void>}
     */
    async clearDiscoveredTypes(bookItem) {
        if (!bookItem) return;
        await bookItem.setFlag(MODULE_ID, "discoveredTypes", []);
    },

    /**
     * Clear all creature and recipe progress on the carried book.
     * @param {Item} bookItem
     * @returns {Promise<void>}
     */
    async resetBookProgress(bookItem) {
        if (!bookItem) return;
        await bookItem.setFlag(MODULE_ID, "discoveredTypes", []);
        await bookItem.setFlag(MODULE_ID, "inscribedRecipes", []);
    },

    /**
     * @returns {Actor[]}
     */
    partyActors() {
        const party = game.ionrift?.library?.party?.getMembers?.() ?? [];
        return party.length
            ? party
            : game.actors.filter(a => a.hasPlayerOwner && a.type === "character");
    },

    /**
     * @param {Actor} actor
     * @returns {Item|null}
     */
    findBookOnActor(actor) {
        if (!actor) return null;
        return actor.items.find(item => item.getFlag(MODULE_ID, "isButcherCookbook") === true) ?? null;
    },

    /**
     * The single party cookbook, wherever a party member carries it.
     * The book is one shared item by design; first carrier wins.
     * @returns {Item|null}
     */
    findPartyCookbook() {
        for (const actor of this.partyActors()) {
            const book = this.findBookOnActor(actor);
            if (book) return book;
        }
        return null;
    },

    /**
     * Every Monster Cooking book carried across party members. The module
     * supports one shared cookbook; more than one here means duplicates that
     * will not track shared progress.
     * @returns {Item[]}
     */
    findAllPartyCookbooks() {
        const books = [];
        for (const actor of this.partyActors()) {
            const book = this.findBookOnActor(actor);
            if (book) books.push(book);
        }
        return books;
    },

    /**
     * Only the actor carrying the party cookbook (and the GM) may open it.
     * @param {Item} bookItem
     * @param {User} [user]
     * @returns {boolean}
     */
    canUserOpenCookbook(bookItem, user = game.user) {
        if (!bookItem?.getFlag?.(MODULE_ID, "isButcherCookbook")) return false;
        if (user?.isGM) return true;

        const carrier = bookItem.actor ?? bookItem.parent ?? null;
        if (!carrier?.isOwner) return false;

        const partyBook = this.findPartyCookbook();
        if (partyBook && partyBook.id !== bookItem.id) return false;

        return true;
    }
};
