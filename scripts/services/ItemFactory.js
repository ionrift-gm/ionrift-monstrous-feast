import { SystemBridge } from "../compat/SystemBridge.js";
import { RespiteIntegration } from "../compat/RespiteIntegration.js";
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
    return RespiteIntegration.isActive();
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

function mergeYieldFlags(canonicalFlags, y) {
    const mfModuleFlags = {
        monsterIngredient: true,
        ...(y.foodTag ? { foodTag: y.foodTag } : {}),
        ...(y.spoilsAfter ? { spoilsAfter: y.spoilsAfter } : {})
    };
    return foundry.utils.mergeObject(
        foundry.utils.deepClone(canonicalFlags ?? {}),
        {
            [MODULE_ID]: mfModuleFlags,
            ...buildRespiteFlags(y)
        },
        { inplace: false }
    );
}

function stripCompendiumMetadata(itemData) {
    const payload = foundry.utils.deepClone(itemData);
    delete payload._id;
    delete payload.folder;
    delete payload.ownership;
    delete payload.sort;
    delete payload._key;
    return payload;
}

/**
 * Resolve a pack-canonical provision item when Respite is active.
 * @param {object} y
 * @returns {Promise<object|null>}
 */
async function resolveYieldCanonical(y) {
    if (!respiteActive()) return null;
    try {
        const { ItemOutcomeHandler } = await import(
            "/modules/ionrift-respite/scripts/services/ItemOutcomeHandler.js"
        );
        return await ItemOutcomeHandler.resolveProvisionItem({
            itemRef: y.itemRef,
            name: y.name
        });
    } catch {
        return null;
    }
}

/**
 * Build a createEmbeddedDocuments payload for one butcher yield row.
 * When `canonical` is provided, pack art/description/identity win; MF merges
 * mechanical flags only (see ITEM_IDENTITY_POLICY.md).
 * @param {object} y
 * @param {string} creatureName
 * @param {string} tier
 * @param {number} [quantity]
 * @param {object|null} [canonical]
 * @returns {object}
 */
export function buildYieldItemData(y, creatureName, tier, quantity = 1, canonical = null) {
    const sys = SystemBridge.systemId();
    const rarity = TIER_RARITY[tier] ?? "common";
    const isLoot = canonical ? canonical.type === "loot" : y.type === "loot";
    const qty = Math.max(1, Number(quantity) || 1);

    if (canonical) {
        const payload = stripCompendiumMetadata(canonical);
        payload.flags = mergeYieldFlags(payload.flags, y);
        payload.system = foundry.utils.mergeObject(
            payload.system ?? {},
            { quantity: qty },
            { inplace: false }
        );
        if (sys === "pf2e" && payload.type === "consumable" && !isLoot) {
            payload.system.uses = payload.system.uses ?? {
                value: qty,
                max: qty,
                autoDestroy: false
            };
        }
        return payload;
    }

    const base = {
        name: y.name,
        img: resolveIcon(y),
        flags: mergeYieldFlags({}, y)
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

function yieldAggregateKey(y) {
    return `${y.itemRef ?? y.name}|${y.type ?? "food"}`;
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
        const key = yieldAggregateKey(y);
        const row = aggregated.get(key);
        if (row) row.qty += qty;
        else aggregated.set(key, { ...y, qty });
    }

    const resolvedRows = await Promise.all(
        [...aggregated.values()].map(async (y) => {
            const canonical = await resolveYieldCanonical(y);
            const payload = buildYieldItemData(y, creatureName, tier, y.qty, canonical);
            return { y, payload, displayName: payload.name ?? y.name };
        })
    );

    if (respiteActive()) {
        const { ItemOutcomeHandler } = await import(
            "/modules/ionrift-respite/scripts/services/ItemOutcomeHandler.js"
        );
        const grants = resolvedRows.map(({ y, payload }) => ({
            name: payload.name,
            type: payload.type,
            img: payload.img,
            quantity: payload.system?.quantity ?? y.qty,
            system: payload.system,
            flags: payload.flags
        }));
        await ItemOutcomeHandler.grantItemsToActor(actor, grants);
        const summary = resolvedRows
            .map(row => `${row.y.qty}x ${row.displayName}`)
            .join(", ");
        ui.notifications.info(`Monstrous Feast: ${summary} added to ${actor.name}.`);
        return actor.items.filter(i => i.getFlag?.(MODULE_ID, "monsterIngredient"));
    }

    const toCreate = [];
    const toUpdate = [];
    const results = [];

    for (const { y, payload } of resolvedRows) {
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

    const summary = resolvedRows
        .map(row => `${row.y.qty}x ${row.displayName}`)
        .join(", ");
    ui.notifications.info(`Monstrous Feast: ${summary} added to ${actor.name}.`);

    return results;
}
