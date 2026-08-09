const VALID_TIERS = new Set(["common", "uncommon", "rare", "legendary"]);
const VALID_SKILLS = new Set(["sur", "survival"]);
const PARTY_EFFECT_KEYS = new Set([
    "tempHP",
    "ambitiousTempHP",
    "strengthAdvantage",
    "darkvisionFeet",
    "poisonResistance",
    "passivePerceptionBonus",
    "wisdomBonus",
    "conSaveAdvantage",
    "wisSaveAdvantage",
    "conSaveBonus"
]);

export const HOMEBREW_LIMITS = Object.freeze({
    maxCreatures: 50,
    maxRecipes: 50
});

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {string} path
 * @param {string} message
 * @returns {string}
 */
function err(path, message) {
    return `${path}: ${message}`;
}

/**
 * @param {string} path
 * @param {unknown} list
 * @returns {string[]}
 */
function validateYieldTier(path, list) {
    const errors = [];
    if (list === undefined) return errors;
    if (!Array.isArray(list)) {
        errors.push(err(path, "must be an array"));
        return errors;
    }
    list.forEach((item, index) => {
        const itemPath = `${path}[${index}]`;
        if (!isPlainObject(item)) {
            errors.push(err(itemPath, "must be an object"));
            return;
        }
        if (!item.name || typeof item.name !== "string") {
            errors.push(err(itemPath, "needs a name string"));
        }
        if (item.qty !== undefined && Number.isNaN(Number(item.qty))) {
            errors.push(err(itemPath, "qty must be a number"));
        }
    });
    return errors;
}

/**
 * @param {string} id
 * @param {object} entry
 * @returns {string[]}
 */
export function validateCreature(id, entry) {
    const errors = [];
    const path = `creatures.${id}`;

    if (!id || typeof id !== "string") {
        errors.push(err("creatures", "each creature needs a string id"));
        return errors;
    }
    if (!isPlainObject(entry)) {
        errors.push(err(path, "must be an object"));
        return errors;
    }
    if (!entry.label || typeof entry.label !== "string") {
        errors.push(err(path, "needs a label string"));
    }
    if (entry.tier !== undefined && !VALID_TIERS.has(entry.tier)) {
        errors.push(err(path, `tier must be one of ${[...VALID_TIERS].join(", ")}`));
    }
    if (entry.minCR !== undefined && Number.isNaN(Number(entry.minCR))) {
        errors.push(err(path, "minCR must be a number"));
    }

    errors.push(...validateYieldTier(`${path}.basic`, entry.basic));
    errors.push(...validateYieldTier(`${path}.standard`, entry.standard));
    errors.push(...validateYieldTier(`${path}.exceptional`, entry.exceptional));

    if (entry.mishap !== undefined && !isPlainObject(entry.mishap)) {
        errors.push(err(`${path}.mishap`, "must be an object"));
    }

    return errors;
}

/**
 * @param {object} recipe
 * @param {number} index
 * @returns {string[]}
 */
export function validateRecipe(recipe, index = 0) {
    const errors = [];
    const path = recipe?.id ? `recipes.${recipe.id}` : `recipes[${index}]`;

    if (!isPlainObject(recipe)) {
        errors.push(err(path, "must be an object"));
        return errors;
    }
    if (!recipe.id || typeof recipe.id !== "string") {
        errors.push(err(path, "needs an id string"));
    }
    if (!recipe.name || typeof recipe.name !== "string") {
        errors.push(err(path, "needs a name string"));
    }
    if (recipe.dc !== undefined && Number.isNaN(Number(recipe.dc))) {
        errors.push(err(path, "dc must be a number"));
    }
    if (recipe.skill !== undefined && !VALID_SKILLS.has(recipe.skill)) {
        errors.push(err(path, "skill must be sur or survival"));
    }
    if (recipe.linkedCreatures !== undefined && !Array.isArray(recipe.linkedCreatures)) {
        errors.push(err(path, "linkedCreatures must be an array"));
    }
    if (!Array.isArray(recipe.ingredients)) {
        errors.push(err(path, "ingredients must be an array"));
    } else {
        recipe.ingredients.forEach((ing, ingIndex) => {
            const ingPath = `${path}.ingredients[${ingIndex}]`;
            if (!isPlainObject(ing)) {
                errors.push(err(ingPath, "must be an object"));
                return;
            }
            if (!ing.name || typeof ing.name !== "string") {
                errors.push(err(ingPath, "needs a name string"));
            }
            if (ing.quantity !== undefined && Number.isNaN(Number(ing.quantity))) {
                errors.push(err(ingPath, "quantity must be a number"));
            }
        });
    }
    if (!isPlainObject(recipe.output)) {
        errors.push(err(path, "output must be an object"));
    } else if (!recipe.output.name || typeof recipe.output.name !== "string") {
        errors.push(err(`${path}.output`, "needs a name string"));
    }
    if (recipe.ambitiousOutput !== undefined && !isPlainObject(recipe.ambitiousOutput)) {
        errors.push(err(`${path}.ambitiousOutput`, "must be an object"));
    }
    if (recipe.partyEffect !== undefined) {
        if (!isPlainObject(recipe.partyEffect)) {
            errors.push(err(`${path}.partyEffect`, "must be an object"));
        } else {
            for (const key of Object.keys(recipe.partyEffect)) {
                if (!PARTY_EFFECT_KEYS.has(key)) {
                    errors.push(err(`${path}.partyEffect.${key}`, "unknown buff key"));
                }
            }
        }
    }

    return errors;
}

