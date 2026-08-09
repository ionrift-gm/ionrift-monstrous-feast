import { SystemBridge } from "../../compat/SystemBridge.js";
import { Library } from "../../compat/Library.js";
import { GMRelay, decideEffectRoute } from "../GMRelay.js";
import { describePartyEffectParts, trackManuallyLines, SHARED_BUFF_SLOT } from "./MealBuffs.js";
import { MealBuffHandlers } from "./MealBuffHandlers.js";
import { MODULE_ID } from "../../data/moduleId.js";
import { Logger } from "../../lib/Logger.js";
const MEAL_EFFECT_FLAG = "mealEffect";

/** Kernel shared cooking-buff slot. Must mirror the library's flag constants. */
const SHARED_BUFF_NAMESPACE = "ionrift-library";
const SHARED_BUFF_FLAG = "cookingBuff";

/** Mirror `CookingBuffs.LONG_REST_FALLBACK_SECONDS` / `SHORT_REST_FALLBACK_SECONDS`. */
const LONG_REST_FALLBACK_SECONDS = 28800;
const SHORT_REST_FALLBACK_SECONDS = 4 * 3600;

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
 * Whether a dnd5e rest result represents a completed short rest.
 * @param {object} result
 * @returns {boolean}
 */
export function isShortRestResult(result) {
    return result?.shortRest === true || result?.type === "short";
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
     * @param {{ actor?: Actor, actorUuid?: string, effectData?: object }} data
     */
    async applyRelayedEffect(data) {
        const actor = data.actor ?? (data.actorUuid ? await fromUuid(data.actorUuid) : null);
        if (!actor) {
            Logger.warn(`MealEffects: actor not found for ${data.actorUuid}.`);
            return;
        }
        await this._writeMealEffect(actor, data.effectData);
    },

    /**
     * @param {{ actor?: Actor, actorUuid?: string }} data
     */
    async clearRelayedEffect(data) {
        const actor = data.actor ?? (data.actorUuid ? await fromUuid(data.actorUuid) : null);
        if (!actor) {
            Logger.warn(`MealEffects: actor not found for ${data.actorUuid}.`);
            return;
        }
        await this._clearMealEffects(actor);
    },

    /**
     * @param {Actor} actor
     */
    async _clearMealEffects(actor) {
        const existing = actor.effects?.filter(effect =>
            effect.getFlag?.(MODULE_ID, MEAL_EFFECT_FLAG) === true
        ) ?? [];
        if (existing.length) {
            await actor.deleteEmbeddedDocuments("ActiveEffect", existing.map(effect => effect.id));
        }

        const cookingItems = actor.items?.filter(item =>
            item.getFlag?.(MODULE_ID, MEAL_EFFECT_FLAG) === true
            || item.flags?.[SHARED_BUFF_NAMESPACE]?.[SHARED_BUFF_FLAG] === true
        ) ?? [];
        if (cookingItems.length) {
            await actor.deleteEmbeddedDocuments("Item", cookingItems.map(item => item.id));
        }
    },

    /**
     * Whether the actor already carries a meal buff this module would replace.
     * Covers the shared kernel cooking slot and, for older kernels, this
     * module's own legacy meal effect. Unrelated effects are ignored.
     * @param {Actor} actor
     * @returns {boolean}
     */
    hasMealEffect(actor) {
        if (actor?.effects?.some(effect =>
            effect.flags?.[SHARED_BUFF_NAMESPACE]?.[SHARED_BUFF_FLAG] === true
            || effect.getFlag?.(MODULE_ID, MEAL_EFFECT_FLAG) === true
        )) return true;
        return Boolean(actor?.items?.some(item =>
            item.flags?.[SHARED_BUFF_NAMESPACE]?.[SHARED_BUFF_FLAG] === true
            || item.getFlag?.(MODULE_ID, MEAL_EFFECT_FLAG) === true
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
    producesManagedBuff(partyEffect, ambitious = false) {
        if (!partyEffect) return false;
        const buffs = MealBuffHandlers.buffs(partyEffect, ambitious);
        const applicator = Library.cooking?.applicator;
        if (applicator?.hasAutomatableBuffs?.(buffs)) return true;
        if (SystemBridge.systemId() !== "dnd5e") return false;
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
     * Clear short-rest-scoped meal buffs when an actor completes a short rest.
     * @param {Actor} actor
     * @param {object} result
     * @returns {Promise<"local"|"relay"|"blocked"|"noop">}
     */
    async onShortRestCompleted(actor, result) {
        if (SystemBridge.systemId() !== "dnd5e") return "noop";
        if (!isShortRestResult(result)) return "noop";
        if (isLongRestResult(result)) return "noop";

        const shortRestEffects = actor?.effects?.filter(effect =>
            effect.flags?.[SHARED_BUFF_NAMESPACE]?.[SHARED_BUFF_FLAG] === true
            && effect.flags?.[SHARED_BUFF_NAMESPACE]?.expiresOnShortRest === true
        ) ?? [];
        if (!shortRestEffects.length) return "noop";

        if (actor.isOwner) {
            await actor.deleteEmbeddedDocuments("ActiveEffect", shortRestEffects.map(effect => effect.id));
            return "local";
        }

        const mealEffects = actor?.effects?.filter(effect =>
            effect.flags?.[SHARED_BUFF_NAMESPACE]?.[SHARED_BUFF_FLAG] === true
        ) ?? [];
        if (mealEffects.length === shortRestEffects.length) {
            return GMRelay.clearMealEffect(actor?.uuid);
        }
        return "noop";
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
            let rolledCharges = null;

            if ((buff.type === "save_bonus" || buff.type === "check_advantage" || buff.type === "resistance")
                && buff.uses && globalThis.Roll) {
                const roll = await new Roll(String(buff.uses)).evaluate();
                rolledCharges = Math.max(1, roll.total);
                libFlags.chargesRemaining = rolledCharges;
                libFlags.chargesMax = rolledCharges;
                if (buff.type === "save_bonus") {
                    const ability = String(buff.save?.ability ?? "con").toUpperCase();
                    chargeLines.push(`+${buff.bonus ?? 1} ${ability} saves (${rolledCharges} remaining)`);
                } else if (buff.type === "check_advantage") {
                    const ability = String(buff.ability ?? "str").toUpperCase();
                    chargeLines.push(`${ability} check advantage (${rolledCharges} remaining)`);
                } else {
                    const damageType = String(buff.damageType ?? "poison");
                    chargeLines.push(`${damageType} resistance (${rolledCharges} hits remaining)`);
                }
            }

            if (buff.duration === "untilShortRest") {
                libFlags.expiresOnShortRest = true;
            }

            const built = cookingBuffs?.build?.(actor, buff) ?? null;
            if (built?.daeSpecialDuration?.length) {
                const skipLimitedSpecial = (buff.type === "save_bonus" || buff.type === "check_advantage")
                    && rolledCharges > 1;
                const durations = skipLimitedSpecial
                    ? built.daeSpecialDuration.filter(entry =>
                        !entry.startsWith("isSave") && !entry.startsWith("isCheck"))
                    : built.daeSpecialDuration;
                if (durations.length) daeSpecial.push(...durations);
            }

            if (buff.type === "advantage" && buff.duration === "nextSave") {
                const ability = String(buff.save?.ability ?? buff.ability ?? "con").toLowerCase();
                daeSpecial.push(`isSave.${ability}`);
            }

            if (buff.type === "save_bonus" && rolledCharges === 1) {
                daeSpecial.push(`isSave.${String(buff.save?.ability ?? "con").toLowerCase()}`);
            }

            if (buff.type === "check_advantage" && rolledCharges === 1) {
                daeSpecial.push(`isCheck.${String(buff.ability ?? "str").toLowerCase()}`);
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

        const parts = describePartyEffectParts(partyEffect, ambitious);
        const { daeSpecial, libFlags, chargeLines } = await this._buildBuffFlags(actor, partyEffect, ambitious);
        if (chargeLines.length) parts.push(...chargeLines);

        // Fallback expiry only. On dnd5e the rest hook clears the buff;
        // this bounds the effect if that signal never arrives.
        const seconds = libFlags.expiresOnShortRest
            ? SHORT_REST_FALLBACK_SECONDS
            : LONG_REST_FALLBACK_SECONDS;

        const flags = {
            [MODULE_ID]: { [MEAL_EFFECT_FLAG]: true },
            [SHARED_BUFF_NAMESPACE]: {
                [SHARED_BUFF_FLAG]: true,
                ...libFlags
            }
        };

        const title = mealName ? `Monstrous Feast: ${mealName}` : "Monstrous Feast";
        const effectData = {
            name: title,
            icon: "icons/consumables/food/bowl-stew-brown.webp",
            description: `<p>${parts.join(", ")}.</p>`,
            origin: actor.uuid,
            disabled: false,
            duration: { seconds },
            changes,
            flags
        };

        // DAE special durations expire the buff at the right moment: after the
        // next qualifying save or check, and at rest. Stamp through the shared
        // kernel helper so stack detection lives in one place; fall back to a
        // direct flag write on kernels that predate the helper.
        if (daeSpecial.length) {
            const fx = game.ionrift?.library?.effects ?? null;
            if (fx?.stampDaeDuration) fx.stampDaeDuration(effectData, daeSpecial);
            else effectData.flags.dae = { specialDuration: daeSpecial };
        }

        const route = await this.applyMealEffectRouted(actor, effectData);

        if (route !== "blocked") lines.push(`${actor.name}: ${parts.join("; ")}`);
        return lines;
    },

    async _applyPf2eBuffEffects(actor, partyEffect, ambitious, mealName = "") {
        const applicator = Library.cooking?.applicator;
        if (!applicator) return [];

        const buffs = MealBuffHandlers.buffs(partyEffect, ambitious);
        const result = await applicator.applyBuffsRouted(actor, buffs, {
            title: mealName ? `Monstrous Feast: ${mealName}` : "Monstrous Feast",
            slot: SHARED_BUFF_SLOT,
            extraFlags: { [MODULE_ID]: { [MEAL_EFFECT_FLAG]: true } },
            clearSlot: true
        });

        if (result.route === "blocked") return [];

        const lines = [...(result.lines ?? [])];
        if (result.approximateNotes?.length) lines.push(...result.approximateNotes);
        return lines;
    },

    /**
     * A GM-facing note when the detected effect-automation stack cannot deliver
     * the full scoping a recipe's buffs imply. The buffs still apply (their
     * changes use native dnd5e keys), but limited-use scoping and any roll
     * portions need the matching engine. Returns null when nothing is degraded
     * or when the stack helper is absent.
     * @param {object} partyEffect
     * @param {boolean} ambitious
     * @param {object|null} fx Shared effect-automation helper.
     * @returns {string|null}
     */
    _stackShortfallNote(partyEffect, ambitious, fx) {
        if (!fx) return null;

        const notes = [];

        const changes = this._buildDnd5eChanges(partyEffect, ambitious);
        const reliesOnMidi = changes.some(change =>
            String(change?.key ?? "").startsWith("flags.midi-qol."));
        if (reliesOnMidi && fx.supportsRollChanges?.() === false) {
            notes.push("Without Midi-QoL, the advantage and disadvantage parts do not change rolls on their own. Apply them by hand.");
        }

        const buffs = MealBuffHandlers.buffs(partyEffect, ambitious);
        const reliesOnDae = buffs.some(buff =>
            (buff?.type === "advantage" && buff?.duration === "nextSave")
            || buff?.type === "save_bonus"
            || buff?.type === "check_advantage");
        if (reliesOnDae && fx.hasDae?.() === false) {
            notes.push("Without Dynamic Active Effects, a single-use benefit (advantage on the next save or check) stays active until the next rest instead of clearing after the first roll. Track the limit by hand.");
        }

        return notes.length ? notes.join(" ") : null;
    },

    /**
     * Whisper one GM advisory for a served meal when the detected automation
     * stack cannot fully scope its buffs. Called from MealService.serveParty so
     * it covers both serve paths (the kernel feed and the standalone applier).
     * No-op when the stack is complete, nothing was applied, or chat is
     * unavailable.
     * @param {object} partyEffect
     * @param {boolean} ambitious
     * @param {string} mealName
     * @param {boolean} applied Whether any member received the buff.
     */
    async _postStackAdvisory(partyEffect, ambitious, mealName, applied) {
        if (!applied) return;
        const fx = game.ionrift?.library?.effects ?? null;
        const note = this._stackShortfallNote(partyEffect, ambitious, fx);
        if (!note || !fx?.buildGmAdvisory) return;
        if (!globalThis.ChatMessage?.create) return;

        await ChatMessage.create(fx.buildGmAdvisory({
            title: mealName ? `Monstrous Feast: ${mealName}` : "Monstrous Feast",
            duration: "until the next rest",
            note
        }));
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
        const buffs = MealBuffHandlers.buffs(partyEffect, ambitious);
        const applicator = Library.cooking?.applicator;
        const sys = SystemBridge.systemId();

        const canApplyPf2e = sys === "pf2e" && applicator?.hasAutomatableBuffs?.(buffs);
        const canApplyDnd5e = sys === "dnd5e"
            && this._buildDnd5eChanges(partyEffect, ambitious).length > 0;

        if (canApplyPf2e) {
            for (const member of members) {
                const buffLines = await this._applyPf2eBuffEffects(member, partyEffect, ambitious, mealName);
                lines.push(...buffLines);
            }
        } else if (canApplyDnd5e) {
            for (const member of members) {
                const buffLines = await this._applyBuffEffects(member, partyEffect, ambitious, mealName);
                lines.push(...buffLines);
            }
        } else {
            lines.push(...trackManuallyLines(partyEffect, ambitious));
            if (applicator) lines.push(...applicator.advisoryLines(buffs));
        }

        return lines;
    }
};
