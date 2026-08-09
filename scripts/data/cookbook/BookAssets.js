import { CoreIcons } from "../CoreIcons.js";

/**
 * Portrait for a Monster Cooking book item. Uses the live item or compendium
 * image when present, otherwise the bundled default book art.
 * @param {Item|null} bookItem
 * @returns {string}
 */
export function resolveBookImg(bookItem) {
    return bookItem?.img || CoreIcons.book;
}
