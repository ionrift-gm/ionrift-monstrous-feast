import { Logger } from "../lib/Logger.js";
import { Library } from "../compat/Library.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { CreatureRegistry } from "../data/CreatureRegistry.js";
import { grantYields } from "../services/ItemFactory.js";
import { DiscoveryService } from "../services/DiscoveryService.js";
import { buildPromptCard, buildResultCard, buildPassedCard } from "../ui/ButcherCards.js";
import { ButcherCorpseMarker } from "../services/ButcherCorpseMarker.js";

const MODULE_ID = "ionrift-monstrous-feast";

/** @type {Map<string, object>} Pending butcher targets keyed by combatant id. */
const _pendingTargets = new Map();

export const ButcherEngine = {
    init() {
        Logger.log(`Butcher engine ready (${SystemBridge.launchLabel()}).`);
    },

    /**
     * @param {Combat} combat
     */
    async onCombatEnd(combat) {
        const notice = SystemBridge.unsupportedNotice();
        if (notice) {
            Logger.warn(notice);
            return;
        }
        if (!CreatureRegistry.hasEntries()) return;

        const targets = this.findButcherTargets(combat);
        if (!targets.length) return;

        const butchers = this.findButcherActors();
        if (!butchers.length) {
            ui.notifications.info("Monstrous Feast: slain creatures found, but no eligible butcher is available.");
            return;
        }

        for (const target of targets.slice(0, 3)) {
            _pendingTargets.set(target.combatantId, target);
            await ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker(),
                content: buildPromptCard(target, butchers),
                flags: { [MODULE_ID]: { butcherPrompt: true, combatantId: target.combatantId } }
            });
        }

        ButcherCorpseMarker.syncShow(targets);
    },

    /**
     * Offer butchering when a registry creature dies outside an active combat.
     * @param {Actor} actor
     */
    async onCreatureDeath(actor) {
        const notice = SystemBridge.unsupportedNotice();
        if (notice) return;
        if (!CreatureRegistry.hasEntries()) return;
        if (!actor || SystemBridge.isPlayerCharacter(actor) || !SystemBridge.isDead(actor)) return;
        if (game.combat?.started) return;

        const token = canvas.tokens?.placeables?.find(entry => entry.actor?.id === actor.id) ?? null;
        const target = this.buildTargetFromActor(actor, token);
        if (!target || _pendingTargets.has(target.combatantId)) return;

        const butchers = this.findButcherActors();
        if (!butchers.length) return;

        _pendingTargets.set(target.combatantId, target);
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker(),
            content: buildPromptCard(target, butchers),
            flags: { [MODULE_ID]: { butcherPrompt: true, combatantId: target.combatantId } }
        });

        ButcherCorpseMarker.syncShow(this.getPendingTargetsList());
    },

    /**
     * @returns {object[]}
     */
    getPendingTargetsList() {
        return [..._pendingTargets.values()].slice(0, 3);
    },

    /**
     * Serialize targets for socket sync (Actor refs become uuids).
     * @param {object[]} targets
     * @returns {object[]}
     */
    serializeTargets(targets) {
        return (targets ?? []).slice(0, 3).map(target => ({
            combatantId: target.combatantId,
            actorUuid: target.actor?.uuid ?? null,
            actorName: target.actorName,
            actorImg: target.actorImg,
            classifierResult: target.classifierResult,
            registryEntry: target.registryEntry,
            cr: target.cr,
            crLabel: target.crLabel,
            dc: target.dc
        }));
    },

    /**
     * Re-show markers for any pending targets (canvas refresh).
     */
    refreshMarkers() {
        const pending = this.getPendingTargetsList();
        if (pending.length) ButcherCorpseMarker.syncShow(pending);
    },

    /**
     * @param {Combat} combat
     * @returns {object[]}
     */
    findButcherTargets(combat) {
        const targets = [];
        for (const combatant of combat?.combatants?.contents ?? []) {
            const actor = combatant.actor;
            if (!actor) continue;
            if (SystemBridge.isPlayerCharacter(actor)) continue;
            if (!SystemBridge.isDead(actor)) continue;

            const cr = SystemBridge.getChallengeRating(actor);
            let classification = Library.classify(actor);
            if (!classification?.id || classification.id === "unknown") {
                const rawType = (actor.system?.details?.type?.value ?? "").toLowerCase();
                if (!rawType) continue;
                classification = { id: rawType, label: rawType };
            }

            const entry = CreatureRegistry.lookup(classification, cr);
            if (!entry) continue;

            targets.push({
                combatantId: combatant.id,
                actor,
                actorName: actor.name ?? combatant.name ?? "Unknown Creature",
                actorImg: actor.img ?? combatant.img ?? "icons/svg/mystery-man.svg",
                classifierResult: classification,
                registryEntry: entry,
                cr,
                crLabel: SystemBridge.systemId() === "pf2e" ? "Level" : "CR",
                dc: this.calculateDC(cr)
            });
        }

        targets.sort((a, b) => b.cr - a.cr);
        return targets;
    },

    /**
     * GM test helper: butcher the currently selected token with the first party actor.
     * @returns {Promise<object|null>}
     */
    async testSelectedButcher() {
        const targetToken = canvas.tokens.controlled[0];
        if (!targetToken?.actor) {
            ui.notifications.warn("Select a defeated creature token first.");
            return null;
        }
        const butcher = this.resolveButcherActor();
        if (!butcher) {
            ui.notifications.warn("No eligible butcher actor found.");
            return null;
        }
        const target = this.buildTargetFromActor(targetToken.actor, targetToken);
        if (!target) {
            ui.notifications.warn("Selected creature is not in the butcher registry.");
            return null;
        }
        return this.resolve(butcher, target);
    },

    buildTargetFromActor(actor, token) {
        const cr = SystemBridge.getChallengeRating(actor);
        let classification = Library.classify(actor);
        if (!classification?.id || classification.id === "unknown") {
            const rawType = (actor.system?.details?.type?.value ?? "").toLowerCase();
            if (!rawType) return null;
            classification = { id: rawType, label: rawType };
        }
        const entry = CreatureRegistry.lookup(classification, cr);
        if (!entry) return null;
        return {
            combatantId: token?.id ?? actor.id,
            actor,
            actorName: actor.name ?? "Unknown Creature",
            actorImg: actor.img ?? token?.texture?.src ?? "icons/svg/mystery-man.svg",
            classifierResult: classification,
            registryEntry: entry,
            cr,
            crLabel: SystemBridge.systemId() === "pf2e" ? "Level" : "CR",
            dc: this.calculateDC(cr)
        };
    },

    findButcherActors() {
        return DiscoveryService.partyActors().filter(actor => this.isEligibleButcher(actor));
    },

    /**
     * @param {Actor} actor
     * @returns {boolean}
     */
    isEligibleButcher(actor) {
        if (!actor || SystemBridge.isDead(actor)) return false;
        if (game.settings.get(MODULE_ID, "requireHandbook")) {
            return !!DiscoveryService.findBookOnActor(actor);
        }
        return true;
    },

    /**
     * Prefer a selected PC token, then a book carrier, then the first eligible party member.
     * @returns {Actor|null}
     */
    resolveButcherActor() {
        const eligible = this.findButcherActors();
        if (!eligible.length) return null;

        for (const token of canvas.tokens?.controlled ?? []) {
            const actor = token.actor;
            if (!actor || !this.isEligibleButcher(actor)) continue;
            if (SystemBridge.isPlayerCharacter(actor)) return actor;
        }

        const withBook = eligible.filter(actor => DiscoveryService.findBookOnActor(actor));
        if (withBook.length) return withBook[0];

        return eligible[0];
    },

    calculateDC(cr) {
        return 10 + Math.floor(Number(cr) / 2);
    },

    determineOutcome(rollTotal, dc, naturalRoll) {
        if (naturalRoll === 1) return "nat1";
        if (naturalRoll === 20) return "nat20";
        if (rollTotal >= dc + 5) return "exceptional";
        if (rollTotal >= dc) return "standard";
        return "basic";
    },

    /**
     * @param {Actor} butcher
     * @param {object} target
     * @returns {Promise<object|null>}
     */
    async resolve(butcher, target) {
        const notice = SystemBridge.unsupportedNotice();
        if (notice) {
            ui.notifications.warn(notice);
            return null;
        }

        const { registryEntry, cr, actorName } = target;
        const dc = target.dc ?? this.calculateDC(cr);
        const rollResult = await SystemBridge.rollSurvival(
            butcher,
            dc,
            `Butchering ${actorName}`
        );

        const outcome = this.determineOutcome(rollResult.total, dc, rollResult.natural);
        let yieldTier = "basic";
        let mishap = null;
        let narrative = registryEntry.flavour ?? "";

        switch (outcome) {
            case "nat20":
                yieldTier = "exceptional";
                narrative += " A masterful display of field dressing.";
                break;
            case "nat1":
                yieldTier = "basic";
                mishap = registryEntry.mishap ?? null;
                break;
            case "exceptional":
                yieldTier = "exceptional";
                break;
            case "standard":
                yieldTier = "standard";
                break;
            default:
                yieldTier = "basic";
                break;
        }

        const yields = registryEntry[yieldTier] ?? registryEntry.basic ?? [];
        await grantYields(butcher, yields, actorName, registryEntry.tier ?? "common");

        const typeId = target.classifierResult?.id ?? registryEntry.id;
        await DiscoveryService.recordPartyDiscovery(butcher, typeId);

        const result = {
            outcome,
            yieldTier,
            yields,
            mishap,
            narrative,
            roll: rollResult.total,
            naturalRoll: rollResult.natural,
            dc,
            creatureName: actorName,
            creatureImg: target.actorImg,
            tier: registryEntry.tier ?? "common",
            label: registryEntry.label ?? actorName
        };

        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: butcher }),
            content: buildResultCard(result, butcher.name),
            flags: { [MODULE_ID]: { butcherResult: true } }
        });

        ButcherCorpseMarker.clear(target.combatantId);
        return result;
    },

    getPendingTarget(combatantId) {
        return _pendingTargets.get(combatantId) ?? null;
    },

    clearPendingTarget(combatantId) {
        _pendingTargets.delete(combatantId);
        ButcherCorpseMarker.clear(combatantId);
    },

    async passTarget(combatantId, creatureName) {
        this.clearPendingTarget(combatantId);
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker(),
            content: buildPassedCard(creatureName)
        });
    }
};
