import { Logger } from "../lib/Logger.js";
import { Library } from "./Library.js";

/** Systems supported at the Monstrous Feast launch. */
export const LAUNCH_SYSTEMS = Object.freeze(["dnd5e", "pf2e"]);

/** Butcher helpers: level/HP via Library.system; CR and survival local. */
export const SystemBridge = {
    systemId() {
        return game.system?.id ?? "unknown";
    },

    /** @returns {import("../../../ionrift-library/scripts/services/systems/IonriftSystemAdapter.js").IonriftSystemAdapter|null} */
    adapter() {
        const registry = Library.system;
        if (!registry) return null;
        return registry.current ?? registry;
    },

    isLaunchSupported() {
        return LAUNCH_SYSTEMS.includes(this.systemId());
    },

    launchLabel() {
        const labels = { dnd5e: "D&D 5e", pf2e: "Pathfinder 2e" };
        return labels[this.systemId()] ?? this.systemId();
    },

    getChallengeRating(actor) {
        if (!actor) return 0;
        const sys = this.systemId();
        if (sys === "dnd5e") {
            const cr = actor.system?.details?.cr;
            return Number(cr ?? 0);
        }
        if (sys === "pf2e") {
            return Number(actor.system?.details?.level?.value ?? this.adapter()?.getLevel?.(actor) ?? 0);
        }
        return Number(this.adapter()?.getLevel?.(actor) ?? 0);
    },

    getHP(actor) {
        return this.adapter()?.getHP?.(actor) ?? {
            value: actor?.system?.attributes?.hp?.value ?? 0,
            max: actor?.system?.attributes?.hp?.max ?? 1
        };
    },

    isDead(actor) {
        return this.getHP(actor).value <= 0;
    },

    isPlayerCharacter(actor) {
        if (!actor) return false;
        return this.adapter()?.isPlayerCharacter?.(actor) ?? (actor.hasPlayerOwner && actor.type === "character");
    },

    survivalLabel() {
        return this.systemId() === "pf2e" ? "Survival" : "Survival";
    },

    survivalSkillKey() {
        return this.systemId() === "pf2e" ? "survival" : "sur";
    },

    getSurvivalModifier(actor) {
        if (!actor) return 0;
        if (this.systemId() === "pf2e") {
            return actor.system?.skills?.survival?.totalModifier ?? 0;
        }
        const skill = actor.system?.skills?.sur;
        return skill?.total ?? skill?.mod ?? 0;
    },

    /**
     * @param {Actor} actor
     * @param {number} dc
     * @param {string} flavor
     * @returns {Promise<{ roll: Roll, total: number, natural: number }>}
     */
    async rollSurvival(actor, dc, flavor) {
        const mod = this.getSurvivalModifier(actor);
        const roll = await new Roll(`1d20 + ${mod}`).evaluate();
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `${flavor} (${this.survivalLabel()}) DC ${dc}`
        });
        const natural = roll.dice[0]?.results?.[0]?.result ?? roll.total;
        return { roll, total: roll.total, natural };
    },

    unsupportedNotice() {
        if (this.isLaunchSupported()) return null;
        return `Monstrous Feast does not support ${this.systemId()} yet. Launch systems: ${LAUNCH_SYSTEMS.join(", ")}.`;
    }
};
