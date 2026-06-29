import { build as buildCookDcBreakdown } from "./CookDcBreakdown.js";
import { CookEngine } from "./CookEngine.js";
import { countIngredient } from "../services/IngredientMatcher.js";
import { MealEffects } from "../services/MealEffects.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { CoreIcons } from "../data/CoreIcons.js";
import { resolveIngredientIcon } from "../data/IngredientIcons.js";

/**
 * @param {object} partyEffect
 * @param {boolean} ambitious
 * @returns {string[]}
 */
function buffLines(partyEffect, ambitious = false) {
    if (!partyEffect) return [];
    const lines = [];
    const hp = ambitious
        ? (partyEffect.ambitiousTempHP ?? partyEffect.tempHP)
        : partyEffect.tempHP;
    if (hp) lines.push(`${hp} temp HP`);
    if (partyEffect.strengthAdvantage) lines.push("Strength advantage");
    if (partyEffect.darkvisionFeet) lines.push(`Darkvision ${partyEffect.darkvisionFeet} ft`);
    if (ambitious && partyEffect.perceptionAdvantageDim) lines.push("Keen senses in dim light");
    return lines;
}

/**
 * @param {object} output
 * @returns {string}
 */
function previewImg(output) {
    return output?.successImg ?? output?.img ?? CoreIcons.stew;
}

/**
 * Seasoning view-model for the cook UI: which spice, how many are on hand, and
 * how many are spent. The spice is consumed on a successful cook and promotes
 * the dish to the ambitious tier. Pure so it can be unit-tested without an
 * actor.
 * @param {object} spec
 * @param {string[]} [spec.accepts] Spices the recipe will accept.
 * @param {number} [spec.quantity] Amount spent per cook.
 * @param {string|null} [spec.heldName] The accepted spice the cook holds, if any.
 * @param {number} [spec.heldCount] How many of that spice are on hand.
 * @param {string} [spec.icon] Icon path for the badge.
 * @returns {object|null} Null when the recipe has no seasoning slot.
 */
export function buildSeasoningViewModel({ accepts = [], quantity = 1, heldName = null, heldCount = 0, icon = "" } = {}) {
    if (!accepts.length) return null;
    const need = Math.max(1, Number(quantity) || 1);
    const have = heldName ? Math.max(0, Number(heldCount) || 0) : 0;
    const onHand = Boolean(heldName) && have >= need;
    return {
        active: onHand,
        name: heldName ?? accepts[0],
        choices: accepts.join(", "),
        need,
        have,
        satisfied: onHand,
        icon
    };
}

/**
 * Build the full cooking-phase view model.
 * @param {Actor} actor
 * @param {object} recipe
 * @param {Item|null} bookItem
 * @returns {object}
 */
export function buildCookPhaseContext(actor, recipe, bookItem = null) {
    const check = CookEngine.checkIngredients(actor, recipe);
    const dcBreakdown = buildCookDcBreakdown(actor, recipe);
    const seasoningSpec = recipe.seasoning ?? null;
    const seasoningName = CookEngine.findSeasoning(actor, recipe);
    const seasoningHeld = (actor && seasoningName) ? countIngredient(actor, seasoningName) : 0;
    const partyEffect = recipe.partyEffect ?? {};
    const standardOutput = recipe.output ?? {};
    const ambitiousOutput = recipe.ambitiousOutput ?? recipe.output ?? {};

    const ingredientStatus = (recipe.ingredients ?? []).map(ing => {
        const need = Math.max(1, Number(ing.quantity) || 1);
        const have = actor ? countIngredient(actor, ing.name) : 0;
        return {
            name: ing.name,
            need,
            have,
            satisfied: have >= need,
            icon: resolveIngredientIcon(ing)
        };
    });

    const partyMembers = MealEffects.getPartyMembers().map(member => ({
        id: member.id,
        name: member.name,
        img: member.img ?? ""
    }));

    let overwriteNames = "";
    if (MealEffects.producesManagedBuff(partyEffect)) {
        const affected = MealEffects.membersWithMealEffect();
        if (affected.length) {
            overwriteNames = affected.map(entry => entry.name).join(", ");
        }
    }

    return {
        recipeId: recipe.id,
        recipeName: recipe.name,
        description: recipe.description ?? "",
        chefName: actor?.name ?? "Unknown",
        skillLabel: SystemBridge.survivalLabel(),
        dcBreakdown,
        cookDc: dcBreakdown.total,
        ambitiousDc: dcBreakdown.total + 5,
        ingredientStatus,
        seasoning: buildSeasoningViewModel({
            accepts: seasoningSpec?.accepts ?? [],
            quantity: seasoningSpec?.quantity ?? 1,
            heldName: seasoningName,
            heldCount: seasoningHeld,
            icon: resolveIngredientIcon({ name: seasoningName ?? seasoningSpec?.accepts?.[0] ?? "" })
        }),
        standard: {
            name: standardOutput.name ?? recipe.name,
            img: previewImg(standardOutput),
            buffs: buffLines(partyEffect, false)
        },
        ambitious: {
            name: ambitiousOutput.name ?? recipe.name,
            img: previewImg(ambitiousOutput),
            buffs: buffLines(partyEffect, true)
        },
        partyMembers,
        overwriteNames,
        canCook: check.ok,
        missing: check.missing,
        bookItem
    };
}

/**
 * Success reveal view model for the in-book cook session.
 * @param {object} recipe
 * @param {boolean} ambitious
 * @param {string} [cookName]
 * @returns {object}
 */
export function buildCookSuccessContext(recipe, ambitious = false, cookName = "") {
    const output = ambitious
        ? (recipe?.ambitiousOutput ?? recipe?.output)
        : recipe?.output;
    const partyEffect = recipe?.partyEffect ?? {};

    return {
        title: ambitious ? "A Feast Well Made" : "Served Up",
        narrative: recipe?.successNarrative ?? "The dish comes together over the fire.",
        mealName: output?.name ?? recipe?.name ?? "Monster Dish",
        mealImg: previewImg(output),
        rarity: output?.rarity ?? "common",
        ambitious,
        cookName,
        buffs: buffLines(partyEffect, ambitious)
    };
}
