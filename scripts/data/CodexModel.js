import { CreatureRegistry } from "./CreatureRegistry.js";
import { RecipeRegistry } from "./RecipeRegistry.js";
import { CookEngine } from "../engine/CookEngine.js";
import { countIngredient, findAvailable } from "../services/IngredientMatcher.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { CoreIcons } from "./CoreIcons.js";
import { resolveIngredientIcon } from "./IngredientIcons.js";
import { MealBuffHandlers } from "./MealBuffHandlers.js";

const TYPE_ICONS = {
    beast: CoreIcons.bear,
    monstrosity: CoreIcons.monstrosity,
    aberration: CoreIcons.aberration,
    dragon: CoreIcons.dragon
};

const YIELD_TIERS = ["basic", "standard", "exceptional"];

const TIER_NUMBERS = { common: 1, uncommon: 2, rare: 3, legendary: 4 };

/** Parent registry ids shown under "Cooking methods", not creature cuts. */
export const METHOD_CATEGORY_IDS = new Set(["beast", "monstrosity"]);

/** Codex scroll sections (fixed order: methods, then creature cuts). */
export const CODEX_SECTION_DEFS = [
    {
        id: "methods",
        kind: "methods",
        title: "Cooking methods",
        subtitle: "Monster Meat or pantry staples. Generic meals for any matching cut."
    },
    {
        id: "creatures",
        kind: "creatures",
        title: "Creature cuts",
        subtitle: "Named quarry and signature house recipes."
    }
];

/** Recipes tab sections (Living Cookbook). Pantry staples share the methods band. */
export const RECIPE_LIST_SECTION_DEFS = [
    {
        id: "methods",
        title: "Cooking methods",
        subtitle: "Generic meals and pantry staples. Butcher matching quarry to unlock."
    },
    {
        id: "signatures",
        title: "Signature dishes",
        subtitle: "House recipes for a specific creature. Log that quarry first."
    }
];

/**
 * Recipes tab grouping: typed creature links are signatures; everything else
 * (method meals and pantry staples like Camp Bread) sits under methods.
 * @param {object} recipe
 * @returns {"methods"|"signatures"}
 */
export function recipeListSection(recipe) {
    const typedLinks = (recipe.linkedCreatures ?? []).filter(id => !METHOD_CATEGORY_IDS.has(id));
    return typedLinks.length ? "signatures" : "methods";
}

function sortRecipeCards(list) {
    return [...list].sort((left, right) => {
        if (left.canCook !== right.canCook) return left.canCook ? -1 : 1;
        return left.name.localeCompare(right.name);
    });
}

/**
 * Method category cards unlock when any butchered quarry shares the parent type
 * (e.g. beast_ursine unlocks the beast methods card, not the beast fallback entry).
 * @param {string} methodId
 * @param {Set<string>|null} discoveredCreatures
 * @returns {boolean}
 */
export function isMethodCategoryUnlocked(methodId, discoveredCreatures) {
    if (!METHOD_CATEGORY_IDS.has(methodId) || !discoveredCreatures?.size) return false;
    if (discoveredCreatures.has(methodId)) return true;
    for (const id of discoveredCreatures) {
        if (id !== methodId && id.split("_")[0] === methodId) return true;
    }
    return false;
}

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
 * Human-readable buff summary from a recipe partyEffect. Display only. Driven by
 * the registered buff handlers, so an overlay buff surfaces on the card without
 * a code change here; unknown keys are logged once and skipped.
 * @param {object} recipe
 * @returns {string[]}
 */
function buffSummary(recipe) {
    return MealBuffHandlers.summaries(recipe.partyEffect ?? {});
}

/**
 * Whether an inscribed recipe is unlocked for cooking based on party discoveries.
 * Pantry recipes (no links) are always unlocked. Typed links need that quarry.
 * Method links need the parent method category unlocked.
 * @param {object} recipe
 * @param {Set<string>|null} discoveredCreatures
 * @param {boolean} [revealAll]
 * @returns {boolean}
 */
export function isRecipeDiscoveryUnlocked(recipe, discoveredCreatures, revealAll = false) {
    if (revealAll) return true;
    const links = recipe.linkedCreatures ?? [];
    if (!links.length) return true;
    const discovered = discoveredCreatures ?? new Set();
    const typedLinks = links.filter(id => !METHOD_CATEGORY_IDS.has(id));
    if (typedLinks.length) {
        return typedLinks.some(id => discovered.has(id));
    }
    return links.some(id => isMethodCategoryUnlocked(id, discovered));
}

/**
 * @param {object} recipe
 * @param {Map<string,string>} labelMap
 * @returns {string|null}
 */
function recipeLockReason(recipe, labelMap) {
    const links = recipe.linkedCreatures ?? [];
    if (!links.length) return null;
    const typedLinks = links.filter(id => !METHOD_CATEGORY_IDS.has(id));
    if (typedLinks.length === 1) {
        const name = labelMap.get(typedLinks[0]) ?? typedLinks[0];
        return `Butcher ${name} to unlock`;
    }
    const methodLinks = links.filter(id => METHOD_CATEGORY_IDS.has(id));
    if (methodLinks.length === 1) {
        const label = (labelMap.get(methodLinks[0]) ?? methodLinks[0]).toLowerCase();
        return `Butcher a ${label} to unlock`;
    }
    if (methodLinks.includes("beast") && methodLinks.includes("monstrosity")) {
        return "Butcher a beast or monstrosity to unlock";
    }
    return "Butcher matching quarry to unlock";
}

/**
 * @param {object} recipe
 * @param {Map<string,string>} labelMap
 * @returns {string|null}
 */
