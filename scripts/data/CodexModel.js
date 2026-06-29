import { CreatureRegistry } from "./CreatureRegistry.js";
import { RecipeRegistry } from "./RecipeRegistry.js";
import { CookEngine } from "../engine/CookEngine.js";
import { countIngredient, findAvailable } from "../services/IngredientMatcher.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { CoreIcons } from "./CoreIcons.js";
import { resolveIngredientIcon } from "./IngredientIcons.js";

const TYPE_ICONS = {
    beast: CoreIcons.bear,
    monstrosity: CoreIcons.monstrosity,
    aberration: CoreIcons.aberration,
    dragon: CoreIcons.dragon
};

const YIELD_TIERS = ["basic", "standard", "exceptional"];

const TIER_NUMBERS = { common: 1, uncommon: 2, rare: 3, legendary: 4 };

function resolveCreatureIcon(entry) {
    if (entry.img) return entry.img;
    const base = String(entry.id ?? "").split("_")[0];
    return TYPE_ICONS[base] ?? CoreIcons.unknown;
}

/**
 * Flatten an entry's tiered yields into a unique ingredient list.
 * @param {object} entry
 * @returns {Array<{name:string,qty:number,isLoot:boolean,foodTag:string|null}>}
 */
function collectIngredients(entry) {
    const byName = new Map();
    for (const tier of YIELD_TIERS) {
        for (const y of entry[tier] ?? []) {
            const existing = byName.get(y.name);
            const qty = Math.max(1, Number(y.qty) || 1);
            if (existing) {
                existing.qty = Math.max(existing.qty, qty);
            } else {
                byName.set(y.name, {
                    name: y.name,
                    qty,
                    isLoot: y.type === "loot",
                    foodTag: y.foodTag ?? null,
                    icon: y.icon ?? null
                });
            }
        }
    }
    return [...byName.values()].map(ing => ({ ...ing, icon: resolveIngredientIcon(ing) }));
}

/**
 * Human-readable buff summary from a recipe partyEffect. Display only; the
 * dedicated buff pass will turn these into applied effects.
 * @param {object} recipe
 * @returns {string[]}
 */
function buffSummary(recipe) {
    const fx = recipe.partyEffect ?? {};
    const lines = [];
    if (fx.tempHP) lines.push(`${fx.tempHP} temp HP`);
    if (fx.strengthAdvantage) lines.push("Strength advantage");
    if (fx.darkvisionFeet) lines.push(`Darkvision ${fx.darkvisionFeet} ft`);
    if (fx.perceptionAdvantageDim) lines.push("Keen senses in dim light");
    return lines;
}

/**
 * Short "from ..." source for a recipe card in the deduplicated recipe list.
 * A recipe that takes any cut reads as generic; one tied to a single creature
 * names it; pantry recipes (no creature link) name the pantry.
 * @param {object} recipe
 * @param {Map<string,string>} labelMap
 * @returns {string}
 */
function recipeSourceLabel(recipe, labelMap) {
    const usesGenericMeat = (recipe.ingredients ?? []).some(ing => ing.name === "Monster Meat");
    if (usesGenericMeat) return "any monster meat";
    const links = (recipe.linkedCreatures ?? [])
        .map(id => labelMap.get(id))
        .filter(Boolean);
    if (links.length === 0) return "the pantry";
    if (links.length === 1) return links[0];
    return "various creatures";
}

function mapRecipe(recipe, actor, inscribed, { audit = false, partyInscribed = false } = {}) {
    const check = actor
        ? CookEngine.checkIngredients(actor, recipe)
        : { ok: false, missing: [] };
    const ingredientStatus = (recipe.ingredients ?? []).map(ing => {
        const need = Math.max(1, Number(ing.quantity) || 1);
        const have = actor ? countIngredient(actor, ing.name) : 0;
        return {
            name: ing.name,
            need,
            have,
            satisfied: have >= need,
            icon: resolveIngredientIcon({
                name: ing.name,
                isLoot: false,
                foodTag: ing.foodTag ?? null,
                icon: ing.icon ?? null
            })
        };
    });
    return {
        id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        dc: recipe.dc,
        img: recipe.output?.img ?? CoreIcons.stew,
        art: recipe.output?.art ?? null,
        buffs: buffSummary(recipe),
        ingredients: (recipe.ingredients ?? []).map(i => `${i.quantity}x ${i.name}`),
        ingredientRows: recipe.ingredients ?? [],
        ingredientStatus,
        seasoning: buildSeasoningStatus(recipe, actor),
        canCook: inscribed && check.ok,
        missing: check.missing.join(", "),
        cookTooltip: (inscribed && check.ok)
            ? `Cook ${recipe.name}`
            : (!inscribed ? "Inscribe this recipe first" : `Missing: ${check.missing.join(", ")}`),
        inscribed,
        audit,
        partyInscribed
    };
}

/**
 * Optional seasoning slot status for display. Never gates cooking; a held spice
 * promotes a successful cook to the ambitious tier.
 * @param {object} recipe
 * @param {Actor|null} actor
 * @returns {object|null}
 */
