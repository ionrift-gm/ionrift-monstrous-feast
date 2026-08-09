/**
 * Meal splash and cook result chat cards.
 */

import { formatFactorPills } from "../../engine/cooking/CookDcBreakdown.js";

export function buildMealSplash(recipe, cookName, ambitious = false, breakdown = null) {
    const output = ambitious ? (recipe.ambitiousOutput ?? recipe.output) : recipe.output;
    const ingredientLines = (recipe.ingredients ?? []).map(ing =>
        `<span class="mf-splash-ingredient">${ing.quantity}x ${ing.name}</span>`
    ).join("");

    const dcLine = breakdown?.hasModifiers
        ? `<p class="mf-meal-dc">${formatFactorPills(breakdown)}</p>`
        : "";

    return `<div class="mf-meal-splash">
        <div class="mf-meal-banner">
            <div class="mf-meal-img-wrap">
                <img src="${output.img}" alt="${output.name}" class="mf-meal-img" />
                <span class="mf-meal-steam" aria-hidden="true"></span>
            </div>
        </div>
        <h2 class="mf-meal-title rarity-${output.rarity ?? "common"}">${output.name}</h2>
        <p class="mf-meal-cook"><i class="fas fa-hat-chef"></i> Prepared by <strong>${cookName}</strong></p>
        ${dcLine}
        <div class="mf-meal-ingredients">${ingredientLines}</div>
        <p class="mf-meal-description">${output.description ?? ""}</p>
        <p class="mf-meal-narrative">${recipe.successNarrative ?? ""}</p>
    </div>`;
}

export function buildCookFailCard(recipe, cookName, narrative) {
    return `<div class="mf-meal-splash fail">
        <h2 class="mf-meal-title">${recipe.name}</h2>
        <p class="mf-meal-cook"><i class="fas fa-hat-chef"></i> ${cookName}</p>
        <p class="mf-meal-narrative">${narrative ?? recipe.failNarrative ?? "The cook did not come together."}</p>
    </div>`;
}
