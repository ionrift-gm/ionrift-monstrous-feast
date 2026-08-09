import { Logger } from "../lib/Logger.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { MODULE_ID } from "../data/moduleId.js";
import {
    BUTCHER_STATE,
    clearLocalButcherStateOverrides,
    clearSceneCorpseEntry
} from "./butcher/ButcherTokenState.js";
import { ButcherMarkerPresentation } from "./butcher/ButcherMarkerPresentation.js";

const MAX_MARKERS = 3;
const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const SOCKET_ACTION_SHOW = "showButcherMarkers";
let _butcherEngine = null;

function markerDebug(...args) {
    if (game.settings?.get?.(MODULE_ID, "debug")) {
        Logger.warn("MF ButcherMarker", ...args);
    }
}

function markerWarn(...args) {
    Logger.warn("MF ButcherMarker", ...args);
}

function resolveTargetActor(target) {
    if (target?.actor) return target.actor;
    if (!target?.actorUuid) return null;
    try {
        const document = fromUuidSync(target.actorUuid);
        return document?.actor ?? document ?? null;
    } catch {
        return null;
    }
}

function resolveTokenForTarget(target) {
    return _butcherEngine?.findCanvasTokenForActor(target?.actor, {
        combatantId: target?.combatantId,
        tokenId: target?.tokenId
    }) ?? null;
}

function userCanSeeMarkers() {
    if (game.user?.isGM) return true;
    return (_butcherEngine?.findButcherActors() ?? []).some(actor => actor.isOwner);
}

async function handleMarkerClick(combatantId, fallbackTarget) {
    const target = _butcherEngine?.getPendingTarget(combatantId) ?? fallbackTarget;
    if (!target) {
        ui.notifications.warn("Butcher prompt expired or already resolved.");
        ButcherCorpseMarker.clear(combatantId);
        return;
    }
    const butcher = _butcherEngine?.resolveActingButcher();
    if (!butcher) {
        ui.notifications.warn("No eligible butcher available.");
        return;
    }
    _butcherEngine.clearPendingTarget(combatantId);
    await _butcherEngine.resolve(butcher, target);
}

async function applyTargetsWithIcons(targets) {
    await ButcherMarkerPresentation.ensureReady();
    ButcherCorpseMarker.showTargets(targets);
    await ButcherMarkerPresentation.refreshIcons();
}

async function restoreMarkersAfterCanvasReady() {
    if (!canvas?.ready) return;
    ButcherMarkerPresentation.reset();
    await ButcherMarkerPresentation.ensureReady();
    _butcherEngine?.rehydrateSceneState();

    if (game.user?.isGM && _butcherEngine) {
        await _butcherEngine.scanSceneCorpses({ createChat: false, reason: "canvasReady" });
    }

    const entries = _butcherEngine?.getCorpseMarkerEntries?.() ?? [];
    if (entries.length) ButcherCorpseMarker.showTargets(entries);
    await ButcherMarkerPresentation.refreshIcons();
}

function onSocket(data) {
    if (data?.action !== SOCKET_ACTION_SHOW || !Array.isArray(data.targets)) return;
    markerDebug("socket showButcherMarkers", { count: data.targets.length });
    void applyTargetsWithIcons(data.targets);
}

