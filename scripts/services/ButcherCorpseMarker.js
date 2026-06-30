import { Logger } from "../lib/Logger.js";
import { ButcherEngine } from "../engine/ButcherEngine.js";
import { SystemBridge } from "../compat/SystemBridge.js";
import { BUTCHER_STATE, clearLocalButcherStateOverrides, clearSceneCorpseEntry } from "./ButcherTokenState.js";

const MODULE_ID = "ionrift-monstrous-feast";
const MAX_MARKERS = 3;

function _markerDebug(...args) {
    const verbose = game.settings?.get?.(MODULE_ID, "debugButcherMarker");
    if (verbose) Logger.warn("MF ButcherMarker", ...args);
}

function _markerWarn(...args) {
    Logger.warn("MF ButcherMarker", ...args);
}

function _isDebugEnabled() {
    return !!game.settings?.get?.(MODULE_ID, "debugButcherMarker");
}

/** FA5/6 Free Solid codepoints verified on Foundry installs (see StationInteractionLayer). */
const FA_SOLID_CODEPOINT = {
    "fa-utensils": 0xf2e7,
    "fa-fire": 0xf06d,
    "fa-check": 0xf00c
};

const MARKER_ICON_KEYS = ["fa-utensils", "fa-fire"];
const HARVESTED_ICON_KEY = "fa-check";

const MARKER = {
    BADGE_R: 14,
    ICON_RASTER_PX: 44,
    ICON_SPRITE_MAX: 18,
    FILL: 0xf5d0a0,
    FILL_HARVESTED: 0xa8b896,
    BORDER: 0x8b4513,
    BORDER_HARVESTED: 0x4a5c3a,
    BORDER_HOVER: 0xc9782e,
    BG_ALPHA: 0.92,
    BG_ALPHA_HARVESTED: 0.72,
    LABEL_GAP: 5,
    FONT_TOOLTIP: {
        fontFamily: "Signika, sans-serif",
        fontSize: 11,
        fill: 0xffffff,
        fontWeight: "bold",
        align: "center",
        stroke: 0x1a1208,
        strokeThickness: 3
    }
};

let _solidFamilyCache = null;
let _iconTexCache = null;
let _overlayContainer = null;
let _tickerBound = null;
let _tokensSortablePrev = undefined;
let _savedTokensSortable = false;
/** @type {Map<string, CorpseMarkerOverlay>} */
const _markers = new Map();

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const SOCKET_ACTION_SHOW = "showButcherMarkers";

