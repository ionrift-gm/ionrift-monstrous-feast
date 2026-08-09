import { Logger } from "../lib/Logger.js";
import { Library } from "../compat/Library.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { CreatureRegistry } from "../data/catalogs/CreatureRegistry.js";
import { grantYields } from "../services/butcher/ItemFactory.js";
import { DiscoveryService } from "../services/cookbook/DiscoveryService.js";
import { buildPromptCard, buildResultCard, buildPassedCard } from "../ui/butcher/ButcherCards.js";
import { MODULE_ID } from "../data/moduleId.js";
import { ButcherEligibility } from "./butcher/ButcherEligibility.js";
import {
    BUTCHER_STATE,
    clearButcherState,
    getButcherState,
    getSceneCorpseRegistry,
    isButcherableState,
    persistButcherState,
    resolveTokenFromRegistryEntry,
    showHarvestedMarker
} from "../services/butcher/ButcherTokenState.js";

/**
 * Butcher offer lifecycle (canvas marker + chat):
 *
 * | Trigger | Chat card | Canvas marker |
 * | Combat ends (deleteCombat) | Yes, up to 3 | Yes |
 * | HP reaches 0 outside combat | Yes | Yes |
 * | HP reaches 0 during combat | No (waits for combat end chat) | Yes (scene scan on updateActor) |
 * | canvasReady (GM) | No | Yes (scan) |
 * | GM scanButcherCorpses macro | Optional | Yes |
 *
 * Token flag `butcherState`: ready | harvested | passed (persisted on the token document).
 * Pending offer queue is rebuilt from those flags on canvasReady.
 */

/** @type {Map<string, object>} Pending butcher targets keyed by combatant id. */
const _pendingTargets = new Map();
let _markerService = null;

function _markerDebug(...args) {
    if (game.settings?.get?.(MODULE_ID, "debug")) {
        Logger.warn("MF ButcherMarker", ...args);
    }
}

function _markerWarn(...args) {
    Logger.warn("MF ButcherMarker", ...args);
}

function _tokenForTarget(target) {
    return ButcherEligibility.findCanvasTokenForActor(target?.actor, {
        combatantId: target?.combatantId,
        tokenId: target?.tokenId
    });
}

function _isTargetButcherable(target) {
    const token = _tokenForTarget(target);
    return isButcherableState(getButcherState(token));
}

function _collectRevokeOfferIds(actor, token, target) {
    const ids = new Set();
    const tokenId = token?.document?.id ?? token?.id ?? null;
    if (target?.combatantId) ids.add(target.combatantId);
    if (tokenId) ids.add(tokenId);
    if (actor?.id) ids.add(actor.id);

    for (const [id, pending] of _pendingTargets.entries()) {
        if (pending.actor?.id === actor?.id) ids.add(id);
        if (tokenId && pending.tokenId === tokenId) ids.add(id);
    }

    for (const [regTokenId, entry] of Object.entries(getSceneCorpseRegistry())) {
        if (tokenId && regTokenId === tokenId) ids.add(regTokenId);
        if (entry?.actorUuid && entry.actorUuid === actor?.uuid) ids.add(regTokenId);
    }

    return ids;
}

async function _withdrawButcherPrompts(offerIds) {
    if (!game.user?.isGM || !offerIds?.size) return;
    for (const msg of game.messages ?? []) {
        const flag = msg.flags?.[MODULE_ID];
        if (!flag?.butcherPrompt || !offerIds.has(flag.combatantId)) continue;
        await msg.update({
            content: `<p class="mf-passed">Butchering offer withdrawn.</p>`,
            flags: { [MODULE_ID]: { butcherPrompt: false } }
        });
    }
}

async function _markCorpseReady(target) {
    const token = _tokenForTarget(target);
    const state = token ? getButcherState(token) : null;
    if (state === BUTCHER_STATE.HARVESTED || state === BUTCHER_STATE.PASSED) return;
    await persistButcherState(token, target, BUTCHER_STATE.READY);
}

async function _markCorpseHarvested(target) {
    const token = _tokenForTarget(target);
    await persistButcherState(token, target, BUTCHER_STATE.HARVESTED);
}

