import { SystemBridge } from "../compat/SystemBridge.js";
import { GMRelay, decideEffectRoute } from "./GMRelay.js";

const MODULE_ID = "ionrift-monstrous-feast";
const MEAL_EFFECT_FLAG = "mealEffect";

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
     * Whether the actor already carries one of this module's meal effects.
     * Effects from other modules (e.g. a Well Fed buff) are deliberately ignored.
     * @param {Actor} actor
     * @returns {boolean}
     */
    hasMealEffect(actor) {
        return Boolean(actor?.effects?.some(effect =>
            effect.getFlag?.(MODULE_ID, MEAL_EFFECT_FLAG) === true
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
        return Boolean(partyEffect.strengthAdvantage
            || partyEffect.darkvisionFeet
            || partyEffect.perceptionAdvantageDim);
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
     * @param {string} label
     * @param {object} [opts]
     * @param {number} [opts.seconds]
     * @returns {object[]}
     */
    _buildDnd5eChanges(opts = {}) {
        if (SystemBridge.systemId() !== "dnd5e") return [];

        const changes = [];
        if (opts.strengthAdvantage) {
            changes.push({
                key: "system.abilities.str.check.roll.mode",
                mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                value: "1",
                priority: 20
            });
        }
        if (opts.darkvisionFeet) {
            changes.push({
                key: "system.attributes.senses.darkvision",
                mode: CONST.ACTIVE_EFFECT_MODES.UPGRADE,
                value: String(opts.darkvisionFeet),
                priority: 20
            });
        }
        if (opts.perceptionAdvantage) {
            changes.push({
                key: "system.skills.prc.roll.mode",
                mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                value: "1",
                priority: 20
            });
        }
        return changes;
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
        const changes = this._buildDnd5eChanges({
            strengthAdvantage: partyEffect.strengthAdvantage,
            darkvisionFeet: partyEffect.darkvisionFeet,
            perceptionAdvantage: ambitious && partyEffect.perceptionAdvantageDim
        });
        if (!changes.length) return lines;

        const parts = [];
        // Fallback expiry only. On dnd5e the long-rest hook clears the buff;
        // this bounds the effect if that signal never arrives.
        const seconds = 28800;

        if (partyEffect.strengthAdvantage) {
            parts.push("advantage on Strength checks until your next long rest");
        }
        if (partyEffect.darkvisionFeet) {
            parts.push(`${partyEffect.darkvisionFeet}ft darkvision until your next long rest`);
        }
        if (ambitious && partyEffect.perceptionAdvantageDim) {
            parts.push("advantage on Perception checks until your next long rest");
        }

        const title = mealName ? `Monstrous Feast: ${mealName}` : "Monstrous Feast";
        const route = await this.applyMealEffectRouted(actor, {
            name: title,
            icon: "icons/consumables/food/bowl-stew-brown.webp",
            description: `<p>${parts.join(", ")}.</p>`,
            origin: actor.uuid,
            disabled: false,
            duration: { seconds },
            changes
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
            && (partyEffect.strengthAdvantage
                || partyEffect.darkvisionFeet
                || (ambitious && partyEffect.perceptionAdvantageDim));

        if (canApplyEffects) {
            for (const member of members) {
                const buffLines = await this._applyBuffEffects(member, partyEffect, ambitious, mealName);
                lines.push(...buffLines);
            }
        } else {
            if (partyEffect.strengthAdvantage) {
                lines.push("Party gains advantage on Strength checks until the next long rest (track manually).");
            }
            if (partyEffect.darkvisionFeet) {
                lines.push(`Party gains ${partyEffect.darkvisionFeet}ft darkvision until the next long rest (track manually).`);
            }
            if (partyEffect.perceptionAdvantageDim && ambitious) {
                lines.push("Party gains advantage on Perception in dim light until the next long rest (track manually).");
            }
        }

        return lines;
    }
};