function _faSolidFamily() {
    if (_solidFamilyCache) return _solidFamilyCache;
    try {
        const probe = document.createElement("i");
        probe.className = "fas fa-solid fa-fire";
        probe.style.cssText = "position:absolute;left:-9999px;top:0;opacity:0;";
        document.body.appendChild(probe);
        const famCss = window.getComputedStyle(probe, "::before").fontFamily
            || window.getComputedStyle(probe).fontFamily;
        probe.remove();
        const primary = (famCss || "").split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
        if (/font\s*awesome/i.test(primary) && !/duotone|brands/i.test(primary)) {
            _solidFamilyCache = primary;
            return primary;
        }
    } catch { /* probe unsupported */ }
    try {
        for (const face of document.fonts) {
            if (!/font\s*awesome/i.test(face.family)) continue;
            if (/duotone|brands/i.test(face.family)) continue;
            const w = Number(String(face.weight).split(/\s+/)[0]) || 400;
            if (w === 900) {
                _solidFamilyCache = face.family.replace(/^['"]|['"]$/g, "");
                return _solidFamilyCache;
            }
        }
    } catch { /* iteration unsupported */ }
    return "Font Awesome 6 Free";
}

function _hexRgb(n) {
    return `#${(n >>> 0).toString(16).padStart(6, "0")}`;
}

function _scanInkBounds(ctx, w, h) {
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > 12) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return null;
    return { minX, minY, maxX, maxY };
}

function _rasterIconCanvas(fill, px, iconKey = "fa-utensils") {
    const cp = FA_SOLID_CODEPOINT[iconKey];
    if (cp == null) return null;
    const glyph = String.fromCodePoint(cp);
    const family = _faSolidFamily();
    const fontCss = `900 ${px}px "${family.replace(/"/g, '\\"')}"`;
    const big = Math.max(64, px * 4);
    const scratch = document.createElement("canvas");
    scratch.width = big;
    scratch.height = big;
    const sctx = scratch.getContext("2d");
    sctx.clearRect(0, 0, big, big);
    sctx.fillStyle = _hexRgb(fill);
    sctx.font = fontCss;
    sctx.textAlign = "center";
    sctx.textBaseline = "middle";
    sctx.fillText(glyph, big / 2, big / 2);

    const bb = _scanInkBounds(sctx, big, big);
    if (!bb) return null;
    const gW = bb.maxX - bb.minX + 1;
    const gH = bb.maxY - bb.minY + 1;
    const pad = Math.max(2, Math.round(px * 0.12));
    const size = Math.max(gW, gH) + pad * 2;
    const out = document.createElement("canvas");
    out.width = size;
    out.height = size;
    out.getContext("2d").drawImage(
        scratch,
        bb.minX, bb.minY, gW, gH,
        Math.round((size - gW) / 2), Math.round((size - gH) / 2), gW, gH
    );
    return out;
}

function _layoutIconSprite(sprite, tex) {
    const max = MARKER.ICON_SPRITE_MAX;
    const w = tex?.width ?? max;
    const h = tex?.height ?? max;
    const scale = max / Math.max(w, h, 1);
    sprite.scale.set(scale);
    sprite.anchor.set(0.5, 0.5);
}

function _textureUsable(tex) {
    if (!tex || tex.destroyed) return false;
    const source = tex.baseTexture ?? tex.source;
    if (source?.destroyed) return false;
    if (source?.valid === false) return false;
    return true;
}

function _resetCanvasGraphics() {
    for (const id of [..._markers.keys()]) {
        const overlay = _markers.get(id);
        overlay?.destroy();
        _markers.delete(id);
    }
    _stopTickerIfEmpty();

    if (_iconTexCache) {
        for (const tex of _iconTexCache.values()) {
            try {
                tex?.destroy?.(true);
            } catch { /* canvas already torn down */ }
        }
        _iconTexCache.clear();
    }

    if (_overlayContainer) {
        if (!_overlayContainer.destroyed) {
            try {
                _overlayContainer.parent?.removeChild?.(_overlayContainer);
                _overlayContainer.destroy({ children: true });
            } catch { /* canvas already torn down */ }
        }
        _overlayContainer = null;
    }

    _solidFamilyCache = null;
    _savedTokensSortable = false;
    _tokensSortablePrev = undefined;
}

function _iconTextureAsync(fill, px, iconKey = "fa-utensils") {
    if (!_iconTexCache) _iconTexCache = new Map();
    const key = `${iconKey}|${fill}|${px}`;
    if (_iconTexCache.has(key)) {
        const cached = _iconTexCache.get(key);
        if (_textureUsable(cached)) return Promise.resolve(cached);
        _iconTexCache.delete(key);
    }
    const cvs = _rasterIconCanvas(fill, px, iconKey);
    if (!cvs) return Promise.resolve(null);
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let tex = null;
            try {
                tex = PIXI.Texture.from(img);
                tex?.baseTexture?.update?.();
            } catch {
                tex = null;
            }
            if (tex) _iconTexCache.set(key, tex);
            resolve(tex);
        };
        img.onerror = () => resolve(null);
        img.src = cvs.toDataURL("image/png");
    });
}

async function _resolveMarkerIconTexture(fill, px) {
    await ensureIconFontsLoaded();
    for (const iconKey of MARKER_ICON_KEYS) {
        const tex = await _iconTextureAsync(fill, px, iconKey);
        if (tex) return tex;
    }
    return null;
}

async function _resolveHarvestedIconTexture(fill, px) {
    await ensureIconFontsLoaded();
    return _iconTextureAsync(fill, px, HARVESTED_ICON_KEY);
}

/** Vector cleaver when FA raster fails (wrong font subset shows random glyphs). */
function _drawCleaverFallback(container) {
    const g = new PIXI.Graphics();
    g.beginFill(MARKER.FILL, 1);
    g.drawRect(-6, -8, 12, 10);
    g.drawRect(-3, 2, 6, 6);
    g.endFill();
    if ("eventMode" in g) g.eventMode = "none";
    container.addChild(g);
    return g;
}