async function _markCorpsePassed(target) {
    const token = _tokenForTarget(target);
    await persistButcherState(token, target, BUTCHER_STATE.PASSED);
}

export const ButcherEngine = {
    configure({ markerService } = {}) {
        _markerService = markerService ?? null;
    },

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
            if (!_isTargetButcherable(target)) continue;
            _pendingTargets.set(target.combatantId, target);
            await _markCorpseReady(target);
            await ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker(),
                content: buildPromptCard(target, butchers),
                flags: { [MODULE_ID]: { butcherPrompt: true, combatantId: target.combatantId } }
            });
        }

        _markerService?.syncShow(this.getCorpseMarkerEntries());
    },

    /**
     * Drop butcher offers when a creature is no longer dead (healed, revived, etc.).
     * @param {Actor} actor
     * @returns {Promise<boolean>}
     */
    async revokeButcherOffer(actor) {
        if (!actor || SystemBridge.isDead(actor)) return false;

        const token = this.findCanvasTokenForActor(actor);
        const state = token ? getButcherState(token) : null;
        const inPending = [..._pendingTargets.values()].some(entry => entry.actor?.id === actor.id);
        if (!state && !inPending) return false;

        const target = this.buildTargetFromActor(actor, token, { allowResolved: true });
        const offerIds = _collectRevokeOfferIds(actor, token, target);

        await clearButcherState(token, target);

        for (const id of offerIds) {
            _pendingTargets.delete(id);
            _markerService?.clear(id);
        }

        await _withdrawButcherPrompts(offerIds);
        _markerService?.syncShow(this.getCorpseMarkerEntries());
        return true;
    },

    /**
     * Offer butchering when a registry creature dies outside an active combat.
     * @param {Actor} actor
     * @returns {Promise<void>}
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

        const token = this.findCanvasTokenForActor(actor);
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
            _markerService?.syncShow(this.getCorpseMarkerEntries());
            return;
        }
        if (!isButcherableState(getButcherState(token))) {
            _markerDebug("skipped: corpse already resolved", { state: getButcherState(token) });
            _markerService?.syncShow(this.getCorpseMarkerEntries());
            return;
        }

        const butchers = this.findButcherActors();
        if (!butchers.length) {
            _markerWarn("blocked: no eligible butcher", { requireHandbook: game.settings.get(MODULE_ID, "requireHandbook") });
            return;
        }

        _pendingTargets.set(target.combatantId, target);
        await _markCorpseReady(target);
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker(),
            content: buildPromptCard(target, butchers),
            flags: { [MODULE_ID]: { butcherPrompt: true, combatantId: target.combatantId } }
        });

        _markerService?.syncShow(this.getCorpseMarkerEntries());
    },

    /**
     * Ready pending targets plus harvested corpse markers for the active scene.
     * @returns {object[]}
     */
    getCorpseMarkerEntries() {
        const readyById = new Map();
        for (const target of this.getPendingTargetsList()) {
            readyById.set(target.combatantId, { ...target, butcherState: BUTCHER_STATE.READY });
        }
        const harvested = [];
        for (const token of canvas?.tokens?.placeables ?? []) {
            const state = getButcherState(token);
            const actor = token.actor;
            if (!actor || SystemBridge.isPlayerCharacter(actor) || !SystemBridge.isDead(actor)) continue;

            if (state === BUTCHER_STATE.READY) {
                const target = this.buildTargetFromActor(actor, token, { allowResolved: true });
                if (target && !readyById.has(target.combatantId)) {
                    readyById.set(target.combatantId, { ...target, butcherState: BUTCHER_STATE.READY });
                }
                continue;
            }

            if (!showHarvestedMarker(state)) continue;
            const target = this.buildTargetFromActor(actor, token, { allowResolved: true });
            if (!target) continue;
            harvested.push({ ...target, butcherState: BUTCHER_STATE.HARVESTED });
        }
        return [...readyById.values(), ...harvested];
    },

    /**
     * Rebuild the in-memory pending queue from persisted token flags after reload.
     * Ready corpses keep their offer until butchered or passed.
     */
    rehydrateSceneState() {
        if (!canvas?.ready || !CreatureRegistry.hasEntries()) return;
        if (SystemBridge.unsupportedNotice()) return;

        const seen = new Set();
        const readyCandidates = [];

        const ingestReady = (token, target) => {
            if (!target || seen.has(target.combatantId)) return;
            if (getButcherState(token) !== BUTCHER_STATE.READY) return;
            seen.add(target.combatantId);
            readyCandidates.push(target);
        };

        for (const token of canvas.tokens?.placeables ?? []) {
            const actor = token.actor;
            if (!actor || SystemBridge.isPlayerCharacter(actor) || !SystemBridge.isDead(actor)) continue;
            const target = this.buildTargetFromActor(actor, token, { allowResolved: true });
            ingestReady(token, target);
        }

        for (const [tokenId, entry] of Object.entries(getSceneCorpseRegistry())) {
            if (entry?.state !== BUTCHER_STATE.READY) continue;
            const token = resolveTokenFromRegistryEntry(tokenId, entry);
            if (!token?.actor) continue;
            if (SystemBridge.isPlayerCharacter(token.actor) || !SystemBridge.isDead(token.actor)) continue;
            const target = this.buildTargetFromActor(token.actor, token, { allowResolved: true });
            ingestReady(token, target);
        }

        readyCandidates.sort((left, right) => right.cr - left.cr);
        for (const target of readyCandidates.slice(0, 3)) {
            if (!_pendingTargets.has(target.combatantId)) {
                _pendingTargets.set(target.combatantId, target);
            }
        }
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
        this.rehydrateSceneState();

        const notice = SystemBridge.unsupportedNotice();
        if (notice || !CreatureRegistry.hasEntries() || !canvas?.ready) {
            _markerService?.syncShow(this.getCorpseMarkerEntries());
            return [];
        }

        if (!game.settings.get(MODULE_ID, "promptOnCombatEnd")) {
            _markerService?.syncShow(this.getCorpseMarkerEntries());
            return [];
        }

        const butchers = this.findButcherActors();
        if (!butchers.length) {
            _markerDebug("scanSceneCorpses: no eligible butcher", { reason, requireHandbook: game.settings.get(MODULE_ID, "requireHandbook") });
            this.rehydrateSceneState();
            _markerService?.syncShow(this.getCorpseMarkerEntries());
            return [];
        }

        const discovered = [];
        for (const token of canvas.tokens?.placeables ?? []) {
            const actor = token.actor;
            if (!actor || SystemBridge.isPlayerCharacter(actor) || !SystemBridge.isDead(actor)) continue;
            if (!isButcherableState(getButcherState(token))) continue;
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
            if (!_isTargetButcherable(target)) continue;
            _pendingTargets.set(target.combatantId, target);
            await _markCorpseReady(target);
            if (createChat) {
                await ChatMessage.create({
                    user: game.user.id,
                    speaker: ChatMessage.getSpeaker(),
                    content: buildPromptCard(target, butchers),
                    flags: { [MODULE_ID]: { butcherPrompt: true, combatantId: target.combatantId } }
                });
            }
        }

        _markerService?.syncShow(this.getCorpseMarkerEntries());
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
            markerCount: _markerService?.count() ?? 0,
            canSeeMarkers: _markerService?.canUserSeeMarkers?.() ?? null,
            butcherState: token ? getButcherState(token) : null
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
            sceneCorpseRegistry: getSceneCorpseRegistry(),
            markerCount: _markerService?.count() ?? 0,
            overlayReady: _markerService?.isOverlayReady?.() ?? false
        };
    },

    findCanvasTokenForActor(actor, hints = {}) {
        return ButcherEligibility.findCanvasTokenForActor(actor, hints);
    },

    /**
     * @param {Combat} combat
     * @returns {object[]}
     */
    findButcherTargets(combat) {
        return ButcherEligibility.findButcherTargets(combat, { markerDebug: _markerDebug });
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

    buildTargetFromActor(actor, token, { allowResolved = false } = {}) {
        return ButcherEligibility.buildTargetFromActor(actor, token, { allowResolved });
    },

    findButcherActors() {
        return ButcherEligibility.findButcherActors();
    },

    /**
     * @param {Actor} actor
     * @returns {boolean}
     */
    isEligibleButcher(actor) {
        return ButcherEligibility.isEligibleButcher(actor);
    },

    /**
     * Prefer a selected PC token, then a book carrier, then the first eligible party member.
     * @returns {Actor|null}
     */
    resolveButcherActor() {
        return ButcherEligibility.resolveButcherActor();
    },

    /**
     * Whether the butcher's token can reach the corpse on the active scene.
     * Uses the library reach service when available.
     * @param {Actor} butcher
     * @param {object} target
     * @param {object} [options]
     * @returns {{ ok: boolean, reason?: string|null }}
     */
    canReachCorpse(butcher, target, options = {}) {
        return ButcherEligibility.canReachCorpse(butcher, target, options);
    },

    /**
     * @param {Actor} butcher
     * @param {object} target
     * @param {object} [options]
     * @returns {boolean}
     */
    assertButcherReach(butcher, target, options = {}) {
        return ButcherEligibility.assertButcherReach(butcher, target, options);
    },

    calculateDC(cr) {
        return ButcherEligibility.calculateDC(cr);
    },

    determineOutcome(rollTotal, dc, naturalRoll) {
        return ButcherEligibility.determineOutcome(rollTotal, dc, naturalRoll);
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

        if (!this.assertButcherReach(butcher, target)) {
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

        _pendingTargets.delete(target.combatantId);
        await _markCorpseHarvested(target);
        _markerService?.syncShow(this.getCorpseMarkerEntries());
        return result;
    },

    getPendingTarget(combatantId) {
        return _pendingTargets.get(combatantId) ?? null;
    },

    /**
     * Rebuild a butcher prompt target on clients that never received the GM
     * pending queue. Chat cards and markers carry enough ids to locate the
     * corpse token on the active scene.
     * @param {string} combatantId
     * @param {{ actorId?: string|null, tokenId?: string|null }} [hints]
     * @returns {object|null}
     */
    resolvePromptTarget(combatantId, { actorId = null, tokenId = null } = {}) {
        const pending = this.getPendingTarget(combatantId);
        if (pending) return pending;

        const resolvedTokenId = tokenId ?? combatantId;
        let actor = actorId ? game.actors.get(actorId) : null;
        let token = this.findCanvasTokenForActor(actor, {
            combatantId,
            tokenId: resolvedTokenId
        });

        if (!token && resolvedTokenId) {
            token = canvas?.tokens?.placeables?.find(
                entry => entry.id === resolvedTokenId || entry.document?.id === resolvedTokenId
            ) ?? null;
            actor = actor ?? token?.actor ?? null;
        }

        if (!actor) return null;
        return this.buildTargetFromActor(actor, token);
    },

    /**
     * The PC who should resolve a butcher prompt for the connected user.
     * Players act as their assigned character; the GM keeps the existing
     * selection and book-carrier heuristics.
     * @param {User} [user]
     * @returns {Actor|null}
     */
    resolveActingButcher(user = game.user) {
        if (!user) return null;

        if (user.isGM) {
            return this.resolveButcherActor();
        }

        const assigned = user.character;
        if (assigned && this.isEligibleButcher(assigned)) {
            return assigned;
        }

        for (const token of canvas?.tokens?.controlled ?? []) {
            const actor = token?.actor;
            if (actor?.isOwner && this.isEligibleButcher(actor)) return actor;
        }

        const ownedEligible = game.actors.filter(
            actor => actor.isOwner && this.isEligibleButcher(actor)
        );
        if (ownedEligible.length === 1) return ownedEligible[0];

        return null;
    },

    clearPendingTarget(combatantId) {
        _pendingTargets.delete(combatantId);
        _markerService?.clear(combatantId);
    },

    async passTarget(combatantId, creatureName, target = null) {
        const resolved = target ?? _pendingTargets.get(combatantId);
        if (resolved) await _markCorpsePassed(resolved);
        this.clearPendingTarget(combatantId);
        _markerService?.syncShow(this.getCorpseMarkerEntries());
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker(),
            content: buildPassedCard(creatureName)
        });
    }
};