export const ButcherCorpseMarker = {
    configure({ butcherEngine, presentation = ButcherMarkerPresentation } = {}) {
        _butcherEngine = butcherEngine ?? null;
        presentation.configure({
            debug: markerDebug,
            warn: markerWarn,
            onClick: handleMarkerClick
        });
    },

    init() {
        markerWarn("marker service registered");
        if (game.socket) game.socket.on(SOCKET_CHANNEL, onSocket);

        Hooks.on("canvasTearDown", () => {
            clearLocalButcherStateOverrides();
            ButcherMarkerPresentation.reset();
        });

        Hooks.on("canvasReady", () => {
            markerDebug("canvasReady", {
                pending: _butcherEngine?.getPendingTargetsList?.()?.length ?? 0
            });
            void restoreMarkersAfterCanvasReady();
        });

        if (canvas?.ready) {
            markerDebug("init: canvas already ready, restoring markers");
            void restoreMarkersAfterCanvasReady();
        }

        Hooks.on("deleteToken", document => {
            clearSceneCorpseEntry(document.id).catch(() => {});
            ButcherMarkerPresentation.clearForToken(document.id);
        });
        Hooks.on("updateToken", document => {
            const actor = document.actor;
            if (!actor || SystemBridge.isDead(actor)) return;
            void _butcherEngine?.revokeButcherOffer(actor);
        });
    },

    /**
     * Show canvas markers for butcher targets.
     * @param {object[]} targets
     */
    showTargets(targets) {
        const normalizedTargets = targets ?? [];
        markerDebug("showTargets", {
            incoming: normalizedTargets.length,
            canvasReady: Boolean(canvas?.ready)
        });
        if (!normalizedTargets.length) {
            ButcherMarkerPresentation.retain(new Set());
            return;
        }
        if (!canvas?.ready) {
            markerWarn("showTargets skipped: canvas not ready");
            return;
        }
        if (!userCanSeeMarkers()) {
            markerWarn("showTargets skipped: user cannot see markers", {
                isGM: Boolean(game.user?.isGM),
                eligibleButchers: (_butcherEngine?.findButcherActors() ?? []).map(actor => actor.name)
            });
            return;
        }

        const ready = normalizedTargets
            .filter(entry => (entry.butcherState ?? BUTCHER_STATE.READY) === BUTCHER_STATE.READY)
            .slice(0, MAX_MARKERS);
        const harvested = normalizedTargets
            .filter(entry => entry.butcherState === BUTCHER_STATE.HARVESTED)
            .slice(0, 10);
        const visibleTargets = [...ready, ...harvested];
        ButcherMarkerPresentation.retain(
            new Set(visibleTargets.map(target => target.combatantId))
        );

        for (const target of visibleTargets) {
            const actor = resolveTargetActor(target);
            if (!actor) {
                markerWarn("showTargets skipped target: actor unresolved", {
                    combatantId: target.combatantId,
                    actorUuid: target.actorUuid ?? null
                });
                continue;
            }
            const token = resolveTokenForTarget({ ...target, actor });
            if (!token) {
                markerWarn("showTargets skipped target: no canvas token", {
                    combatantId: target.combatantId,
                    tokenId: target.tokenId ?? null,
                    actorId: actor.id,
                    actorName: target.actorName ?? actor.name
                });
                continue;
            }
            const hydrated = {
                ...target,
                actor,
                tokenId: target.tokenId ?? token.document?.id ?? token.id,
                butcherState: target.butcherState ?? BUTCHER_STATE.READY
            };
            if (ButcherMarkerPresentation.place(hydrated, token)) {
                markerDebug("marker placed", {
                    combatantId: target.combatantId,
                    tokenId: hydrated.tokenId,
                    actorName: hydrated.actorName ?? actor.name,
                    butcherState: hydrated.butcherState
                });
            }
        }

        if (!this.count()) {
            markerDebug("showTargets finished with zero markers", {
                requested: visibleTargets.length
            });
        }
    },

    syncShow(targets) {
        const normalizedTargets = targets ?? [];
        this.showTargets(normalizedTargets);
        void ButcherMarkerPresentation.refreshIcons();
        if (!game.user.isGM || !game.socket) return;
        game.socket.emit(SOCKET_CHANNEL, {
            action: SOCKET_ACTION_SHOW,
            targets: _butcherEngine?.serializeTargets(normalizedTargets) ?? normalizedTargets
        });
    },

    clear(combatantId) {
        ButcherMarkerPresentation.clear(combatantId);
    },

    clearAll() {
        ButcherMarkerPresentation.clearAll();
    },

    count() {
        return ButcherMarkerPresentation.count();
    },

    canUserSeeMarkers() {
        return userCanSeeMarkers();
    },

    isOverlayReady() {
        return ButcherMarkerPresentation.isOverlayReady();
    },

    getDebugState() {
        return {
            ...ButcherMarkerPresentation.getDebugState(),
            debugEnabled: Boolean(game.settings?.get?.(MODULE_ID, "debug"))
        };
    }
};
