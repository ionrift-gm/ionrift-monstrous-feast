import { SystemBridge } from "../compat/SystemBridge.js";
import { CoreIcons } from "../data/CoreIcons.js";

const MODULE_ID = "ionrift-monstrous-feast";
const RESPITE_ID = "ionrift-respite";

const TIER_RARITY = {
    common: "common",
    uncommon: "uncommon",
    rare: "rare",
    legendary: "legendary"
};

function resolveIcon(y) {
    if (y.type === "loot") return CoreIcons.hide;
    if (y.foodTag === "essence") return CoreIcons.gem;
    if (y.foodTag === "plant") return CoreIcons.mushroom;
    return CoreIcons.rawMeat;
}

function respiteActive() {
    return !!game.modules.get(RESPITE_ID)?.active;
}

function buildRespiteFlags(y) {
    if (!respiteActive()) return {};
    const respite = { monsterIngredient: true };
    if (y.foodTag) respite.foodTag = y.foodTag;
    if (y.spoilsAfter) {
        respite.spoilsAfter = y.spoilsAfter;
        respite.harvestedDate = String(game.time?.worldTime ?? 0);
    }
    return { [RESPITE_ID]: respite };
}

/**
 * Build a createEmbeddedDocuments payload for one butcher yield row.
 * @param {object} y
 * @param {string} creatureName
 * @param {string} tier
 * @param {number} [quantity]
 * @returns {object}
 */
export function buildYieldItemData(y, creatureName, tier, quantity = 1) {
    const sys = SystemBridge.systemId();
    const rarity = TIER_RARITY[tier] ?? "common";
    const isLoot = y.type === "loot";
    const qty = Math.max(1, Number(quantity) || 1);
    const base = {
        name: y.name,
        img: resolveIcon(y),
        flags: {
            [MODULE_ID]: {
                monsterIngredient: true,
                ...(y.foodTag ? { foodTag: y.foodTag } : {}),
                ...(y.spoilsAfter ? { spoilsAfter: y.spoilsAfter } : {})
            },
            ...buildRespiteFlags(y)
        }
    };

    if (sys === "pf2e") {
        return {
            ...base,
            type: isLoot ? "equipment" : "consumable",
            system: {
                description: { value: `<p>Butchered from ${creatureName}.</p>` },
                traits: { rarity },
                ...(isLoot ? {} : {
                    category: "other",
                    uses: { value: qty, max: qty, autoDestroy: false }
                })
            }
        };
    }

    return {
        ...base,
        type: isLoot ? "loot" : "consumable",
        system: {
            description: { value: `<p>Butchered from ${creatureName}.</p>` },
            rarity,
            quantity: qty,
            ...(isLoot ? {} : { type: { value: "food", subtype: "" } })
        }
    };
}

/**
 * @param {Item} existing
 * @param {object} payload
 * @returns {boolean}
 */
function canStackYield(existing, payload) {
    if (!existing || existing.name !== payload.name) return false;
    if (existing.type !== payload.type) return false;
    return existing.getFlag?.(MODULE_ID, "monsterIngredient") === true;
}

/**
 * @param {Actor} actor
 * @param {object[]} yields
 * @param {string} creatureName
 * @param {string} tier
 * @returns {Promise<Item[]>}
 */
export async function grantYields(actor, yields, creatureName, tier) {
    if (!actor || !yields?.length) return [];

    const aggregated = new Map();
    for (const y of yields) {
        const qty = Math.max(1, Number(y.qty) || 1);
        const key = `${y.name}|${y.type ?? "food"}`;
        const row = aggregated.get(key);
        if (row) row.qty += qty;
        else aggregated.set(key, { ...y, qty });
    }

    const toCreate = [];
    const toUpdate = [];
    const results = [];

    for (const y of aggregated.values()) {
        const payload = buildYieldItemData(y, creatureName, tier, y.qty);
        const existing = actor.items.find(item => canStackYield(item, payload));

        if (existing) {
            const currentQty = Number(existing.system?.quantity ?? 1);
            toUpdate.push({
                _id: existing.id,
                "system.quantity": currentQty + y.qty
            });
            results.push(existing);
        } else {
            toCreate.push(payload);
        }
    }

    if (toUpdate.length) {
        const updated = await actor.updateEmbeddedDocuments("Item", toUpdate);
        results.push(...updated);
    }
    if (toCreate.length) {
        const created = await actor.createEmbeddedDocuments("Item", toCreate);
        results.push(...created);
    }

    const summary = [...aggregated.values()]
        .map(row => `${row.qty}x ${row.name}`)
        .join(", ");
    ui.notifications.info(`Monstrous Feast: ${summary} added to ${actor.name}.`);

    return results;
}
