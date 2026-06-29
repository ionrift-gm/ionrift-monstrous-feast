import { SystemBridge } from "../compat/SystemBridge.js";
import { RecipeRegistry } from "../data/RecipeRegistry.js";

const MODULE_ID = "ionrift-monstrous-feast";

/**
 * Slot discriminator this module writes into the kernel's shared cooking-buff
 * slot. Mirrors the library's DEFAULT_COOKING_SLOT.
 */
export const SHARED_BUFF_SLOT = "cooking";

/**
 * Translate a recipe's party effect into the kernel's canonical buff model.
 *
 * Only the persistent buffs are returned. Temporary hit points stay out of the
 * shared buff slot: this module rolls them per party member at serve time and
 * applies the rolled value directly, so they never collapse into one shared
 * formula. See MealService.serveParty and FeastServingApp.
 *
 * @param {object} partyEffect
 * @param {boolean} [ambitious]
 * @returns {object[]} IonriftBuff descriptors.
 */
export function translatePartyEffect(partyEffect, ambitious = false) {
    if (!partyEffect) return [];
    const buffs = [];

    if (partyEffect.strengthAdvantage) {
        buffs.push({ type: "check_advantage", ability: "str", duration: "untilLongRest", target: "party" });
    }
    if (partyEffect.darkvisionFeet) {
        buffs.push({
            type: "sense_darkvision",
            feet: Number(partyEffect.darkvisionFeet),
            duration: "untilLongRest",
            target: "party"
        });
    }
    if (ambitious && partyEffect.perceptionAdvantageDim) {
        buffs.push({
            type: "skill_advantage",
            skill: "prc",
            conditions: { dimLight: true },
            duration: "untilLongRest",
            target: "party"
        });
    }

    return buffs;
}

/**
 * Per-member descriptive parts for a served meal on a system with an effect
 * mapping (dnd5e). Used in the served-meal report and the effect description.
 * @param {object} partyEffect
 * @param {boolean} [ambitious]
 * @returns {string[]}
 */
export function describePartyEffectParts(partyEffect, ambitious = false) {
    if (!partyEffect) return [];
    const parts = [];
    if (partyEffect.strengthAdvantage) {
        parts.push("advantage on Strength checks until your next long rest");
    }
    if (partyEffect.darkvisionFeet) {
        parts.push(`${partyEffect.darkvisionFeet}ft darkvision until your next long rest`);
    }
    if (ambitious && partyEffect.perceptionAdvantageDim) {
        parts.push("advantage on Perception checks until your next long rest");
    }
    return parts;
}

/**
 * Advisory lines for a system with no effect mapping: the party gains the buff,
 * but it must be tracked by hand.
 * @param {object} partyEffect
 * @param {boolean} [ambitious]
 * @returns {string[]}
 */
export function trackManuallyLines(partyEffect, ambitious = false) {
    if (!partyEffect) return [];
    const lines = [];
    if (partyEffect.strengthAdvantage) {
        lines.push("Party gains advantage on Strength checks until the next long rest (track manually).");
    }
    if (partyEffect.darkvisionFeet) {
        lines.push(`Party gains ${partyEffect.darkvisionFeet}ft darkvision until the next long rest (track manually).`);
    }
    if (ambitious && partyEffect.perceptionAdvantageDim) {
        lines.push("Party gains advantage on Perception in dim light until the next long rest (track manually).");
    }
    return lines;
}

/**
 * Report lines for a served meal's persistent buffs. Per-member on a mapped
 * system, otherwise the track-manually advisory.
 * @param {Array<{ name: string }>} members
 * @param {object} partyEffect
 * @param {boolean} ambitious
 * @returns {string[]}
 */
export function buildServeReportLines(members, partyEffect, ambitious) {
    const parts = describePartyEffectParts(partyEffect, ambitious);
    if (!parts.length) return [];
    if (SystemBridge.systemId() === "dnd5e") {
        return (members ?? []).map(member => `${member.name}: ${parts.join("; ")}`);
    }
    return trackManuallyLines(partyEffect, ambitious);
}

/**
 * @param {Item|object} item
 * @returns {boolean} Whether an item is one of this module's party dishes.
 */
export function isMonsterDish(item) {
    return item?.flags?.[MODULE_ID]?.monsterDish === true;
}

/**
 * Persistent buffs for a dish item, read from the recipe it records.
 * @param {Item|object} item
 * @returns {object[]}
 */
export function buffsForDishItem(item) {
    const flags = item?.flags?.[MODULE_ID] ?? {};
    const recipe = RecipeRegistry.get(flags.recipeId);
    if (!recipe) return [];
    return translatePartyEffect(recipe.partyEffect, flags.ambitious === true);
}

/**
 * Register this module's dishes with the kernel feed pipeline so a serve can
 * collect their buffs. No-op when the kernel lacks the cooking abstraction.
 * @param {object|null} cooking The `game.ionrift.library.cooking` namespace.
 * @returns {boolean} Whether registration happened.
 */
export function registerMonsterDish(cooking) {
    if (!cooking?.feed?.registerDish) return false;
    cooking.feed.registerDish({
        id: `${MODULE_ID}:monster-dish`,
        isDish: isMonsterDish,
        buffsFor: buffsForDishItem
    });
    return true;
}
