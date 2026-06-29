import { build as buildCookDcBreakdown } from "./CookDcBreakdown.js";
import { CookEngine } from "./CookEngine.js";
import { countIngredient } from "../services/IngredientMatcher.js";
import { MealEffects } from "../services/MealEffects.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { CoreIcons } from "../data/CoreIcons.js";

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
 * @param {object} ing
 * @returns {string}
 */
function ingredientIcon(ing) {
    const name = String(ing.name ?? "").toLowerCase();
    if (name.includes("ration")) return CoreIcons.jerky;
    if (name.includes("flour")) return CoreIcons.flour;
    if (name.includes("oil")) return CoreIcons.oil;
    if (name.includes("egg")) return CoreIcons.egg;
    if (name.includes("bread") || name.includes("loaf")) return CoreIcons.bread;
    if (name.includes("salt") || name.includes("pepper") || name.includes("cinnamon")) {
        return "icons/commodities/materials/powder-grey.webp";
    }
    return CoreIcons.rawMeat;
}

/**
 * @param {object} output
 * @returns {string}
 */
function previewImg(output) {
    return output?.successImg ?? output?.img ?? CoreIcons.stew;
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
    const seasoningName = CookEngine.findSeasoning(actor, recipe);
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
            icon: ingredientIcon(ing)
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
        seasoning: seasoningName
            ? { active: true, name: seasoningName }
            : null,
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
