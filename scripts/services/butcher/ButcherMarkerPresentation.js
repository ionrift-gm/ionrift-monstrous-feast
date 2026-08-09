import { BUTCHER_STATE } from "./ButcherTokenState.js";
import { MODULE_ID } from "../../data/moduleId.js";

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
let _iconTextureCache = null;
let _overlayContainer = null;
let _tickerBound = null;
let _tokensSortablePrevious = undefined;
let _savedTokensSortable = false;
const _markers = new Map();
let _debug = () => {};
let _warn = () => {};
let _onClick = async () => {};

function faSolidFamily() {
    if (_solidFamilyCache) return _solidFamilyCache;
    try {
        const probe = document.createElement("i");
        probe.className = "fas fa-solid fa-fire";
        probe.style.cssText = "position:absolute;left:-9999px;top:0;opacity:0;";
        document.body.appendChild(probe);
        const familyCss = window.getComputedStyle(probe, "::before").fontFamily
            || window.getComputedStyle(probe).fontFamily;
        probe.remove();
        const primary = (familyCss || "").split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
        if (/font\s*awesome/i.test(primary) && !/duotone|brands/i.test(primary)) {
            _solidFamilyCache = primary;
            return primary;
        }
    } catch { /* Font probe unavailable. */ }
    try {
        for (const face of document.fonts) {
            if (!/font\s*awesome/i.test(face.family) || /duotone|brands/i.test(face.family)) continue;
            const weight = Number(String(face.weight).split(/\s+/)[0]) || 400;
            if (weight === 900) {
                _solidFamilyCache = face.family.replace(/^['"]|['"]$/g, "");
                return _solidFamilyCache;
            }
        }
    } catch { /* Font iteration unavailable. */ }
    return "Font Awesome 6 Free";
}

function hexRgb(value) {
    return `#${(value >>> 0).toString(16).padStart(6, "0")}`;
}

function scanInkBounds(context, width, height) {
    const data = context.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] <= 12) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function rasterIconCanvas(fill, pixels, iconKey) {
    const codepoint = FA_SOLID_CODEPOINT[iconKey];
    if (codepoint == null) return null;
    const glyph = String.fromCodePoint(codepoint);
    const family = faSolidFamily();
    const fontCss = `900 ${pixels}px "${family.replace(/"/g, '\\"')}"`;
    const scratchSize = Math.max(64, pixels * 4);
    const scratch = document.createElement("canvas");
    scratch.width = scratchSize;
    scratch.height = scratchSize;
    const context = scratch.getContext("2d");
    context.clearRect(0, 0, scratchSize, scratchSize);
    context.fillStyle = hexRgb(fill);
    context.font = fontCss;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(glyph, scratchSize / 2, scratchSize / 2);

    const bounds = scanInkBounds(context, scratchSize, scratchSize);
    if (!bounds) return null;
    const glyphWidth = bounds.maxX - bounds.minX + 1;
    const glyphHeight = bounds.maxY - bounds.minY + 1;
    const padding = Math.max(2, Math.round(pixels * 0.12));
    const size = Math.max(glyphWidth, glyphHeight) + padding * 2;
    const output = document.createElement("canvas");
    output.width = size;
    output.height = size;
    output.getContext("2d").drawImage(
        scratch,
        bounds.minX, bounds.minY, glyphWidth, glyphHeight,
        Math.round((size - glyphWidth) / 2),
        Math.round((size - glyphHeight) / 2),
        glyphWidth,
        glyphHeight
    );
    return output;
}

function layoutIconSprite(sprite, texture) {
    const maximum = MARKER.ICON_SPRITE_MAX;
    const width = texture?.width ?? maximum;
    const height = texture?.height ?? maximum;
    sprite.scale.set(maximum / Math.max(width, height, 1));
    sprite.anchor.set(0.5, 0.5);
}

function textureUsable(texture) {
    if (!texture || texture.destroyed) return false;
    const source = texture.baseTexture ?? texture.source;
    return !source?.destroyed && source?.valid !== false;
}

function iconTexture(fill, pixels, iconKey) {
    if (!_iconTextureCache) _iconTextureCache = new Map();
    const key = `${iconKey}|${fill}|${pixels}`;
    if (_iconTextureCache.has(key)) {
        const cached = _iconTextureCache.get(key);
        if (textureUsable(cached)) return Promise.resolve(cached);
        _iconTextureCache.delete(key);
    }
    const canvasElement = rasterIconCanvas(fill, pixels, iconKey);
    if (!canvasElement) return Promise.resolve(null);
    return new Promise(resolve => {
        const image = new Image();
        image.onload = () => {
            let texture = null;
            try {
                texture = PIXI.Texture.from(image);
                texture?.baseTexture?.update?.();
            } catch {
                texture = null;
            }
            if (texture) _iconTextureCache.set(key, texture);
            resolve(texture);
        };
        image.onerror = () => resolve(null);
        image.src = canvasElement.toDataURL("image/png");
    });
}

async function ensureIconFontsLoaded() {
    const fontApi = document.fonts;
    if (!fontApi?.load) return;
    try {
        await fontApi.ready;
        const pending = [];
        for (const face of fontApi) {
            if (/font\s*awesome/i.test(face.family)) pending.push(face.load().catch(() => {}));
        }
        pending.push(
            fontApi.load(`900 ${MARKER.ICON_RASTER_PX}px "Font Awesome 6 Free"`, "\uf2e7").catch(() => {}),
            fontApi.load(`900 ${MARKER.ICON_RASTER_PX}px "Font Awesome 5 Free"`, "\uf2e7").catch(() => {})
        );
        await Promise.allSettled(pending);
        await fontApi.ready;
    } catch { /* Marker falls back to vector art. */ }
}

async function resolveIconTexture(fill, harvested) {
    await ensureIconFontsLoaded();
    if (harvested) return iconTexture(fill, MARKER.ICON_RASTER_PX, HARVESTED_ICON_KEY);
    for (const iconKey of MARKER_ICON_KEYS) {
        const texture = await iconTexture(fill, MARKER.ICON_RASTER_PX, iconKey);
        if (texture) return texture;
    }
    return null;
}

function drawCleaverFallback(container) {
    const graphics = new PIXI.Graphics();
    graphics.beginFill(MARKER.FILL, 1);
    graphics.drawRect(-6, -8, 12, 10);
    graphics.drawRect(-3, 2, 6, 6);
    graphics.endFill();
    if ("eventMode" in graphics) graphics.eventMode = "none";
    container.addChild(graphics);
    return graphics;
}

function tokenStillOnScene(token) {
    return Boolean(token?.scene?.id && canvas?.scene?.id === token.scene.id);
}

function containerLive(container) {
    return Boolean(container && !container.destroyed && container.parent);
}

function tooltipText(target, butcherState) {
    const name = target?.actorName ?? target?.actor?.name ?? "Creature";
    if (butcherState === BUTCHER_STATE.HARVESTED) return `${name}\nHarvested`;
    const dcBit = Number.isFinite(target?.dc) ? ` (DC ${target.dc})` : "";
    return `${name}\nClick to butcher${dcBit}`;
}

class CorpseMarkerOverlay {
    constructor(token, target) {
        this.token = token;
        this.target = target;
        this.combatantId = target.combatantId;
        this.butcherState = target.butcherState ?? BUTCHER_STATE.READY;
        this._alive = true;
        this._container = null;
        this._iconSprite = null;
        this._background = null;
        this._hoverLabel = null;
        this._build();
    }

    _build() {
        const harvested = this.butcherState === BUTCHER_STATE.HARVESTED;
        const container = new PIXI.Container();
        container.cursor = harvested ? "default" : "pointer";
        container.zIndex = harvested ? 999_999 : 1_000_001;
        container.alpha = harvested ? MARKER.BG_ALPHA_HARVESTED : 1;
        if ("eventMode" in container) container.eventMode = "static";
        else container.interactive = true;

        const background = new PIXI.Graphics();
        this._drawBadgeBackground(background, harvested, false);
        if ("eventMode" in background) background.eventMode = "none";
        container.addChild(background);
        this._background = background;

        const hoverLabel = new PIXI.Text(tooltipText(this.target, this.butcherState), MARKER.FONT_TOOLTIP);
        hoverLabel.anchor.set(0.5, 0);
        hoverLabel.y = MARKER.BADGE_R + MARKER.LABEL_GAP;
        hoverLabel.visible = false;
        if ("eventMode" in hoverLabel) hoverLabel.eventMode = "none";
        container.addChild(hoverLabel);
        this._hoverLabel = hoverLabel;

        container.on("pointerover", () => this._onHover(true));
        container.on("pointerout", () => this._onHover(false));
        if (!harvested) {
            container.on("pointerdown", event => {
                event?.stopPropagation?.();
                event?.nativeEvent?.stopImmediatePropagation?.();
                void _onClick(this.combatantId, this.target);
            });
        }

        if (_overlayContainer) _overlayContainer.addChild(container);
        else this.token.addChild(container);
        this._container = container;
        container.hitArea = new PIXI.Circle(0, 0, MARKER.BADGE_R + 4);
        this.syncPosition();
        void this.loadIcon();
    }

    _drawBadgeBackground(background, harvested, hover) {
        background?.clear?.();
        background.lineStyle(
            2,
            harvested ? MARKER.BORDER_HARVESTED : hover ? MARKER.BORDER_HOVER : MARKER.BORDER,
            0.9
        );
        background.beginFill(
            harvested ? 0x121810 : 0x1a1208,
            harvested ? MARKER.BG_ALPHA_HARVESTED : MARKER.BG_ALPHA
        );
        background.drawCircle(0, 0, MARKER.BADGE_R);
        background.endFill();
    }

    _onHover(over) {
        if (!this._alive || !containerLive(this._container)) return;
        const harvested = this.butcherState === BUTCHER_STATE.HARVESTED;
        if (this._hoverLabel) this._hoverLabel.visible = over;
        this._drawBadgeBackground(this._background, harvested, over && !harvested);
    }

    async loadIcon() {
        if (!this._alive || !containerLive(this._container)) return;
        const harvested = this.butcherState === BUTCHER_STATE.HARVESTED;
        const fill = harvested ? MARKER.FILL_HARVESTED : MARKER.FILL;
        const texture = await resolveIconTexture(fill, harvested);
        if (!this._alive || !containerLive(this._container)) return;
        if (!texture) {
            _warn("icon texture failed, using vector cleaver fallback", {
                actorName: this.target?.actorName
            });
            if (!this._iconSprite && this._container) {
                this._iconSprite = drawCleaverFallback(this._container);
            }
            return;
        }
        if (this._iconSprite instanceof PIXI.Sprite) {
            this._iconSprite.texture = texture;
            layoutIconSprite(this._iconSprite, texture);
            return;
        }
        this._iconSprite?.destroy?.();
        const sprite = new PIXI.Sprite(texture);
        layoutIconSprite(sprite, texture);
        if ("eventMode" in sprite) sprite.eventMode = "none";
        this._container.addChild(sprite);
        this._iconSprite = sprite;
    }

    syncPosition() {
        if (!this._container || !this.token?.document || !tokenStillOnScene(this.token)) return;
        const gridSize = canvas.grid?.size ?? 100;
        const tokenWidth = (this.token.document.width ?? 1) * gridSize;
        this._container.x = this.token.x + tokenWidth / 2;
        this._container.y = this.token.y - Math.max(8, gridSize * 0.15);
    }

    destroy() {
        this._alive = false;
        if (this._hoverLabel) this._hoverLabel.visible = false;
        this._container?.destroy?.({ children: true });
        this._container = null;
        this._iconSprite = null;
        this._background = null;
        this._hoverLabel = null;
    }
}

function ensureOverlayContainer() {
    if (_overlayContainer && !_overlayContainer.destroyed) return _overlayContainer;
    const layer = canvas?.tokens;
    if (!layer) {
        _warn("overlay container unavailable: canvas.tokens missing");
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
            _tokensSortablePrevious = layer.sortableChildren;
            layer.sortableChildren = true;
            _savedTokensSortable = true;
        }
        layer.addChild(_overlayContainer);
        _debug("overlay container attached", {
            sortableChildren: layer.sortableChildren,
            zIndex: _overlayContainer.zIndex
        });
    }
    return _overlayContainer;
}

