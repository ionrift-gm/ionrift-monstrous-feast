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

function _markerDebug(...args) {
    const verbose = game.settings?.get?.(MODULE_ID, "debugButcherMarker");
    if (verbose) Logger.warn("MF ButcherMarker", ...args);
}

function _markerWarn(...args) {
    Logger.warn("MF ButcherMarker", ...args);
}

function _findCanvasTokenForActor(actor, { combatantId = null, tokenId = null } = {}) {
    const placeables = canvas?.tokens?.placeables;
    if (!placeables?.length) return null;

    if (tokenId) {
        const byTokenId = placeables.find(
            entry => entry.id === tokenId || entry.document?.id === tokenId
        );
        if (byTokenId) return byTokenId;
    }

    if (combatantId) {
        const byCombatant = placeables.find(entry => entry.document?.combatantId === combatantId);
        if (byCombatant) return byCombatant;
        const byDocId = placeables.find(
            entry => entry.id === combatantId || entry.document?.id === combatantId
        );
        if (byDocId) return byDocId;
    }

    if (!actor?.id) return null;
    return placeables.find(entry =>
        entry.actor?.id === actor.id
        || entry.document?.actorId === actor.id
        || (actor.uuid && entry.actor?.uuid === actor.uuid)
    ) ?? null;
}

