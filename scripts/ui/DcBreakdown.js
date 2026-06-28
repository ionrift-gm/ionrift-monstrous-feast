import { formatFactorPills } from "../engine/CookDcBreakdown.js";

/**
 * @param {{ base: number, total: number, factors: object[] }} breakdown
 * @param {string} skillLabel
 * @returns {string}
 */
export function formatDcLine(breakdown, skillLabel = "Survival") {
    if (!breakdown) return "";
    const pills = formatFactorPills(breakdown);
    const dcText = breakdown.total !== breakdown.base
        ? `DC ${breakdown.total} <span class="mf-dc-base">(base ${breakdown.base})</span>`
        : `DC ${breakdown.total}`;
    return `<p class="mf-cook-dc">${skillLabel} vs ${dcText}${pills ? ` ${pills}` : ""}</p>`;
}
