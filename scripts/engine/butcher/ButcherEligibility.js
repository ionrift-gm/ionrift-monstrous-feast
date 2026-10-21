import { Library } from "../../compat/Library.js";
import { SystemBridge } from "../../compat/SystemBridge.js";
import { CreatureRegistry } from "../../data/catalogs/CreatureRegistry.js";
import { DiscoveryService } from "../../services/cookbook/DiscoveryService.js";
import { getButcherState, isButcherableState } from "../../services/butcher/ButcherTokenState.js";
import { MODULE_ID } from "../../data/moduleId.js";

function classificationForActor(actor) {
    let classification = Library.classify(actor);
    if (!classification?.id || classification.id === "unknown") {
        const rawType = (actor.system?.details?.type?.value ?? "").toLowerCase();
        if (!rawType) return null;
        classification = { id: rawType, label: rawType };
    }
    return classification;
}

/**
 * Eligibility, target construction, reach, and outcome rules for butchering.
 * ButcherEngine delegates its public methods here.
 */
export const ButcherEligibility = {
    findCanvasTokenForActor(actor, { combatantId = null, tokenId = null } = {}) {
        const placeables = canvas?.tokens?.placeables;
        if (!placeables?.length) return null;

        if (tokenId) {
            const byTokenId = placeables.find(
                entry => entry.id === tokenId || entry.document?.id === tokenId
            );
            if (byTokenId) return byTokenId;
        }

        const directTokenId = actor?.token?.id ?? actor?.token?.object?.id ?? null;
        if (directTokenId) {
            const byDirectToken = placeables.find(
                entry => entry.id === directTokenId || entry.document?.id === directTokenId
            );
            if (byDirectToken) return byDirectToken;
        }

        if (combatantId) {
            const combatant = game.combat?.combatants?.get?.(combatantId) ?? null;
            const combatantTokenId = combatant?.tokenId ?? combatant?.token?.id ?? null;
            if (combatantTokenId) {
                const byCombatantToken = placeables.find(
                    entry => entry.id === combatantTokenId || entry.document?.id === combatantTokenId
                );
                if (byCombatantToken) return byCombatantToken;
            }
            const byCombatant = placeables.find(
                entry => entry.combatant?.id === combatantId || entry.document?.combatantId === combatantId
            );
            if (byCombatant) return byCombatant;
            const byDocId = placeables.find(
                entry => entry.id === combatantId || entry.document?.id === combatantId
            );
            if (byDocId) return byDocId;
        }

        if (!actor?.id) return null;
        if (actor.uuid) {
            const byUuid = placeables.find(entry => entry.actor?.uuid === actor.uuid);
            if (byUuid) return byUuid;
        }
        if (actor.isToken) return null;
        return placeables.find(entry =>
            entry.actor?.id === actor.id
            || entry.document?.actorId === actor.id
        ) ?? null;
    },

    /**
     * Determine if an actor or token represents a loot container, vehicle, hazard, or non-creature pile.
     * @param {Actor|null} actor
     * @param {Token|null} [token]
     * @returns {boolean}
     */
    isLootContainer(actor, token = null) {
        if (!actor) return false;

        const type = String(actor.type ?? "").toLowerCase();
        if (["loot", "container", "vehicle", "hazard", "merchant"].includes(type)) return true;

        const itemPilesData = actor.flags?.["item-piles"]?.data ?? token?.document?.flags?.["item-piles"]?.data;
        if (itemPilesData?.enabled === true) return true;
        if (actor.getFlag?.("item-piles", "data.enabled") === true) return true;
        if (token?.document?.getFlag?.("item-piles", "data.enabled") === true) return true;
        if (globalThis.game?.itempiles?.API?.isItemPile?.(actor) || globalThis.game?.itempiles?.API?.isItemPile?.(token)) return true;

        if (actor.flags?.lootsheetnpc5e) return true;
        const lootSheetType = actor.getFlag?.("lootsheetnpc5e", "lootsheettype");
        if (lootSheetType === "Loot" || lootSheetType === "Merchant") return true;
        const sheetClass = String(actor.flags?.core?.sheetClass ?? "").toLowerCase();
        if (sheetClass.includes("loot")) return true;

        const nameCandidates = [token?.name, token?.document?.name, actor.name].filter(Boolean);
        const LOOT_NAME_PATTERN = /\b(loot|chest|crate|barrel|cache|hoard|container)\b/i;
        if (nameCandidates.some(n => LOOT_NAME_PATTERN.test(n))) return true;

        return false;
    },

    buildTargetFromActor(actor, token, { allowResolved = false, allowLoot = false } = {}) {
        if (token && !allowResolved && !isButcherableState(getButcherState(token))) return null;
        if (!allowLoot && this.isLootContainer(actor, token)) return null;
        const cr = SystemBridge.getChallengeRating(actor);
        const classification = classificationForActor(actor);
        if (!classification) return null;
        const registryEntry = CreatureRegistry.lookup(classification, cr);
        if (!registryEntry) return null;
        const tokenId = token?.document?.id ?? token?.id ?? null;
        return {
            combatantId: tokenId ?? actor.id,
            tokenId,
            actor,
            actorName: actor.name ?? "Unknown Creature",
            actorImg: actor.img ?? token?.texture?.src ?? "icons/svg/mystery-man.svg",
            classifierResult: classification,
            registryEntry,
            cr,
            crLabel: SystemBridge.systemId() === "pf2e" ? "Level" : "CR",
            dc: this.calculateDC(cr)
        };
    },

    findButcherTargets(combat, { markerDebug = () => {} } = {}) {
        const targets = [];
        for (const combatant of combat?.combatants?.contents ?? []) {
            const actor = combatant.actor;
            if (!actor || SystemBridge.isPlayerCharacter(actor) || !SystemBridge.isDead(actor)) continue;

            const combatantTokenId = combatant.tokenId ?? combatant.token?.id ?? null;
            const token = this.findCanvasTokenForActor(actor, {
                combatantId: combatant.id,
                tokenId: combatantTokenId
            });
            if (this.isLootContainer(actor, token)) continue;

            const cr = SystemBridge.getChallengeRating(actor);
            const classification = classificationForActor(actor);
            if (!classification) continue;
            const registryEntry = CreatureRegistry.lookup(classification, cr);
            if (!registryEntry) {
                markerDebug("combatant skipped: registry miss", {
                    name: actor.name,
                    classification: classification.id,
                    cr
                });
                continue;
            }

            if (!isButcherableState(getButcherState(token))) {
                markerDebug("combatant skipped: already harvested or passed", { name: actor.name });
                continue;
            }
            targets.push({
                combatantId: combatant.id,
                tokenId: token?.document?.id ?? token?.id ?? combatantTokenId ?? null,
                actor,
                actorName: actor.name ?? combatant.name ?? "Unknown Creature",
                actorImg: actor.img ?? combatant.img ?? "icons/svg/mystery-man.svg",
                classifierResult: classification,
                registryEntry,
                cr,
                crLabel: SystemBridge.systemId() === "pf2e" ? "Level" : "CR",
                dc: this.calculateDC(cr)
            });
        }

        targets.sort((left, right) => right.cr - left.cr);
        return targets;
    },

    findButcherActors() {
        return DiscoveryService.partyActors().filter(actor => this.isEligibleButcher(actor));
    },

    isEligibleButcher(actor) {
        if (!actor || SystemBridge.isDead(actor)) return false;
        if (game.settings.get(MODULE_ID, "requireHandbook")) {
            return Boolean(DiscoveryService.findBookOnActor(actor));
        }
        return true;
    },

    resolveButcherActor() {
        const eligible = this.findButcherActors();
        if (!eligible.length) return null;

        for (const token of canvas.tokens?.controlled ?? []) {
            const actor = token.actor;
            if (!actor || !this.isEligibleButcher(actor)) continue;
            if (SystemBridge.isPlayerCharacter(actor)) return actor;
        }

        const withBook = eligible.filter(actor => DiscoveryService.findBookOnActor(actor));
        return withBook[0] ?? eligible[0];
    },

    canReachCorpse(butcher, target, options = {}) {
        const reach = Library.reach;
        if (!reach?.canReachToken) return { ok: true, reason: "unavailable" };

        const sourceToken = this.findCanvasTokenForActor(butcher);
        const corpseToken = this.findCanvasTokenForActor(target?.actor, {
            combatantId: target?.combatantId,
            tokenId: target?.tokenId
        });
        if (!sourceToken) return { ok: false, reason: "no_butcher_token" };
        if (!corpseToken) return { ok: false, reason: "no_corpse_token" };

        const result = reach.canReachToken(sourceToken, corpseToken, {
            squares: options.squares ?? 1,
            ...options
        });
        return { ok: result.ok, reason: result.reason ?? null, result };
    },

    assertButcherReach(butcher, target, options = {}) {
        const check = this.canReachCorpse(butcher, target, options);
        if (check.ok) return true;

        const message = check.reason === "no_butcher_token"
            ? "Place your character on the scene to butcher this creature."
            : check.reason === "no_corpse_token"
                ? "Could not find that creature on the map."
                : Library.reach?.reachFailureMessage?.(check.result, options)
                    ?? "Move closer to butcher this creature.";
        ui.notifications.warn(message);
        return false;
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
    }
};
