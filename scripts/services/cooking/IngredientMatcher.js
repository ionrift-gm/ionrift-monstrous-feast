import { MODULE_ID } from "../../data/moduleId.js";

/** Recipe ingredient names that accept any butchered monster meat cut. */
const GENERIC_MONSTER_MEAT = "Monster Meat";

/** Recipe ingredient name for the frying staple the module ships. */
const COOKING_OIL = "Cooking Oil";

/**
 * Plain, non-magical oils a GM may already have in play. Magic oils (Oil of
 * Sharpness and the like) are intentionally excluded.
 */
const GENERIC_OIL_NAMES = new Set([
    "oil",
    "oil flask",
    "oil (flask)",
    "flask of oil",
    "lamp oil"
]);

/** @returns {object|null} Library cooking matcher, if present. */
function cookingMatch() {
    return globalThis.game?.ionrift?.library?.cooking?.match ?? null;
}

/**
 * @returns {boolean} Whether a plain flask of oil may stand in for Cooking Oil.
 */
function acceptsGenericOil() {
    try {
        return game.settings.get(MODULE_ID, "acceptGenericOil") === true;
    } catch {
        return false;
    }
}

/**
 * Build an IngredientSpec (Monster Meat wildcard + optional generic oil).
 * @param {string|object} selector
 * @returns {object}
 */
function buildSpec(selector) {
    const spec = {};

    if (selector && typeof selector === "object") {
        if (selector.name) spec.name = selector.name;
        if (selector.quantity != null) spec.quantity = selector.quantity;
        if (Array.isArray(selector.accepts)) spec.accepts = [...selector.accepts];
        if (selector.match) spec.match = { ...selector.match, flagScope: MODULE_ID };
    } else {
        spec.name = String(selector ?? "");
    }

    if (spec.name === GENERIC_MONSTER_MEAT && !spec.match) {
        spec.match = { flag: "monsterIngredient", foodTag: "meat", flagScope: MODULE_ID };
    }

    if (spec.name === COOKING_OIL && acceptsGenericOil()) {
        spec.accepts = [...new Set([...(spec.accepts ?? []), ...GENERIC_OIL_NAMES])];
    }

    return spec;
}

function nameEquals(item, name) {
    if (!item || !name) return false;
    const left = String(item.name ?? "").replace(/\s+\((\d+d|<\d+h|\d+h)\)$/i, "").trim().toLowerCase();
    const right = String(name ?? "").trim().toLowerCase();
    return Boolean(left && right && left === right);
}

/**
 * Name/flag fallback when Library.cooking.match is absent.
 * @param {Item|object} item
 * @param {object} spec
 * @returns {boolean}
 */
function legacyItemMatches(item, spec) {
    if (!item || !spec) return false;
    if (spec.name && nameEquals(item, spec.name)) return true;
    if (Array.isArray(spec.accepts) && spec.accepts.some(name => nameEquals(item, name))) return true;

    const match = spec.match;
    if (match?.flag || match?.foodTag) {
        const flags = item.getFlag?.(MODULE_ID) ?? item.flags?.[MODULE_ID] ?? {};
        const flagOk = match.flag ? Boolean(flags[match.flag]) : true;
        const tagOk = match.foodTag ? flags.foodTag === match.foodTag : true;
        if (flagOk && tagOk) return true;
    }
    return false;
}

/**
 * @param {Item} item
 * @param {string|object} selector Ingredient name or recipe ingredient object.
 * @returns {boolean}
 */
export function itemMatchesIngredient(item, selector) {
    if (!item || !selector) return false;
    const spec = buildSpec(selector);
    const match = cookingMatch();
    if (match) return match.itemMatches(item, spec, {});
    return legacyItemMatches(item, spec);
}

/**
 * @param {Actor} actor
 * @param {string|object} selector Ingredient name or recipe ingredient object.
 * @returns {number}
 */
export function countIngredient(actor, selector) {
    const spec = buildSpec(selector);
    const match = cookingMatch();
    if (match) return match.count(actor, spec, {});

    let total = 0;
    for (const item of actor?.items ?? []) {
        if (!legacyItemMatches(item, spec)) continue;
        total += Number(item.system?.quantity ?? 1);
    }
    return total;
}

/**
 * First name in the list the actor holds in sufficient quantity. Used for
 * optional seasoning slots that accept any one of several pantry items.
 * @param {Actor} actor
 * @param {string[]} names
 * @param {number} [quantity]
 * @returns {string|null}
 */
export function findAvailable(actor, names, quantity = 1) {
    for (const name of names ?? []) {
        if (countIngredient(actor, name) >= quantity) return name;
    }
    return null;
}

/**
 * @param {Actor} actor
 * @param {string|object} selector Ingredient name or recipe ingredient object.
 * @param {number} quantity
 */
export async function consumeIngredient(actor, selector, quantity) {
    if (!actor) return;
    const spec = buildSpec(selector);
    const match = cookingMatch();
    if (match) {
        await match.consume(actor, spec, quantity, {});
        return;
    }

    let remaining = quantity;
    const stacks = actor.items.filter(item => legacyItemMatches(item, spec));
    for (const stack of stacks) {
        if (remaining <= 0) break;
        const qty = Number(stack.system?.quantity ?? 1);
        if (qty <= remaining) {
            remaining -= qty;
            await stack.delete();
        } else {
            await stack.update({ "system.quantity": qty - remaining });
            remaining = 0;
        }
    }
}
