import { SystemBridge } from "../compat/SystemBridge.js";

const MODULE_ID = "ionrift-monstrous-feast";
const MEAL_EFFECT_FLAG = "mealEffect";

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
     * @param {Actor[]} actors
     * @param {string} formula
     * @returns {Promise<number>}
     */
    async _rollTotal(formula) {
        const roll = await new Roll(formula).evaluate();
        return roll.total;
    },

    /**
     * @param {Actor} actor
     * @param {number} amount
     */
    async _applyTempHP(actor, amount) {
        if (!amount || amount <= 0) return;
        const hp = actor.system?.attributes?.hp;
        if (!hp) return;
        const currentTemp = Number(hp.temp ?? 0);
        await actor.update({ "system.attributes.hp.temp": currentTemp + amount });
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
     * @param {Actor} actor
     * @param {object} effectData
     */
    async _applyActiveEffect(actor, effectData) {
        if (!actor?.createEmbeddedDocuments || !effectData?.changes?.length) return;
        await actor.createEmbeddedDocuments("ActiveEffect", [{
            ...effectData,
            flags: {
                ...(effectData.flags ?? {}),
                [MODULE_ID]: { [MEAL_EFFECT_FLAG]: true }
            }
        }]);
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
     * @returns {Promise<string[]>}
     */
    async _applyBuffEffects(actor, partyEffect, ambitious) {
        const lines = [];
        const changes = this._buildDnd5eChanges({
            strengthAdvantage: partyEffect.strengthAdvantage,
            darkvisionFeet: partyEffect.darkvisionFeet,
            perceptionAdvantage: ambitious && partyEffect.perceptionAdvantageDim
        });
        if (!changes.length) return lines;

        await this._clearMealEffects(actor);

        const parts = [];
        let seconds = 28800;
        if (partyEffect.strengthAdvantage && !partyEffect.darkvisionFeet) {
            seconds = 86400;
        }

        if (partyEffect.strengthAdvantage) {
            parts.push("advantage on Strength checks until dawn");
        }
        if (partyEffect.darkvisionFeet) {
            parts.push(`${partyEffect.darkvisionFeet}ft darkvision for 8 hours`);
        }
        if (ambitious && partyEffect.perceptionAdvantageDim) {
            parts.push("advantage on Perception checks for 8 hours");
        }

        await this._applyActiveEffect(actor, {
            name: `Monstrous Feast: ${parts.join(", ")}`,
            icon: "icons/consumables/food/bowl-stew-brown.webp",
            origin: actor.uuid,
            disabled: false,
            duration: { seconds },
            changes
        });

        lines.push(`${actor.name}: ${parts.join("; ")}`);
        return lines;
    },

    /**
     * @param {object} partyEffect
     * @param {boolean} ambitious
     * @returns {Promise<string[]>}
     */
    async applyPartyEffect(partyEffect, ambitious = false) {
        if (!partyEffect) return [];
        const members = this.getPartyMembers();
        const lines = [];
        const tempFormula = ambitious
            ? (partyEffect.ambitiousTempHP ?? partyEffect.tempHP)
            : partyEffect.tempHP;

        if (tempFormula) {
            for (const member of members) {
                const amount = await this._rollTotal(tempFormula);
                await this._applyTempHP(member, amount);
                lines.push(`${member.name}: +${amount} temp HP`);
            }
        }

        const canApplyEffects = SystemBridge.systemId() === "dnd5e"
            && (partyEffect.strengthAdvantage
                || partyEffect.darkvisionFeet
                || (ambitious && partyEffect.perceptionAdvantageDim));

        if (canApplyEffects) {
            for (const member of members) {
                const buffLines = await this._applyBuffEffects(member, partyEffect, ambitious);
                lines.push(...buffLines);
            }
        } else {
            if (partyEffect.strengthAdvantage) {
                lines.push("Party gains advantage on Strength checks until dawn (track manually).");
            }
            if (partyEffect.darkvisionFeet) {
                lines.push(`Party gains ${partyEffect.darkvisionFeet}ft darkvision for 8 hours (track manually).`);
            }
            if (partyEffect.perceptionAdvantageDim && ambitious) {
                lines.push("Party gains advantage on Perception in dim light until dawn (track manually).");
            }
        }

        return lines;
    }
};