function ensureIconFontsLoaded() {
    const fontApi = document.fonts;
    if (!fontApi?.load) return Promise.resolve();
    const px = MARKER.ICON_RASTER_PX;
    const work = async () => {
        await fontApi.ready;
        const pending = [];
        for (const face of fontApi) {
            if (/font\s*awesome/i.test(face.family)) {
                pending.push(face.load().catch(() => {}));
            }
        }
        pending.push(
            fontApi.load(`900 ${px}px "Font Awesome 6 Free"`, "\uf2e7").catch(() => {}),
            fontApi.load(`900 ${px}px "Font Awesome 5 Free"`, "\uf2e7").catch(() => {})
        );
        await Promise.allSettled(pending);
        await fontApi.ready;
    };
    return work().catch(() => undefined);
}

function _tokenStillOnScene(token) {
    return Boolean(token?.scene?.id && canvas?.scene?.id === token.scene.id);
}

function _resolveTokenForTarget(target) {
    const actor = _resolveTargetActor(target);
    return ButcherEngine.findCanvasTokenForActor(actor, {
        combatantId: target?.combatantId,
        tokenId: target?.tokenId
    });
}

function _userCanSeeMarkers() {
    if (game.user?.isGM) return true;
    const eligible = ButcherEngine.findButcherActors();
    return eligible.some(actor => actor.isOwner);
}

function _containerLive(container) {
    return Boolean(container && !container.destroyed && container.parent);
}

function _markerTooltipText(target, butcherState) {
    const name = target?.actorName ?? target?.actor?.name ?? "Creature";
    if (butcherState === BUTCHER_STATE.HARVESTED) {
        return `${name}\nHarvested`;
    }
    const dc = target?.dc;
    const dcBit = Number.isFinite(dc) ? ` (DC ${dc})` : "";
    return `${name}\nClick to butcher${dcBit}`;
}

class CorpseMarkerOverlay {
    /**
     * @param {Token} token
     * @param {object} target ButcherEngine target descriptor
     */
    constructor(token, target) {
        this.token = token;
        this.target = target;
        this.combatantId = target.combatantId;
        this.butcherState = target.butcherState ?? BUTCHER_STATE.READY;
        this._alive = true;
        this._container = null;
        this._iconSprite = null;
        this._bg = null;
        this._hoverLabel = null;
        this._build();
    }

    _build() {
        const harvested = this.butcherState === BUTCHER_STATE.HARVESTED;
        const R = MARKER.BADGE_R;
        const container = new PIXI.Container();
        container.cursor = harvested ? "default" : "pointer";
        container.zIndex = harvested ? 999_999 : 1_000_001;
        container.alpha = harvested ? MARKER.BG_ALPHA_HARVESTED : 1;
        if ("eventMode" in container) container.eventMode = "static";
        else container.interactive = true;

        const bg = new PIXI.Graphics();
        this._drawBadgeBg(bg, harvested, false);
        if ("eventMode" in bg) bg.eventMode = "none";
        container.addChild(bg);
        this._bg = bg;

        const hoverLabel = new PIXI.Text(_markerTooltipText(this.target, this.butcherState), MARKER.FONT_TOOLTIP);
        hoverLabel.anchor.set(0.5, 0);
        hoverLabel.x = 0;
        hoverLabel.y = R + MARKER.LABEL_GAP;
        hoverLabel.visible = false;
        if ("eventMode" in hoverLabel) hoverLabel.eventMode = "none";
        container.addChild(hoverLabel);
        this._hoverLabel = hoverLabel;

        container.on("pointerover", () => this._onHover(true));
        container.on("pointerout", () => this._onHover(false));

        if (!harvested) {
            container.on("pointerdown", (ev) => {
                ev?.stopPropagation?.();
                if (ev?.nativeEvent?.stopImmediatePropagation) ev.nativeEvent.stopImmediatePropagation();
                this._onClick();
            });
        }

        if (_overlayContainer) _overlayContainer.addChild(container);
        else this.token.addChild(container);
        this._container = container;
        container.hitArea = new PIXI.Circle(0, 0, R + 4);
        this._syncPosition();
        this._loadIcon();
    }

