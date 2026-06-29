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

        await this._clearMealEffects(actor);

        const parts = [];
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
        await this._applyActiveEffect(actor, {
            name: title,
            icon: "icons/consumables/food/bowl-stew-brown.webp",
            description: `<p>${parts.join(", ")}.</p>`,
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