/**
 * Normalize imported JSON into the world-store shape.
 * Accepts a full store, a flat creature map, or a recipes-only file.
 * @param {unknown} parsed
 * @returns {{ creatures: object, recipes: object[] }|null}
 */
export function normalizeImportPayload(parsed) {
    if (!isPlainObject(parsed)) return null;

    if (parsed.creatures !== undefined || parsed.recipes !== undefined) {
        return {
            creatures: isPlainObject(parsed.creatures) ? parsed.creatures : {},
            recipes: Array.isArray(parsed.recipes) ? parsed.recipes : []
        };
    }

    const clone = { ...parsed };
    delete clone._meta;
    if (Object.keys(clone).length) {
        return { creatures: clone, recipes: [] };
    }

    return null;
}

/**
 * Drop invalid entries and enforce caps. Returns sanitized store plus diagnostics.
 * @param {{ creatures?: object, recipes?: object[] }} data
 * @returns {{ sanitized: { creatures: object, recipes: object[] }, errors: string[], dropped: { creatures: number, recipes: number } }}
 */
export function sanitizeHomebrew(data = {}) {
    const errors = [];
    const sanitized = { creatures: {}, recipes: [] };
    const dropped = { creatures: 0, recipes: 0 };

    const creatures = isPlainObject(data.creatures) ? data.creatures : {};
    for (const [id, entry] of Object.entries(creatures)) {
        const entryErrors = validateCreature(id, entry);
        if (entryErrors.length) {
            errors.push(...entryErrors);
            dropped.creatures++;
            continue;
        }
        sanitized.creatures[id] = foundry.utils.deepClone(entry);
    }

    const recipes = Array.isArray(data.recipes) ? data.recipes : [];
    const seenRecipeIds = new Set();
    recipes.forEach((recipe, index) => {
        const recipeErrors = validateRecipe(recipe, index);
        if (recipeErrors.length) {
            errors.push(...recipeErrors);
            dropped.recipes++;
            return;
        }
        if (seenRecipeIds.has(recipe.id)) {
            errors.push(err(`recipes.${recipe.id}`, "duplicate id dropped"));
            dropped.recipes++;
            return;
        }
        seenRecipeIds.add(recipe.id);
        sanitized.recipes.push(foundry.utils.deepClone(recipe));
    });

    const creatureIds = Object.keys(sanitized.creatures);
    if (creatureIds.length > HOMEBREW_LIMITS.maxCreatures) {
        const overflow = creatureIds.splice(HOMEBREW_LIMITS.maxCreatures);
        overflow.forEach(id => {
            delete sanitized.creatures[id];
            dropped.creatures++;
            errors.push(err(`creatures.${id}`, `dropped (limit ${HOMEBREW_LIMITS.maxCreatures})`));
        });
    }

    if (sanitized.recipes.length > HOMEBREW_LIMITS.maxRecipes) {
        const overflow = sanitized.recipes.splice(HOMEBREW_LIMITS.maxRecipes);
        dropped.recipes += overflow.length;
        overflow.forEach(recipe => {
            errors.push(err(`recipes.${recipe.id}`, `dropped (limit ${HOMEBREW_LIMITS.maxRecipes})`));
        });
    }

    return { sanitized, errors, dropped };
}

/**
 * @param {{ creatures?: object, recipes?: object[] }} data
 * @returns {{ valid: boolean, errors: string[], sanitized: { creatures: object, recipes: object[] }, dropped: { creatures: number, recipes: number } }}
 */
export function validateHomebrewStore(data) {
    const { sanitized, errors, dropped } = sanitizeHomebrew(data);
    const hasContent = Object.keys(sanitized.creatures).length > 0 || sanitized.recipes.length > 0;
    const fatal = errors.some(line => line.includes("needs an id") || line.includes("must be an object"));
    return {
        valid: hasContent || errors.length === 0,
        errors,
        sanitized,
        dropped,
        fatal
    };
}
