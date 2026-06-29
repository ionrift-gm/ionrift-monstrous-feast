const MODULE_ID = "ionrift-monstrous-feast";

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
 * @param {Item} item
 * @param {string} ingredientName
 * @returns {boolean}
 */
export function itemMatchesIngredient(item, ingredientName) {
    if (!item || !ingredientName) return false;
    if (item.name === ingredientName) return true;

    if (ingredientName === COOKING_OIL && acceptsGenericOil()) {
        return GENERIC_OIL_NAMES.has(String(item.name ?? "").trim().toLowerCase());
    }

    if (ingredientName !== GENERIC_MONSTER_MEAT) return false;

    const flags = item.getFlag?.(MODULE_ID) ?? item.flags?.[MODULE_ID] ?? {};
    return flags.monsterIngredient === true && flags.foodTag === "meat";
}

/**
 * @param {Actor} actor
 * @param {string} ingredientName
 * @returns {number}
 */
export function countIngredient(actor, ingredientName) {
    let total = 0;
    for (const item of actor?.items ?? []) {
        if (!itemMatchesIngredient(item, ingredientName)) continue;
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
 * @param {string} ingredientName
 * @param {number} quantity
 */
export async function consumeIngredient(actor, ingredientName, quantity) {
    let remaining = quantity;
    const stacks = actor.items.filter(item => itemMatchesIngredient(item, ingredientName));
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
