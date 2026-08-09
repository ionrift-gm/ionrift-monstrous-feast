import { CoreIcons } from "../CoreIcons.js";

/**
 * Neutral icon for an ingredient with no resolvable image. Deliberately not a
 * meat icon so unmapped staples never read as a cut of monster.
 */
const NEUTRAL_FALLBACK = CoreIcons.pantry;

/**
 * @param {string} name
 * @param {string[]} words
 * @returns {boolean}
 */
function nameIncludesAny(name, words) {
    return words.some(word => name.includes(word));
}

/**
 * Resolve the badge icon for a single recipe or harvest ingredient. The icon
 * always reflects that specific ingredient: pantry staples and seasonings map
 * to their own art, harvested parts map to the matching commodity, and only a
 * true meat cut (the "Monster Meat" wildcard or a named haunch/flank/loin)
 * returns the raw meat icon. Anything unrecognised falls back to a neutral
 * pantry icon rather than meat. Pure, so it can be unit-tested without an actor.
 * @param {{name?:string,icon?:string,foodTag?:string|null,isLoot?:boolean}} ing
 * @returns {string}
 */
export function resolveIngredientIcon(ing = {}) {
    if (ing.icon) return ing.icon;

    const name = String(ing.name ?? "").toLowerCase();
    const foodTag = ing.foodTag ?? null;

    if (name.includes("flour")) return CoreIcons.flour;
    if (name.includes("oil")) return CoreIcons.oil;
    if (name.includes("egg")) return CoreIcons.egg;
    if (name.includes("bread") || name.includes("loaf")) return CoreIcons.bread;
    if (name.includes("ration")) return CoreIcons.jerky;
    if (name.includes("water")) return CoreIcons.water;
    if (nameIncludesAny(name, ["salt", "pepper", "cinnamon", "spice", "seasoning"])) {
        return CoreIcons.spice;
    }

    if (nameIncludesAny(name, ["hide", "pelt", "fur"])) return CoreIcons.hide;
    if (nameIncludesAny(name, ["claw", "talon"])) return CoreIcons.claw;
    if (nameIncludesAny(name, ["feather", "plume"])) return CoreIcons.feather;
    if (nameIncludesAny(name, ["bone", "horn", "tusk", "beak"])) return CoreIcons.bone;
    if (nameIncludesAny(name, ["herb", "root", "leaf"])) return CoreIcons.herb;

    if (foodTag === "essence") return CoreIcons.gem;
    if (foodTag === "plant") return CoreIcons.mushroom;

    if (foodTag === "meat" || nameIncludesAny(name, ["meat", "haunch", "flank", "loin", "steak", "chop", "flesh", "cut"])) {
        return CoreIcons.rawMeat;
    }

    if (ing.isLoot) return CoreIcons.bone;

    return NEUTRAL_FALLBACK;
}