    _drawBadgeBg(bg, harvested, hover) {
        if (!bg) return;
        if (typeof bg.clear === "function") bg.clear();
        bg.lineStyle(2, harvested
            ? MARKER.BORDER_HARVESTED
            : hover ? MARKER.BORDER_HOVER : MARKER.BORDER, 0.9);
        bg.beginFill(harvested ? 0x121810 : 0x1a1208, harvested ? MARKER.BG_ALPHA_HARVESTED : MARKER.BG_ALPHA);
        bg.drawCircle(0, 0, MARKER.BADGE_R);
        bg.endFill();
    }

    _onHover(over) {
        if (!this._alive || !_containerLive(this._container)) return;
        const harvested = this.butcherState === BUTCHER_STATE.HARVESTED;
        if (this._hoverLabel) this._hoverLabel.visible = over;
        this._drawBadgeBg(this._bg, harvested, over && !harvested);
    }

    async _loadIcon() {
        if (!this._alive || !_containerLive(this._container)) return;
        const harvested = this.butcherState === BUTCHER_STATE.HARVESTED;
        const fill = harvested ? MARKER.FILL_HARVESTED : MARKER.FILL;
        const tex = harvested
            ? await _resolveHarvestedIconTexture(fill, MARKER.ICON_RASTER_PX)
            : await _resolveMarkerIconTexture(fill, MARKER.ICON_RASTER_PX);
        if (!this._alive || !_containerLive(this._container)) return;
        if (!tex) {
            _markerWarn("icon texture failed, using vector cleaver fallback", {
                actorName: this.target?.actorName
            });
            if (!this._iconSprite && this._container) {
                this._iconSprite = _drawCleaverFallback(this._container);
            }
            return;
        }
        if (this._iconSprite instanceof PIXI.Sprite) {
            this._iconSprite.texture = tex;
            _layoutIconSprite(this._iconSprite, tex);
            return;
        }
        if (this._iconSprite) {
            this._iconSprite.destroy?.();
            this._iconSprite = null;
        }
        const spr = new PIXI.Sprite(tex);
        _layoutIconSprite(spr, tex);
        if ("eventMode" in spr) spr.eventMode = "none";
        this._container.addChild(spr);
        this._iconSprite = spr;
    }

    _syncPosition() {
        if (!this._container || !this.token?.document) return;
        if (!_tokenStillOnScene(this.token)) return;
        const gs = canvas.grid?.size ?? 100;
        const tW = (this.token.document.width ?? 1) * gs;
        const topGap = Math.max(8, gs * 0.15);
        this._container.x = this.token.x + tW / 2;
        this._container.y = this.token.y - topGap;
    }

    async _onClick() {
        const target = ButcherEngine.getPendingTarget(this.combatantId) ?? this.target;
        if (!target) {
            ui.notifications.warn("Butcher prompt expired or already resolved.");
            ButcherCorpseMarker.clear(this.combatantId);
            return;
        }
        const butcher = ButcherEngine.resolveActingButcher();
        if (!butcher) {
            ui.notifications.warn("No eligible butcher available.");
            return;
        }
        ButcherEngine.clearPendingTarget(this.combatantId);
        await ButcherEngine.resolve(butcher, target);
    }

    destroy() {
        this._alive = false;
        if (this._hoverLabel) this._hoverLabel.visible = false;
        this._container?.destroy?.({ children: true });
        this._container = null;
        this._iconSprite = null;
        this._bg = null;
        this._hoverLabel = null;
    }
}

function _ensureOverlayContainer() {
    if (_overlayContainer && !_overlayContainer.destroyed) return _overlayContainer;
    const layer = canvas?.tokens;
    if (!layer) {
        _markerWarn("overlay container unavailable: canvas.tokens missing");
        return null;
    }

    _overlayContainer = new PIXI.Container();
    _overlayContainer.name = `${MODULE_ID}-butcher-markers`;
    _overlayContainer.sortableChildren = true;
    _overlayContainer.zIndex = 1_000_000;
    if ("eventMode" in _overlayContainer) _overlayContainer.eventMode = "passive";
    else _overlayContainer.interactiveChildren = true;

    if (layer.addChild) {
        if (!_savedTokensSortable) {
            _tokensSortablePrev = layer.sortableChildren;
            layer.sortableChildren = true;
            _savedTokensSortable = true;
        }
        layer.addChild(_overlayContainer);
        _markerDebug("overlay container attached", {
            sortableChildren: layer.sortableChildren,
            zIndex: _overlayContainer.zIndex
        });
    }
    return _overlayContainer;
}