function recipeMethodFamily(recipe, labelMap) {
    const methodLinks = (recipe.linkedCreatures ?? []).filter(id => METHOD_CATEGORY_IDS.has(id));
    if (!methodLinks.length) return null;
    if (methodLinks.length === 1) {
        const label = labelMap.get(methodLinks[0]) ?? methodLinks[0];
        return `${label} methods`;
    }
    return "Beast & monstrosity methods";
}

/**
 * Short "from ..." source for a recipe card in the Recipes tab.
 * @param {object} recipe
 * @param {Map<string,string>} labelMap
 * @returns {string}
 */
function recipeSourceLabel(recipe, labelMap) {
    const links = recipe.linkedCreatures ?? [];
    const typedLinks = links.filter(id => !METHOD_CATEGORY_IDS.has(id));
    const methodLinks = links.filter(id => METHOD_CATEGORY_IDS.has(id));

    if (typedLinks.length === 1) {
        return labelMap.get(typedLinks[0]) ?? typedLinks[0];
    }
    if (typedLinks.length > 1) return "various creatures";
    if (!methodLinks.length) return "the pantry";

    if (methodLinks.length === 1) {
        const label = (labelMap.get(methodLinks[0]) ?? methodLinks[0]).toLowerCase();
        return `any ${label} cut`;
    }
    if (methodLinks.includes("beast") && methodLinks.includes("monstrosity")) {
        return "any beast or monstrosity cut";
    }
    return "any matching cut";
}

function mapRecipe(recipe, actor, inscribed, {
    audit = false,
    partyInscribed = false,
    discoveryUnlocked = true,
    labelMap = null,
    lockReason = null,
    methodFamily = null
} = {}) {
    const check = actor
        ? CookEngine.checkIngredients(actor, recipe)
        : { ok: false, missing: [] };
    const ingredientStatus = (recipe.ingredients ?? []).map(ing => {
        const need = Math.max(1, Number(ing.quantity) || 1);
        const have = actor ? countIngredient(actor, ing) : 0;
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
        canCook: inscribed && check.ok && discoveryUnlocked,
        missing: check.missing.join(", "),
        cookTooltip: !inscribed
            ? "Inscribe this recipe first"
            : (!discoveryUnlocked
                ? (lockReason ?? "Butcher matching quarry first")
                : (!check.ok ? `Missing: ${check.missing.join(", ")}` : `Cook ${recipe.name}`)),
        discoveryUnlocked,
        lockReason,
        methodFamily,
        creatureLabel: labelMap ? recipeSourceLabel(recipe, labelMap) : "",
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
        const isMethodCategory = METHOD_CATEGORY_IDS.has(entry.id);
        const unlocked = revealAll
            || (discoveredCreatures?.has(entry.id) ?? false)
            || (isMethodCategory && isMethodCategoryUnlocked(entry.id, discoveredCreatures));
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
        const tier = entry.tier ?? "common";
        const codexSection = isMethodCategory ? "methods" : "creatures";
        const cardLabel = isMethodCategory
            ? `${entry.label ?? entry.id} methods`
            : (entry.label ?? entry.id);
        const searchBlob = unlocked
            ? [
                entry.label ?? entry.id,
                cardLabel,
                isMethodCategory ? "cooking methods generic" : "",
                baseType,
                ...ingredients.map(i => i.name),
                ...visibleRecipes.map(r => r.name)
            ].join(" ").toLowerCase()
            : "";

        return {
            id: entry.id,
            label: entry.label ?? entry.id,
            cardLabel,
            codexSection,
            isMethodCategory,
            recipeSectionTitle: isMethodCategory ? "Methods" : "Signature recipes",
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
        const discoveryUnlocked = isRecipeDiscoveryUnlocked(recipe, discoveredCreatures, revealAll);
        const card = {
            ...mapRecipe(recipe, actor, isInscribed, {
                audit,
                partyInscribed: auditInscribed?.has(recipe.id) ?? false,
                discoveryUnlocked,
                labelMap,
                lockReason: discoveryUnlocked ? null : recipeLockReason(recipe, labelMap),
                methodFamily: recipeMethodFamily(recipe, labelMap)
            }),
            listSection: recipeListSection(recipe)
        };
        recipeList.push(card);
        if (card.canCook) cookableRecipes.push(card);
    }

    const sortedRecipeList = sortRecipeCards(recipeList);
    const recipeSections = RECIPE_LIST_SECTION_DEFS
        .map(def => ({
            ...def,
            recipes: sortedRecipeList.filter(card => card.listSection === def.id)
        }))
        .filter(section => section.recipes.length > 0);

    const tiers = [...new Set(entries.map(e => e.tier))];
    const types = [...new Set(entries.map(e => e.type))];

    const displayEntries = hideEntryRecipes
        ? entries.filter(entry => !entry.isMethodCategory)
        : entries;

    const sections = CODEX_SECTION_DEFS
        .map(def => ({
            ...def,
            entries: displayEntries.filter(entry => entry.codexSection === def.id)
        }))
        .filter(section => section.entries.length > 0);

    return {
        entries: displayEntries,
        sections,
        tiers,
        types,
        crLabel,
        hasActor: Boolean(actor),
        totalCount: displayEntries.length,
        unlockedCount: displayEntries.filter(e => e.unlocked).length,
        cookableRecipes,
        recipeList: sortedRecipeList,
        recipeSections,
        inscribedCount: inscribedRecipes?.size ?? 0,
        recipeTotal: RecipeRegistry.all().length,
        audit,
        auditDiscoveredCount: entries.filter(e => e.partyDiscovered).length,
        auditInscribedCount: auditInscribed?.size ?? 0,
        hideEntryRecipes
    };
}