function stopTickerIfEmpty() {
    if (_markers.size || !_tickerBound) return;
    const ticker = globalThis.canvas?.app?.ticker;
    ticker?.remove?.(_tickerBound);
    _tickerBound = null;
}

export const ButcherMarkerPresentation = {
    configure({ debug, warn, onClick }) {
        _debug = debug;
        _warn = warn;
        _onClick = onClick;
    },

    ensureReady() {
        return ensureIconFontsLoaded();
    },

    place(target, token) {
        if (!ensureOverlayContainer()) return false;
        this.clear(target.combatantId);
        _markers.set(target.combatantId, new CorpseMarkerOverlay(token, target));
        if (!_tickerBound && canvas?.app?.ticker) {
            _tickerBound = () => {
                for (const overlay of _markers.values()) overlay.syncPosition();
            };
            canvas.app.ticker.add(_tickerBound);
        }
        return true;
    },

    retain(combatantIds) {
        for (const id of [..._markers.keys()]) {
            if (!combatantIds.has(id)) this.clear(id);
        }
    },

    clear(combatantId) {
        const overlay = _markers.get(combatantId);
        if (!overlay) return;
        overlay.destroy();
        _markers.delete(combatantId);
        stopTickerIfEmpty();
    },

    clearAll() {
        for (const id of [..._markers.keys()]) this.clear(id);
    },

    clearForToken(tokenId) {
        for (const [id, overlay] of _markers) {
            if (overlay.token?.id === tokenId) this.clear(id);
        }
    },

    async refreshIcons() {
        await ensureIconFontsLoaded();
        await Promise.all([..._markers.values()].map(overlay => overlay.loadIcon()));
    },

    reset() {
        this.clearAll();
        if (_iconTextureCache) {
            for (const texture of _iconTextureCache.values()) {
                try {
                    texture?.destroy?.(true);
                } catch { /* Canvas already torn down. */ }
            }
            _iconTextureCache.clear();
        }
        const tokenLayer = _overlayContainer?.parent;
        if (_savedTokensSortable && tokenLayer && _tokensSortablePrevious !== undefined) {
            tokenLayer.sortableChildren = _tokensSortablePrevious;
        }
        if (_overlayContainer && !_overlayContainer.destroyed) {
            try {
                _overlayContainer.parent?.removeChild?.(_overlayContainer);
                _overlayContainer.destroy({ children: true });
            } catch { /* Canvas already torn down. */ }
        }
        _overlayContainer = null;
        _solidFamilyCache = null;
        _savedTokensSortable = false;
        _tokensSortablePrevious = undefined;
    },

    count() {
        return _markers.size;
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
            }))
        };
    }
};