function _onTick() {
    for (const overlay of _markers.values()) overlay._syncPosition();
}

function _startTicker() {
    if (_tickerBound || !canvas?.app?.ticker) return;
    _tickerBound = _onTick;
    canvas.app.ticker.add(_tickerBound);
}

function _stopTickerIfEmpty() {
    if (_markers.size || !_tickerBound) return;
    const ticker = globalThis.canvas?.app?.ticker;
    if (!ticker) return;
    ticker.remove(_tickerBound);
    _tickerBound = null;
}

function _resolveTargetActor(target) {
    if (target?.actor) return target.actor;
    const uuid = target?.actorUuid;
    if (!uuid) return null;
    try {
        const doc = fromUuidSync(uuid);
        return doc?.actor ?? doc ?? null;
    } catch {
        return null;
    }
}

function _onSocket(data) {
    if (data?.action !== SOCKET_ACTION_SHOW || !Array.isArray(data.targets)) return;
    _markerDebug("socket showButcherMarkers", { count: data.targets.length });
    void _applyTargetsWithIcons(data.targets);
}

async function _refreshAllMarkerIcons() {
    await ensureIconFontsLoaded();
    await Promise.all([..._markers.values()].map(overlay => overlay._loadIcon()));
}

async function _applyTargetsWithIcons(targets) {
    await ensureIconFontsLoaded();
    ButcherCorpseMarker.showTargets(targets);
    await _refreshAllMarkerIcons();
}

async function _restoreMarkersAfterCanvasReady() {
    if (!canvas?.ready) return;
    _resetCanvasGraphics();
    await ensureIconFontsLoaded();

    ButcherEngine.rehydrateSceneState();

    if (game.user?.isGM) {
        await ButcherEngine.scanSceneCorpses({ createChat: false, reason: "canvasReady" });
    }

    const entries = ButcherEngine.getCorpseMarkerEntries?.() ?? [];
    if (entries.length) ButcherCorpseMarker.showTargets(entries);

    await _refreshAllMarkerIcons();
}

/*
 * GM console macros (paste into DevTools console):
 *
 * // A: Inspect selected token butcher eligibility
 * game.ionrift.monstrousFeast.engine.inspectButcherEligibility(canvas.tokens.controlled[0])
 *
 * // B: Force refresh markers on all dead tokens on scene
 * game.ionrift.monstrousFeast.engine.scanSceneCorpses({ createChat: false, reason: "macro" })
 *
 * // C: Dump marker service state
 * game.ionrift.monstrousFeast.engine.getMarkerDebugState()
 *
 * // D: Manually trigger death/combat-end flow for selected token
 * (async () => {
 *   const token = canvas.tokens.controlled[0];
 *   const actor = token?.actor;
 *   if (!actor) return console.warn("Select a token first.");
 *   if (game.combat?.started) await game.ionrift.monstrousFeast.engine.onCombatEnd(game.combat);
 *   else await game.ionrift.monstrousFeast.engine.onCreatureDeath(actor);
 * })()
 */