function buildSeasoningStatus(recipe, actor) {
    const accepts = recipe?.seasoning?.accepts ?? [];
    if (!accepts.length) return null;
    const need = Math.max(1, Number(recipe.seasoning.quantity) || 1);
    const available = actor ? findAvailable(actor, accepts, need) : null;
    return {
        accepts,
        label: accepts.join(" or "),
        need,
        available,
        active: Boolean(available)
    };
}

/**
 * Build the shared codex view model.
 *
 * @param {object} [opts]
 * @param {Set<string>} [opts.discoveredCreatures] Creature ids learned by butchering.
 * @param {Set<string>} [opts.inscribedRecipes] Recipe ids learned from recipe pages.
 * @param {Actor|null} [opts.actor] Actor whose inventory gates "cookable now".
 * @param {boolean} [opts.revealAll] When true every entry and recipe is visible (GM registry).
 * @param {Set<string>} [opts.auditDiscovered] Party-book discovered ids, for the GM audit overlay.
 * @param {Set<string>} [opts.auditInscribed] Party-book inscribed recipe ids, for the GM audit overlay.
 * @returns {object}
 */
export function buildCodex({ discoveredCreatures = null, inscribedRecipes = null, actor = null, revealAll = false, auditDiscovered = null, auditInscribed = null, hideEntryRecipes = false } = {}) {
    const crLabel = SystemBridge.systemId() === "pf2e" ? "Level" : "CR";
    const audit = Boolean(auditDiscovered || auditInscribed);
    const cookableRecipes = [];
    const recipeList = [];

    const entries = CreatureRegistry.all().map(entry => {
        const baseType = String(entry.id ?? "").split("_")[0];
        const unlocked = revealAll || (discoveredCreatures?.has(entry.id) ?? false);
        const partyDiscovered = audit && (auditDiscovered?.has(entry.id) ?? false);

        const linked = RecipeRegistry.forCreature(entry.id);
        const visibleRecipes = linked
            .filter(recipe => revealAll || (inscribedRecipes?.has(recipe.id) ?? false))
            .map(recipe => mapRecipe(
                recipe,
                actor,
                revealAll || (inscribedRecipes?.has(recipe.id) ?? false),
                { audit, partyInscribed: auditInscribed?.has(recipe.id) ?? false }
            ));

        const pendingPages = revealAll
            ? 0
            : linked.filter(recipe => !(inscribedRecipes?.has(recipe.id) ?? false)).length;

        const ingredients = unlocked ? collectIngredients(entry) : [];
        const searchBlob = unlocked
            ? [
                entry.label ?? entry.id,
                baseType,
                ...ingredients.map(i => i.name),
                ...visibleRecipes.map(r => r.name)
            ].join(" ").toLowerCase()
            : "";

        const tier = entry.tier ?? "common";
        return {
            id: entry.id,
            label: entry.label ?? entry.id,
            tier,
            tierNum: TIER_NUMBERS[tier] ?? 1,
            type: baseType,
            minCR: entry.minCR ?? 0,
            crLabel,
            img: resolveCreatureIcon(entry),
            art: entry.art ?? null,
            hasArt: Boolean(entry.art),
            flavour: unlocked ? (entry.flavour ?? "") : "",
            unlocked,
            audit,
            partyDiscovered,
            ingredients,
            recipes: unlocked && !hideEntryRecipes ? visibleRecipes : [],
            pendingPages,
            linkedRecipeCount: linked.length,
            cookableNow: visibleRecipes.some(r => r.canCook),
            searchBlob
        };
    });

    const labelMap = new Map(CreatureRegistry.all().map(e => [e.id, e.label ?? e.id]));
    for (const recipe of RecipeRegistry.all()) {
        const isInscribed = revealAll || (inscribedRecipes?.has(recipe.id) ?? false);
        if (!isInscribed) continue;
        const card = {
            ...mapRecipe(recipe, actor, isInscribed, {
                audit,
                partyInscribed: auditInscribed?.has(recipe.id) ?? false
            }),
            creatureLabel: recipeSourceLabel(recipe, labelMap),
            creatureId: null
        };
        recipeList.push(card);
        if (card.canCook) cookableRecipes.push(card);
    }

    const tiers = [...new Set(entries.map(e => e.tier))];
    const types = [...new Set(entries.map(e => e.type))];

    return {
        entries,
        tiers,
        types,
        crLabel,
        hasActor: Boolean(actor),
        totalCount: entries.length,
        unlockedCount: entries.filter(e => e.unlocked).length,
        cookableRecipes,
        recipeList: recipeList.sort((a, b) => {
            if (a.canCook !== b.canCook) return a.canCook ? -1 : 1;
            return a.name.localeCompare(b.name);
        }),
        inscribedCount: inscribedRecipes?.size ?? 0,
        recipeTotal: RecipeRegistry.all().length,
        audit,
        auditDiscoveredCount: entries.filter(e => e.partyDiscovered).length,
        auditInscribedCount: auditInscribed?.size ?? 0,
        hideEntryRecipes
    };
}
