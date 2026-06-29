import { SystemBridge } from "../compat/SystemBridge.js";
import { Library } from "../compat/Library.js";
import { GMRelay, decideEffectRoute } from "./GMRelay.js";
import { describePartyEffectParts, trackManuallyLines, SHARED_BUFF_SLOT } from "./MealBuffs.js";
import { MealBuffHandlers } from "../data/MealBuffHandlers.js";

const MODULE_ID = "ionrift-monstrous-feast";
const MEAL_EFFECT_FLAG = "mealEffect";

/** Kernel shared cooking-buff slot. Must mirror the library's flag constants. */
const SHARED_BUFF_NAMESPACE = "ionrift-library";
const SHARED_BUFF_FLAG = "cookingBuff";

/**
 * Whether a dnd5e rest result represents a completed long rest. The meal buff
 * is meant to last until the next long rest, so only a long rest clears it.
 * Handles both the boolean flag and the rest type the system reports.
 * @param {object} result The result payload from dnd5e.restCompleted.
 * @returns {boolean}
 */
export function isLongRestResult(result) {
    return result?.longRest === true || result?.type === "long";
}

/**
 * Standalone party meal effects for Monstrous Feast (no Respite dependency).
 */
export const MealEffects = {
    /**
     * @returns {Actor[]}
     */
    getPartyMembers() {
        const roster = game.ionrift?.library?.party?.getMembers?.();
        if (roster?.length) return roster.filter(actor => actor && !SystemBridge.isDead(actor));

        return game.actors.filter(actor =>
            actor.hasPlayerOwner
            && actor.type === "character"
            && !SystemBridge.isDead(actor)
        );
    },

    /**
     * @param {Actor} actor
     * @param {number} amount
     */
    async applyTempHP(actor, amount) {
        if (!amount || amount <= 0) return;
        const hp = actor?.system?.attributes?.hp;
        if (!hp) return;
        const currentTemp = Number(hp.temp ?? 0);
        await actor.update({ "system.attributes.hp.temp": currentTemp + amount });
    },

    /**
     * @param {object} partyEffect
     * @param {boolean} ambitious
     * @returns {string|null}
     */
    getTempFormula(partyEffect, ambitious = false) {
        if (!partyEffect) return null;
        return ambitious
            ? (partyEffect.ambitiousTempHP ?? partyEffect.tempHP ?? null)
            : (partyEffect.tempHP ?? null);
    },

    /**
     * @param {Actor} actor
     */
    async _clearMealEffects(actor) {
        const existing = actor.effects?.filter(effect =>
            effect.getFlag?.(MODULE_ID, MEAL_EFFECT_FLAG) === true
        ) ?? [];
        if (!existing.length) return;
        await actor.deleteEmbeddedDocuments("ActiveEffect", existing.map(effect => effect.id));
    },

    /**
     * Whether the actor already carries a meal buff this module would replace.
     * Covers the shared kernel cooking slot and, for older kernels, this
     * module's own legacy meal effect. Unrelated effects are ignored.
     * @param {Actor} actor
     * @returns {boolean}
     */
    hasMealEffect(actor) {
        return Boolean(actor?.effects?.some(effect =>
            effect.flags?.[SHARED_BUFF_NAMESPACE]?.[SHARED_BUFF_FLAG] === true
            || effect.getFlag?.(MODULE_ID, MEAL_EFFECT_FLAG) === true
        ));
    },

    /**
     * Party members whose active meal buff a new cook would replace. Used to warn
     * before a destructive overwrite. Only this module's effects count.
     * @returns {Actor[]}
     */
    membersWithMealEffect() {
        return this.getPartyMembers().filter(actor => this.hasMealEffect(actor));
    },

    /**
     * Whether a recipe's party effect produces a stacking-managed Active Effect
     * (as opposed to temp HP only, which is additive and never overwrites).
     * @param {object} partyEffect
     * @param {boolean} [ambitious]
     * @returns {boolean}
     */
    producesManagedBuff(partyEffect) {
        if (!partyEffect || SystemBridge.systemId() !== "dnd5e") return false;
        return MealBuffHandlers.producesManaged(partyEffect);
    },

    /**
     * Clear any prior meal effect, then write the new one. This is the
     * privileged step a GM performs on behalf of a player who does not own the
     * target actor. Both writes run together so the swap stays atomic on the
     * applying client.
     * @param {Actor} actor
     * @param {object} effectData
     */
    async _writeMealEffect(actor, effectData) {
        if (!actor?.createEmbeddedDocuments || !effectData?.changes?.length) return;
        await this._clearMealEffects(actor);
        await actor.createEmbeddedDocuments("ActiveEffect", [{
            ...effectData,
            flags: {
                ...(effectData.flags ?? {}),
                [MODULE_ID]: {
                    ...(effectData.flags?.[MODULE_ID] ?? {}),
                    [MEAL_EFFECT_FLAG]: true
                }
            }
        }]);
    },

    /**
     * Apply the managed meal effect, routing to a GM when the serving user does
     * not own the target actor. Returns the route taken so callers can omit a
     * report line when the write was blocked (no GM connected).
     * @param {Actor} actor
     * @param {object} effectData
     * @returns {Promise<"local"|"relay"|"blocked">}
     */
    async applyMealEffectRouted(actor, effectData) {
        const route = decideEffectRoute({
            isOwner: Boolean(actor?.isOwner),
            hasActiveGM: GMRelay.hasActiveGM()
        });
        if (route === "local") {
            await this._writeMealEffect(actor, effectData);
        } else if (route === "relay") {
            await GMRelay.applyMealEffect(actor?.uuid, effectData);
        }
        return route;
    },

    /**
     * Remove this module's meal buff from an actor, routing to a GM when the
     * caller does not own the target. Mirrors applyMealEffectRouted: a player
     * cannot delete effects on a party member they do not own, so the removal
     * relays to a connected GM, and no-ops when none is online. Returns "noop"
     * when the actor carries no meal buff to avoid pointless socket traffic.
     * @param {Actor} actor
     * @returns {Promise<"local"|"relay"|"blocked"|"noop">}
     */
    async removeMealEffectRouted(actor) {
        if (!actor || !this.hasMealEffect(actor)) return "noop";
        const route = decideEffectRoute({
            isOwner: Boolean(actor?.isOwner),
            hasActiveGM: GMRelay.hasActiveGM()
        });
        if (route === "local") {
            await this._clearMealEffects(actor);
        } else if (route === "relay") {
            await GMRelay.clearMealEffect(actor?.uuid);
        }
        return route;
    },

    /**
     * Primary expiry on dnd5e: clear the meal buff when an actor completes a
     * long rest. The fixed-duration fallback on the effect itself covers
     * systems or sessions where this hook never fires.
     * @param {Actor} actor
     * @param {object} result The dnd5e.restCompleted result payload.
     * @returns {Promise<"local"|"relay"|"blocked"|"noop">}
     */
    async onLongRestCompleted(actor, result) {
        if (SystemBridge.systemId() !== "dnd5e") return "noop";
        if (!isLongRestResult(result)) return "noop";
        return this.clearSharedSlot(actor);
    },

    /**
     * Clear the served meal buff. Routes through the kernel's shared cooking
     * slot when the abstraction is present; falls back to this module's own
     * routed removal on older kernels.
     * @param {Actor} actor
     * @returns {Promise<"local"|"relay"|"blocked"|"noop">}
     */
    async clearSharedSlot(actor) {
        if (!actor || !this.hasMealEffect(actor)) return "noop";
        const cooking = Library.cooking;
        if (cooking?.feed?.clearSlot) {
            return cooking.feed.clearSlot(actor, { slot: SHARED_BUFF_SLOT });
        }
        return this.removeMealEffectRouted(actor);
    },

    /**
     * Whether serving the party needs a GM who is not connected. True only when
     * a player serves, no GM is online, and at least one party member is an
     * actor that player does not own (so its meal writes cannot resolve).
     * @returns {boolean}
     */
    serveNeedsAbsentGM() {
        if (game.user?.isGM) return false;
        if (GMRelay.hasActiveGM()) return false;
        return this.getPartyMembers().some(actor => !actor?.isOwner);
    },

    /**
     * dnd5e Active Effect changes for a recipe's party effect, gathered from the
     * registered buff handlers. Empty off dnd5e.
     * @param {object} partyEffect
     * @param {boolean} [ambitious]
     * @returns {object[]}
     */
    _buildDnd5eChanges(partyEffect, ambitious = false) {
        if (SystemBridge.systemId() !== "dnd5e") return [];
        return MealBuffHandlers.changes(partyEffect, ambitious);
    },

    /**
     * Build DAE flags and charge metadata for managed buffs.
     * @param {Actor} actor
     * @param {object} partyEffect
     * @param {boolean} ambitious
     * @returns {Promise<{ daeSpecial: string[], libFlags: object, chargeLines: string[] }>}
     */
    async _buildBuffFlags(actor, partyEffect, ambitious) {
        const buffs = MealBuffHandlers.buffs(partyEffect, ambitious);
        const cookingBuffs = Library.cooking?.buffs;
        const daeSpecial = [];
        const libFlags = {};
        const chargeLines = [];

        for (const buff of buffs) {
            const built = cookingBuffs?.build?.(actor, buff) ?? null;
            if (built?.daeSpecialDuration?.length) daeSpecial.push(...built.daeSpecialDuration);

            if (buff.type === "save_bonus" && buff.uses && globalThis.Roll) {
                const roll = await new Roll(String(buff.uses)).evaluate();
                const charges = Math.max(1, roll.total);
                libFlags.chargesRemaining = charges;
                libFlags.chargesMax = charges;
                const ability = String(buff.save?.ability ?? "con").toUpperCase();
                chargeLines.push(`+${buff.bonus ?? 1} ${ability} saves (${charges} remaining)`);
                daeSpecial.push(`isSave.${String(buff.save?.ability ?? "con").toLowerCase()}`);
            }

            if (buff.type === "advantage" && buff.duration === "nextSave") {
                const ability = String(buff.save?.ability ?? buff.ability ?? "con").toLowerCase();
                daeSpecial.push(`isSave.${ability}`);
            }
        }

        return {
            daeSpecial: [...new Set(daeSpecial)],
            libFlags,
            chargeLines
        };
    },

    /**
     * @param {Actor} actor
     * @param {object} partyEffect
     * @param {boolean} ambitious
     * @param {string} [mealName] Short dish name used as the effect title.
     * @returns {Promise<string[]>}
     */
    async _applyBuffEffects(actor, partyEffect, ambitious, mealName = "") {
        const lines = [];
        const changes = this._buildDnd5eChanges(partyEffect, ambitious);
        if (!changes.length) return lines;

        // Fallback expiry only. On dnd5e the long-rest hook clears the buff;
        // this bounds the effect if that signal never arrives.
        const seconds = 28800;

        const parts = describePartyEffectParts(partyEffect, ambitious);
        const { daeSpecial, libFlags, chargeLines } = await this._buildBuffFlags(actor, partyEffect, ambitious);
        if (chargeLines.length) parts.push(...chargeLines);

        const flags = {
            [MODULE_ID]: { [MEAL_EFFECT_FLAG]: true },
            [SHARED_BUFF_NAMESPACE]: {
                [SHARED_BUFF_FLAG]: true,
                ...libFlags
            }
        };
        if (daeSpecial.length) {
            flags.dae = { specialDuration: daeSpecial };
        }

        const title = mealName ? `Monstrous Feast: ${mealName}` : "Monstrous Feast";
        const route = await this.applyMealEffectRouted(actor, {
            name: title,
            icon: "icons/consumables/food/bowl-stew-brown.webp",
            description: `<p>${parts.join(", ")}.</p>`,
            origin: actor.uuid,
            disabled: false,
            duration: { seconds },
            changes,
            flags
        });

        if (route !== "blocked") lines.push(`${actor.name}: ${parts.join("; ")}`);
        return lines;
    },

    /**
     * @param {object} partyEffect
     * @param {boolean} ambitious
     * @param {object} [opts]
     * @param {string} [opts.mealName] Short dish name used as the effect title.
     * @returns {Promise<string[]>}
     */
    async applyPartyEffect(partyEffect, ambitious = false, { mealName = "" } = {}) {
        if (!partyEffect) return [];
        const members = this.getPartyMembers();
        const lines = [];

        const canApplyEffects = SystemBridge.systemId() === "dnd5e"
            && this._buildDnd5eChanges(partyEffect, ambitious).length > 0;

        if (canApplyEffects) {
            for (const member of members) {
                const buffLines = await this._applyBuffEffects(member, partyEffect, ambitious, mealName);
                lines.push(...buffLines);
            }
        } else {
            lines.push(...trackManuallyLines(partyEffect, ambitious));
        }

        return lines;
    }
};
