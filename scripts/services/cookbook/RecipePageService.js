import { RecipeRegistry } from "../../data/catalogs/RecipeRegistry.js";
import { DiscoveryService } from "./DiscoveryService.js";
import { CoreIcons } from "../../data/CoreIcons.js";
import { MODULE_ID } from "../../data/moduleId.js";

/** @type {((book: Item, actor: Actor, options: object) => unknown)|null} */
let _openBook = null;

/** @type {((book: Item) => unknown)|null} */
let _refreshBook = null;

/** @type {((options: object) => Promise<boolean>)|null} */
let _playCeremony = null;

/**
 * @param {{
 *   openBook?: (book: Item, actor: Actor, options: object) => unknown,
 *   refreshBook?: (book: Item) => unknown,
 *   playCeremony?: (options: object) => Promise<boolean>
 * }} dependencies
 */
export function configureRecipePageService({
    openBook,
    refreshBook,
    playCeremony
} = {}) {
    _openBook = typeof openBook === "function" ? openBook : null;
    _refreshBook = typeof refreshBook === "function" ? refreshBook : null;
    _playCeremony = typeof playCeremony === "function" ? playCeremony : null;
}

/**
 * Build a loot item payload for a findable recipe page.
 * @param {string} recipeId
 * @returns {object|null}
 */
export function buildRecipePageData(recipeId) {
    const recipe = RecipeRegistry.get(recipeId);
    if (!recipe) return null;

    const img = recipe.output?.img ?? CoreIcons.recipePage;
    const ingredientList = (recipe.ingredients ?? [])
        .map(i => `${i.quantity}x ${i.name}`)
        .join(", ");

    return {
        name: `Recipe Page: ${recipe.name}`,
        type: "loot",
        img,
        system: {
            description: {
                value: `<p>A loose page torn from a hunter's cookbook. Inscribe it into a Monster Cooking book to learn how to prepare <strong>${recipe.name}</strong>.</p><p><em>Requires:</em> ${ingredientList || "see the inscribed entry"}</p>`
            },
            rarity: recipe.output?.rarity ?? "common",
            weight: 0.1
        },
        flags: {
            [MODULE_ID]: {
                isRecipePage: true,
                recipeId: recipe.id
            }
        }
    };
}

/**
 * @param {Actor} actor
 * @param {string} recipeId
 * @returns {Promise<Item|null>}
 */
export async function grantRecipePage(actor, recipeId) {
    if (!actor) return null;
    const data = buildRecipePageData(recipeId);
    if (!data) {
        ui.notifications.warn("Recipe not found in registry.");
        return null;
    }
    const created = await actor.createEmbeddedDocuments("Item", [data]);
    return created[0] ?? null;
}

/**
 * Consume a recipe page item and inscribe the recipe on the actor's cookbook.
 * @param {Item} pageItem
 * @param {Actor} [actor] Defaults to pageItem.parent.
 * @returns {Promise<boolean>}
 */
export async function inscribeRecipePage(pageItem, actor = null) {
    actor = actor ?? pageItem?.parent ?? pageItem?.actor;
    if (!actor) {
        ui.notifications.warn("No character owns this recipe page.");
        return false;
    }

    const recipeId = pageItem.getFlag(MODULE_ID, "recipeId");
    if (!recipeId) {
        ui.notifications.warn("This item is not a recipe page.");
        return false;
    }

    const recipe = RecipeRegistry.get(recipeId);
    if (!recipe) {
        ui.notifications.warn("Recipe no longer exists in the registry.");
        return false;
    }

    const book = DiscoveryService.findPartyCookbook();
    if (!book) {
        ui.notifications.warn("The party has no Monster Cooking book to inscribe this page into.");
        return false;
    }

    if (DiscoveryService.isRecipeInscribed(book, recipeId)) {
        ui.notifications.info(`${recipe.name} is already inscribed in ${book.name}.`);
        await pageItem.delete();
        _refreshBook?.(book);
        return true;
    }

    const confirmed = await _playCeremony?.({ recipe, bookName: book.name });
    if (!confirmed) return false;

    await DiscoveryService.inscribeRecipe(book, recipeId);
    await pageItem.delete();
    _refreshBook?.(book);
    ui.notifications.info(`${recipe.name} inscribed into ${book.name}.`);
    return true;
}

/**
 * Entry point when a recipe page is used or its inscribe button is pressed.
 * When the page sits on the party-book carrier and the user may open the book,
 * open it on the Recipes tab so the inscribe offer is reviewed in place.
 * Otherwise fall back to the direct inscribe (relay plus ceremony).
 * @param {Item} pageItem
 * @param {Actor} [actor] Defaults to pageItem.parent.
 * @returns {Promise<boolean>}
 */
export async function openOrInscribe(pageItem, actor = null) {
    actor = actor ?? pageItem?.parent ?? pageItem?.actor;
    const book = DiscoveryService.findPartyCookbook();
    const carrier = book?.actor ?? book?.parent ?? null;

    const pageOnCarrier = Boolean(book && carrier && actor && carrier.id === actor.id);
    if (pageOnCarrier && DiscoveryService.canUserOpenCookbook(book) && _openBook) {
        _openBook(book, carrier, { focusTab: "recipes" });
        return true;
    }

    return inscribeRecipePage(pageItem, actor);
}
