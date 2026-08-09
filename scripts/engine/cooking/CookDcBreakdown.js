/**
 * Cooking DC modifiers derived from actor capabilities (feat, tools, gear).
 */

const adapter = () => game.ionrift?.library?.system;

/**
 * Whether the actor carries a physical cooking kit (utensils or mess kit).
 * @param {Actor} actor
 * @returns {boolean}
 */
function hasCookingKit(actor) {
    const sys = adapter();
    if (sys?.hasItemByName?.(actor, "cook") && sys?.hasItemByName?.(actor, "utensil")) return true;
    if (sys?.hasItemByName?.(actor, "mess kit")) return true;
    return (actor?.items ?? []).some(item => {
        const name = item.name?.toLowerCase() ?? "";
        return (name.includes("cook") && name.includes("utensil")) || name.includes("mess kit");
    });
}

/**
 * @param {Actor} actor
 * @param {object} recipe
 * @returns {{ base: number, total: number, hasModifiers: boolean, factors: { label: string, value: number, sign: "pos"|"neg" }[] }}
 */
export function build(actor, recipe) {
    const base = recipe?.dc ?? 12;
    const factors = [];
    const sys = adapter();

    if (sys?.hasFeat?.(actor, "chef")) {
        factors.push({ label: "-2 Chef", value: -2, sign: "neg" });
    }

    if (sys?.isToolProficient?.(actor, "cook")) {
        factors.push({ label: "-2 Cook's Utensils", value: -2, sign: "neg" });
    } else if (!hasCookingKit(actor)) {
        factors.push({ label: "+2 Improvised", value: 2, sign: "pos" });
    }

    const total = Math.max(1, base + factors.reduce((sum, factor) => sum + factor.value, 0));

    return {
        base,
        total,
        hasModifiers: factors.length > 0,
        factors
    };
}

/**
 * Render factor pills as HTML for confirm dialogs and chat cards.
 * @param {{ factors: object[] }} breakdown
 * @returns {string}
 */
export function formatFactorPills(breakdown) {
    if (!breakdown?.factors?.length) return "";
    const pills = breakdown.factors.map(factor =>
        `<span class="mf-dc-pill mf-dc-pill--${factor.sign}">${factor.label}</span>`
    ).join("");
    return `<span class="mf-dc-pills">${pills}</span>`;
}