export const ButcherCorpseMarker = {
    init() {
        _markerWarn("marker service registered");
        if (game.socket) game.socket.on(SOCKET_CHANNEL, _onSocket);

        Hooks.on("canvasTearDown", () => {
            clearLocalButcherStateOverrides();
            _resetCanvasGraphics();
        });

        Hooks.on("canvasReady", () => {
            _markerDebug("canvasReady", { pending: ButcherEngine.getPendingTargetsList?.()?.length ?? 0 });
            void _restoreMarkersAfterCanvasReady();
        });

        // On a full reload the first canvasReady fires before the ready hook that
        // runs init(), so that event is already gone. Restore immediately when
        // the canvas is up so markers survive an F5.
        if (canvas?.ready) {
            _markerDebug("init: canvas already ready, restoring markers");
            void _restoreMarkersAfterCanvasReady();
        }

        Hooks.on("deleteToken", (doc) => {
            clearSceneCorpseEntry(doc.id).catch(() => {});
            for (const [id, overlay] of _markers) {
                if (overlay.token?.id === doc.id) this.clear(id);
            }
        });
        Hooks.on("updateToken", (doc) => {
            const actor = doc.actor;
            if (!actor || SystemBridge.isDead(actor)) return;
            void ButcherEngine.revokeButcherOffer(actor);
        });
    },

    /**
     * Show canvas markers for butcher targets (max three).
     * @param {object[]} targets
     */
    showTargets(targets) {
        _markerDebug("showTargets", { incoming: targets?.length ?? 0, canvasReady: !!canvas?.ready });
        if (!canvas?.ready) {
            _markerWarn("showTargets skipped: canvas not ready");
            return;
        }
        if (!_userCanSeeMarkers()) {
            _markerWarn("showTargets skipped: user cannot see markers", {
                isGM: !!game.user?.isGM,
                eligibleButchers: ButcherEngine.findButcherActors().map(a => a.name)
            });
            return;
        }
        if (!_ensureOverlayContainer()) return;

        const sliceReady = (targets ?? [])
            .filter(entry => (entry.butcherState ?? BUTCHER_STATE.READY) === BUTCHER_STATE.READY)
            .slice(0, MAX_MARKERS);
        const sliceHarvested = (targets ?? [])
            .filter(entry => entry.butcherState === BUTCHER_STATE.HARVESTED)
            .slice(0, 10);
        const slice = [...sliceReady, ...sliceHarvested];
        const nextIds = new Set(slice.map(t => t.combatantId));

        for (const [id, overlay] of _markers) {
            if (!nextIds.has(id)) this.clear(id);
        }

        for (const target of slice) {
            const actor = _resolveTargetActor(target);
            if (!actor) {
                _markerWarn("showTargets skipped target: actor unresolved", {
                    combatantId: target.combatantId,
                    actorUuid: target.actorUuid ?? null
                });
                continue;
            }
            const token = _resolveTokenForTarget({ ...target, actor });
            if (!token) {
                _markerWarn("showTargets skipped target: no canvas token", {
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
            this.clear(target.combatantId);
            _markers.set(target.combatantId, new CorpseMarkerOverlay(token, hydrated));
            _markerDebug("marker placed", {
                combatantId: target.combatantId,
                tokenId: hydrated.tokenId,
                actorName: hydrated.actorName ?? actor.name,
                butcherState: hydrated.butcherState
            });
        }

        if (_markers.size) _startTicker();
        else {
            _stopTickerIfEmpty();
            _markerDebug("showTargets finished with zero markers", { requested: slice.length });
        }
    },

    /**
     * Render locally and broadcast serialized targets so eligible clients see markers.
     * @param {object[]} targets
     */
    syncShow(targets) {
        this.showTargets(targets);
        void _refreshAllMarkerIcons();
        if (!game.user.isGM || !game.socket || !targets?.length) return;
        game.socket.emit(SOCKET_CHANNEL, {
            action: SOCKET_ACTION_SHOW,
            targets: ButcherEngine.serializeTargets(targets)
        });
    },

    /**
     * @param {string} combatantId
     */
    clear(combatantId) {
        const overlay = _markers.get(combatantId);
        if (!overlay) return;
        overlay.destroy();
        _markers.delete(combatantId);
        _stopTickerIfEmpty();
    },

    clearAll() {
        for (const id of [..._markers.keys()]) this.clear(id);
    },

    /** @returns {number} */
    count() {
        return _markers.size;
    },

    canUserSeeMarkers() {
        return _userCanSeeMarkers();
    },

    isOverlayReady() {
        return Boolean(_overlayContainer && !_overlayContainer.destroyed && canvas?.ready);
    },

    getDebugState() {
        return {
            markerCount: _markers.size,
            overlayReady: this.isOverlayReady(),
            overlayDestroyed: _overlayContainer?.destroyed ?? null,
            tickerActive: Boolean(_tickerBound),
            markers: [..._markers.entries()].map(([id, overlay]) => ({
                combatantId: id,
                actorName: overlay.target?.actorName ?? overlay.token?.name,
                tokenId: overlay.token?.document?.id ?? overlay.token?.id ?? null
            })),
            debugEnabled: _isDebugEnabled()
        };
    }
};
