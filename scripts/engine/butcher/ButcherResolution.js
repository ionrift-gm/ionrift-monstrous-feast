import { Logger } from "../../lib/Logger.js";
import { SystemBridge } from "../../compat/SystemBridge.js";
import { grantYields, revokeYields } from "../../services/butcher/ItemFactory.js";
import { DiscoveryService } from "../../services/cookbook/DiscoveryService.js";
import { buildPromptCard, buildResultCard } from "../../ui/butcher/ButcherCards.js";
import { MODULE_ID } from "../../data/moduleId.js";
import {
    BUTCHER_STATE,
    getSceneCorpseRegistry,
    persistButcherState
} from "../../services/butcher/ButcherTokenState.js";

/**
 * Resolution and GM undo workflows for ButcherEngine.
 */
export const ButcherResolution = {
    /**
     * Resolve a survival roll, grant yields, record discovery, and post the result card.
     * @param {object} engine - ButcherEngine instance
     * @param {Actor} butcher
     * @param {object} target
     * @param {{ onHarvested?: (target: object) => Promise<void> }} [hooks]
     * @returns {Promise<object|null>}
     */
    async resolve(engine, butcher, target, { onHarvested } = {}) {
        const notice = SystemBridge.unsupportedNotice();
        if (notice) {
            ui.notifications.warn(notice);
            return null;
        }

        if (!engine.assertButcherReach(butcher, target)) {
            return null;
        }

        const { registryEntry, cr, actorName } = target;
        const dc = target.dc ?? engine.calculateDC(cr);
        const rollResult = await SystemBridge.rollSurvival(
            butcher,
            dc,
            `Butchering ${actorName}`
        );

        const outcome = engine.determineOutcome(rollResult.total, dc, rollResult.natural);
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
            flags: {
                [MODULE_ID]: {
                    butcherResult: true,
                    undone: false,
                    butcherActorId: butcher.id,
                    butcherActorUuid: butcher.uuid,
                    typeId,
                    combatantId: target.combatantId,
                    tokenId: target.tokenId ?? null,
                    targetActorId: target.actor?.id ?? null,
                    targetActorUuid: target.actor?.uuid ?? null,
                    creatureName: actorName,
                    tier: registryEntry.tier ?? "common",
                    yields,
                    targetData: {
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
                    }
                }
            }
        });

        if (onHarvested) {
            await onHarvested(target);
        }
        return result;
    },

    /**
     * GM action: undo a completed butchering, revoking granted items from the
     * butcher's inventory, returning the corpse to ready state, syncing canvas
     * markers, and re-offering the butcher prompt.
     * @param {object} engine - ButcherEngine instance
     * @param {ChatMessage} message
     * @param {HTMLElement|null} [root]
     * @param {{ onRestored?: (token: object|null, target: object|null) => Promise<void> }} [hooks]
     * @returns {Promise<boolean>}
     */
    async undoResult(engine, message, root = null, { onRestored } = {}) {
        if (!game.user?.isGM) {
            ui.notifications?.warn("Only the GM can undo butchering.");
            return false;
        }

        const flags = message?.flags?.[MODULE_ID] ?? {};
        if (flags.undone) {
            ui.notifications?.info("This butchering has already been undone.");
            return false;
        }

        // 1. Resolve butcher actor
        let butcher = null;
        if (flags.butcherActorId) {
            butcher = game.actors?.get(flags.butcherActorId) ?? null;
        }
        if (!butcher && flags.butcherActorUuid) {
            try {
                const doc = fromUuidSync(flags.butcherActorUuid);
                butcher = doc?.actor ?? doc ?? null;
            } catch {}
        }
        if (!butcher && message.speaker?.actor) {
            butcher = game.actors?.get(message.speaker.actor) ?? null;
        }
        if (!butcher && message.speaker?.alias) {
            butcher = game.actors?.find(a => a.name === message.speaker.alias) ?? null;
        }

        // 2. Resolve creature name
        const creatureName = flags.creatureName
            ?? flags.actorName
            ?? root?.querySelector?.(".mf-butcher-title h3")?.textContent?.trim()
            ?? "creature";

        // 3. Resolve yields
        let yields = Array.isArray(flags.yields) && flags.yields.length ? flags.yields : null;
        if (!yields) {
            yields = [];
            const liElements = root?.querySelectorAll?.(".mf-butcher-yields li");
            if (liElements && liElements.length) {
                for (const li of liElements) {
                    const text = li.textContent.trim();
                    const m = text.match(/^(\d+)x\s+(.+?)(?:\s+loot)?$/i);
                    if (m) {
                        yields.push({
                            qty: parseInt(m[1], 10),
                            name: m[2].trim(),
                            type: /loot/i.test(text) ? "loot" : "food"
                        });
                    }
                }
            } else if (message.content) {
                const regex = /<li>(\d+)x\s+([^<]+?)(?:<span[^>]*>loot<\/span>)?<\/li>/gi;
                let match;
                while ((match = regex.exec(message.content)) !== null) {
                    yields.push({
                        qty: parseInt(match[1], 10),
                        name: match[2].replace(/\s*loot\s*$/i, "").trim(),
                        type: /loot/i.test(match[0]) ? "loot" : "food"
                    });
                }
            }
        }

        // 4. Revoke yields from the butcher actor
        if (butcher && yields?.length) {
            await revokeYields(butcher, yields, creatureName);
        } else if (!butcher) {
            Logger.warn("Monstrous Feast | Undo: butcher actor could not be resolved.", message.speaker);
        }

        // 5. Revoke party discovery if applicable
        const typeId = flags.typeId
            ?? flags.targetData?.classifierResult?.id
            ?? flags.targetData?.registryEntry?.id;
        if (typeId) {
            const partyBook = DiscoveryService.findPartyCookbook();
            if (partyBook) {
                await DiscoveryService.removeDiscoveredType(partyBook, typeId);
            }
        }

        // 6. Resolve token & target to restore corpse offering
        let tokenId = flags.tokenId ?? flags.targetData?.tokenId ?? null;
        let token = tokenId
            ? canvas?.tokens?.placeables?.find(t => t.id === tokenId || t.document?.id === tokenId) ?? null
            : null;

        if (!token) {
            const sceneReg = getSceneCorpseRegistry();
            for (const [regTokenId, entry] of Object.entries(sceneReg)) {
                if (entry.actorName === creatureName || entry.tokenId === tokenId) {
                    tokenId = regTokenId;
                    token = canvas?.tokens?.placeables?.find(t => t.id === regTokenId || t.document?.id === regTokenId) ?? null;
                    break;
                }
            }
        }

        let targetActor = flags.targetActorId
            ? game.actors?.get(flags.targetActorId)
            : (token?.actor ?? null);

        if (!targetActor && flags.targetActorUuid) {
            try {
                const doc = fromUuidSync(flags.targetActorUuid);
                targetActor = doc?.actor ?? doc ?? null;
            } catch {}
        }

        let target = null;
        if (flags.targetData) {
            target = {
                ...flags.targetData,
                actor: targetActor ?? token?.actor ?? null,
                tokenId: tokenId ?? flags.targetData.tokenId
            };
        } else if (targetActor) {
            target = engine.buildTargetFromActor(targetActor, token, { allowResolved: true });
        }

        if (!target && (token || targetActor)) {
            target = {
                tokenId: tokenId ?? token?.document?.id ?? token?.id ?? null,
                combatantId: tokenId ?? token?.document?.id ?? token?.id ?? targetActor?.id,
                actor: targetActor ?? token?.actor ?? null,
                actorName: creatureName
            };
        }

        if (token || target) {
            await persistButcherState(token, target, BUTCHER_STATE.READY);
            if (onRestored) {
                await onRestored(token, target);
            }
        }

        // 7. Re-post the butcher prompt card to chat
        const butchers = engine.findButcherActors();
        if (target && butchers.length) {
            await ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker(),
                content: buildPromptCard(target, butchers),
                flags: { [MODULE_ID]: { butcherPrompt: true, combatantId: target.combatantId } }
            });
        }

        // 8. Update this result card to show undone banner
        let updatedContent = message.content ?? "";
        const undoneHtml = `<div class="mf-butcher-undone"><i class="fas fa-rotate-left"></i> Butchering undone by GM. Offering restored.</div>`;

        if (updatedContent.includes('class="mf-butcher-actions')) {
            updatedContent = updatedContent.replace(
                /<div class="mf-butcher-actions[\s\S]*?<\/div>/,
                undoneHtml
            );
        } else {
            updatedContent += `\n${undoneHtml}`;
        }

        await message.update({
            content: updatedContent,
            flags: {
                [MODULE_ID]: {
                    ...flags,
                    undone: true
                }
            }
        });

        if (root) {
            root.querySelectorAll(".mf-butcher-actions, .mf-btn-undo").forEach(el => el.remove());
            if (!root.querySelector(".mf-butcher-undone")) {
                const undoneDiv = document.createElement("div");
                undoneDiv.className = "mf-butcher-undone";
                undoneDiv.innerHTML = `<i class="fas fa-rotate-left"></i> Butchering undone by GM. Offering restored.`;
                root.appendChild(undoneDiv);
            }
        }

        ui.notifications?.info(`Monstrous Feast: Butchering undone for ${creatureName}. Items removed and offering restored.`);
        return true;
    }
};
