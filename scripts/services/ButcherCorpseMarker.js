import { Logger } from "../lib/Logger.js";
import { ButcherEngine } from "../engine/ButcherEngine.js";

const MODULE_ID = "ionrift-monstrous-feast";
const MAX_MARKERS = 3;

const FA_SOLID_CODEPOINT = {
    "fa-drumstick-bite": 0xf6d8
};

const MARKER = {
    BADGE_R: 14,
    ICON_RASTER_PX: 44,
    ICON_SPRITE_MAX: 18,
    FILL: 0xf5d0a0,
    BORDER: 0x8b4513,
    BG_ALPHA: 0.92
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

function _rasterIconCanvas(fill, px) {
    const cp = FA_SOLID_CODEPOINT["fa-drumstick-bite"];
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

function _iconTextureAsync(fill, px) {
    if (!_iconTexCache) _iconTexCache = new Map();
    const key = `${fill}|${px}`;
    if (_iconTexCache.has(key)) return Promise.resolve(_iconTexCache.get(key));
    const cvs = _rasterIconCanvas(fill, px);
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

function ensureIconFontsLoaded() {
    const fontApi = document.fonts;
    if (!fontApi?.load) return Promise.resolve();
    return fontApi.ready.catch(() => undefined);
}

function _tokenStillOnScene(token) {
    return Boolean(token?.scene?.id && canvas?.scene?.id === token.scene.id);
}

function _findTokenForActor(actor) {
    if (!actor?.id || !canvas?.tokens?.placeables) return null;
    return canvas.tokens.placeables.find(t => t.actor?.id === actor.id) ?? null;
}

function _userCanSeeMarkers() {
    if (game.user?.isGM) return true;
    const eligible = ButcherEngine.findButcherActors();
    return eligible.some(actor => actor.isOwner);
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
        this._container = null;
        this._iconSprite = null;
        this._build();
    }

    _build() {
        const R = MARKER.BADGE_R;
        const container = new PIXI.Container();
        container.cursor = "pointer";
        container.zIndex = 1_000_001;
        if ("eventMode" in container) container.eventMode = "static";
        else container.interactive = true;

        const bg = new PIXI.Graphics();
        bg.lineStyle(2, MARKER.BORDER, 0.9);
        bg.beginFill(0x1a1208, MARKER.BG_ALPHA);
        bg.drawCircle(0, 0, R);
        bg.endFill();
        if ("eventMode" in bg) bg.eventMode = "none";
        container.addChild(bg);

        container.on("pointerdown", (ev) => {
            ev?.stopPropagation?.();
            if (ev?.nativeEvent?.stopImmediatePropagation) ev.nativeEvent.stopImmediatePropagation();
            this._onClick();
        });

        if (_overlayContainer) _overlayContainer.addChild(container);
        else this.token.addChild(container);
        this._container = container;
        container.hitArea = new PIXI.Circle(0, 0, R + 4);
        this._syncPosition();
        this._loadIcon();
    }

    async _loadIcon() {
        await ensureIconFontsLoaded();
        const tex = await _iconTextureAsync(MARKER.FILL, MARKER.ICON_RASTER_PX);
        if (!tex || !this._container || this._container.destroyed) return;
        if (this._iconSprite) {
            this._iconSprite.texture = tex;
            _layoutIconSprite(this._iconSprite, tex);
            return;
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
        const butcher = ButcherEngine.resolveButcherActor();
        if (!butcher) {
            ui.notifications.warn("No eligible butcher available.");
            return;
        }
        ButcherEngine.clearPendingTarget(this.combatantId);
        ButcherCorpseMarker.clear(this.combatantId);
        await ButcherEngine.resolve(butcher, target);
    }

    destroy() {
        this._container?.destroy?.({ children: true });
        this._container = null;
        this._iconSprite = null;
    }
}

function _ensureOverlayContainer() {
    if (_overlayContainer && !_overlayContainer.destroyed) return _overlayContainer;
    const layer = canvas?.tokens;
    if (!layer) return null;

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
    if (_markers.size || !_tickerBound || !canvas?.app?.ticker) return;
    canvas.app.ticker.remove(_tickerBound);
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
    ButcherCorpseMarker.showTargets(data.targets);
}

export const ButcherCorpseMarker = {
    init() {
        if (game.socket) game.socket.on(SOCKET_CHANNEL, _onSocket);

        Hooks.on("canvasReady", () => {
            const pending = ButcherEngine.getPendingTargetsList?.() ?? [];
            if (pending.length) this.showTargets(pending);
        });

        Hooks.on("deleteToken", (doc) => {
            for (const [id, overlay] of _markers) {
                if (overlay.token?.id === doc.id) this.clear(id);
            }
        });
        Hooks.on("updateToken", (doc, changes) => {
            if (!("actorId" in changes) && !("actorData" in changes)) return;
            const actor = doc.actor;
            if (actor && !actor.system?.attributes?.hp) return;
            if (actor && Number(actor.system?.attributes?.hp?.value ?? 1) > 0) {
                for (const [id, overlay] of _markers) {
                    if (overlay.token?.id === doc.id) this.clear(id);
                }
            }
        });
    },

    /**
     * Show canvas markers for butcher targets (max three).
     * @param {object[]} targets
     */
    showTargets(targets) {
        if (!canvas?.ready) return;
        if (!_userCanSeeMarkers()) return;
        if (!_ensureOverlayContainer()) return;

        const slice = (targets ?? []).slice(0, MAX_MARKERS);
        const nextIds = new Set(slice.map(t => t.combatantId));

        for (const [id, overlay] of _markers) {
            if (!nextIds.has(id)) this.clear(id);
        }

        for (const target of slice) {
            const actor = _resolveTargetActor(target);
            if (!actor) continue;
            const token = _findTokenForActor(actor);
            if (!token) continue;
            const hydrated = { ...target, actor };
            this.clear(target.combatantId);
            _markers.set(target.combatantId, new CorpseMarkerOverlay(token, hydrated));
        }

        if (_markers.size) _startTicker();
        else _stopTickerIfEmpty();
    },

    /**
     * Render locally and broadcast serialized targets so eligible clients see markers.
     * @param {object[]} targets
     */
    syncShow(targets) {
        this.showTargets(targets);
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
    }
};