export const ButcherEngine = {
    init() {
        Logger.log(`Butcher engine ready (${SystemBridge.launchLabel()}).`);
    },

    /**
     * @param {Combat} combat
     */
    async onCombatEnd(combat) {
        _markerDebug("onCombatEnd hook", { combatId: combat?.id, combatants: combat?.combatants?.size ?? 0 });
        const notice = SystemBridge.unsupportedNotice();
        if (notice) {
            _markerWarn("blocked: unsupported system", notice);
            return;
        }
        if (!CreatureRegistry.hasEntries()) {
            _markerWarn("blocked: creature registry empty");
            return;
        }

        const targets = this.findButcherTargets(combat);
        _markerDebug("combat-end targets", { count: targets.length, names: targets.map(t => t.actorName) });
        if (!targets.length) {
            this.scanSceneCorpses({ createChat: false, reason: "combat-end-empty" });
            return;
        }

        const butchers = this.findButcherActors();
        if (!butchers.length) {
            _markerWarn("blocked: no eligible butcher", { requireHandbook: game.settings.get(MODULE_ID, "requireHandbook") });
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
        _markerDebug("onCreatureDeath hook", { actorId: actor?.id, actorName: actor?.name, combatStarted: !!game.combat?.started });
        const notice = SystemBridge.unsupportedNotice();
        if (notice) {
            _markerWarn("blocked: unsupported system", notice);
            return;
        }
        if (!CreatureRegistry.hasEntries()) {
            _markerWarn("blocked: creature registry empty");
            return;
        }
        if (!actor || SystemBridge.isPlayerCharacter(actor) || !SystemBridge.isDead(actor)) {
            _markerDebug("skipped: actor not a dead NPC", { actorId: actor?.id });
            return;
        }
        if (game.combat?.started) {
            _markerDebug("skipped: combat still active; waiting for combat end");
            return;
        }

        const token = _findCanvasTokenForActor(actor);
        const target = this.buildTargetFromActor(actor, token);
        if (!target) {
            _markerWarn("no registry match for dead actor", {
                actorId: actor.id,
                actorName: actor.name,
                cr: SystemBridge.getChallengeRating(actor),
                classification: Library.classify(actor)?.id ?? actor.system?.details?.type?.value
            });
            return;
        }
        if (_pendingTargets.has(target.combatantId)) {
            _markerDebug("skipped: already pending", { combatantId: target.combatantId });
            ButcherCorpseMarker.syncShow(this.getPendingTargetsList());
            return;
        }

        const butchers = this.findButcherActors();
        if (!butchers.length) {
            _markerWarn("blocked: no eligible butcher", { requireHandbook: game.settings.get(MODULE_ID, "requireHandbook") });
            return;
        }

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
            tokenId: target.tokenId ?? null,
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
        this.scanSceneCorpses({ createChat: false, reason: "refreshMarkers" });
    },

    /**
     * Scan the active scene for dead butcherable tokens, ensure pending entries,
     * and sync canvas markers. Does not duplicate chat unless createChat is true.
     * @param {{ createChat?: boolean, reason?: string }} [opts]
     * @returns {object[]}
     */
    async scanSceneCorpses({ createChat = false, reason = "scan" } = {}) {
        if (!game.user?.isGM) return [];
        if (!game.settings.get(MODULE_ID, "promptOnCombatEnd")) return [];
        const notice = SystemBridge.unsupportedNotice();
        if (notice || !CreatureRegistry.hasEntries() || !canvas?.ready) return [];

        const butchers = this.findButcherActors();
        if (!butchers.length) {
            _markerDebug("scanSceneCorpses: no eligible butcher", { reason, requireHandbook: game.settings.get(MODULE_ID, "requireHandbook") });
            return [];
        }

        const discovered = [];
        for (const token of canvas.tokens?.placeables ?? []) {
            const actor = token.actor;
            if (!actor || SystemBridge.isPlayerCharacter(actor) || !SystemBridge.isDead(actor)) continue;
            const target = this.buildTargetFromActor(actor, token);
            if (!target) continue;
            discovered.push(target);
        }

        discovered.sort((a, b) => b.cr - a.cr);
        const slice = discovered.slice(0, 3);
        _markerDebug("scanSceneCorpses", {
            reason,
            discovered: slice.map(entry => ({
                name: entry.actorName,
                combatantId: entry.combatantId,
                tokenId: entry.tokenId,
                cr: entry.cr
            }))
        });

        for (const target of slice) {
            if (_pendingTargets.has(target.combatantId)) continue;
            _pendingTargets.set(target.combatantId, target);
            if (createChat) {
                await ChatMessage.create({
                    user: game.user.id,
                    speaker: ChatMessage.getSpeaker(),
                    content: buildPromptCard(target, butchers),
                    flags: { [MODULE_ID]: { butcherPrompt: true, combatantId: target.combatantId } }
                });
            }
        }

        if (slice.length) ButcherCorpseMarker.syncShow(this.getPendingTargetsList());
        return slice;
    },

    /**
     * Debug helper for console macros: inspect butcher eligibility for a token.
     * @param {Token} token
     * @returns {object}
     */
    inspectButcherEligibility(token) {
        const actor = token?.actor;
        const classification = actor ? Library.classify(actor) : null;
        const cr = actor ? SystemBridge.getChallengeRating(actor) : null;
        const registryEntry = classification || actor?.system?.details?.type?.value
            ? CreatureRegistry.lookup(
                classification?.id && classification.id !== "unknown"
                    ? classification
                    : { id: String(actor?.system?.details?.type?.value ?? "").toLowerCase(), label: actor?.system?.details?.type?.value },
                cr
            )
            : null;
        const butchers = this.findButcherActors();
        const target = actor ? this.buildTargetFromActor(actor, token) : null;
        const pending = target ? this.getPendingTarget(target.combatantId) : null;

        return {
            tokenId: token?.document?.id ?? token?.id ?? null,
            actorId: actor?.id ?? null,
            actorName: actor?.name ?? null,
            actorUuid: actor?.uuid ?? null,
            linkedActorId: token?.document?.actorId ?? null,
            hp: actor ? SystemBridge.getHP(actor) : null,
            isDead: actor ? SystemBridge.isDead(actor) : false,
            isPlayerCharacter: actor ? SystemBridge.isPlayerCharacter(actor) : false,
            classification,
            cr,
            registryEntry: registryEntry ? { id: registryEntry.id ?? classification?.id, minCR: registryEntry.minCR, tier: registryEntry.tier } : null,
            target,
            pending: pending ? { combatantId: pending.combatantId, actorName: pending.actorName } : null,
            butchers: butchers.map(entry => entry.name),
            requireHandbook: game.settings.get(MODULE_ID, "requireHandbook"),
            promptOnCombatEnd: game.settings.get(MODULE_ID, "promptOnCombatEnd"),
            combatStarted: !!game.combat?.started,
            markerCount: ButcherCorpseMarker.count(),
            canSeeMarkers: ButcherCorpseMarker.canUserSeeMarkers?.() ?? null
        };
    },

    /**
     * @returns {{ pending: object[], markerCount: number }}
     */
    getMarkerDebugState() {
        return {
            pending: this.getPendingTargetsList().map(target => ({
                combatantId: target.combatantId,
                tokenId: target.tokenId ?? null,
                actorName: target.actorName,
                actorUuid: target.actor?.uuid ?? null,
                cr: target.cr
            })),
            markerCount: ButcherCorpseMarker.count(),
            overlayReady: ButcherCorpseMarker.isOverlayReady?.() ?? false
        };
    },

    findCanvasTokenForActor(actor, hints = {}) {
        return _findCanvasTokenForActor(actor, hints);
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
            if (!entry) {
                _markerDebug("combatant skipped: registry miss", {
                    name: actor.name,
                    classification: classification.id,
                    cr
                });
                continue;
            }

            const token = _findCanvasTokenForActor(actor, { combatantId: combatant.id });
            targets.push({
                combatantId: combatant.id,
                tokenId: token?.document?.id ?? token?.id ?? null,
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
        const tokenId = token?.document?.id ?? token?.id ?? null;
        return {
            combatantId: tokenId ?? actor.id,
            tokenId,
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
