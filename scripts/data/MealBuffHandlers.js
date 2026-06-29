import { Library } from "../compat/Library.js";
import { Logger } from "../lib/Logger.js";

/**
 * Monstrous Feast buff handlers.
 *
 * Each handler owns one buff concept and knows how to render it four ways: a
 * codex summary line, a per-member descriptive line, a track-manually advisory,
 * the kernel buff descriptor for the shared cooking slot, and the dnd5e Active
 * Effect changes. The module's buff paths (codex summary, the effect applier,
 * the kernel feed translation) consult the registry instead of hardcoding the
 * buff keys, so an overlay handler slots in with no code change.
 *
 * The registry itself is hosted in the kernel (`cooking.buffHandlers`). The four
 * built-ins register through that same seam, so there is no privileged in-code
 * path overlay buffs cannot reach. A tiny local fallback covers kernels that
 * predate the seam, mirroring its surface so callers do not branch.
 */

const MODULE_ID = "ionrift-monstrous-feast";

/** Active Effect change modes, resilient to a missing global CONST (tests). */
const AE_MODE_FALLBACK = { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 };

function aeMode(name) {
    return globalThis.CONST?.ACTIVE_EFFECT_MODES?.[name] ?? AE_MODE_FALLBACK[name];
}

/**
 * Minimal in-module fallback registry, used only on kernels that lack
 * `cooking.buffHandlers`. Mirrors the kernel surface so callers are identical.
 */
const _localFallback = (() => {
    const handlers = new Map();
    const warned = new Set();
    return {
        register(handler) { handlers.set(handler.id, handler); return true; },
        unregister(id) { return handlers.delete(id); },
        unregisterForOverlay(overlayId) {
            let n = 0;
            for (const [id, h] of handlers) if (h._overlayId === overlayId) { handlers.delete(id); n++; }
            return n;
        },
        get(id) { return handlers.get(id); },
        has(id) { return handlers.has(id); },
        list() { return [...handlers.values()]; },
        warnUnknown(key) {
            if (!key || warned.has(key)) return;
            warned.add(key);
            Logger.warn(`No cooking buff handler registered for "${key}". Skipping.`);
        }
    };
})();

/**
 * Resolve the active registry: the kernel's when present, otherwise the local
 * fallback. Always returns the same instance within one runtime, so built-ins
 * and overlay handlers land in one place.
 * @returns {object}
 */
export function buffRegistry() {
    try {
        return Library.cooking?.buffHandlers ?? _localFallback;
    } catch {
        // `game` may be absent (early boot, headless tests); degrade cleanly.
        return _localFallback;
    }
}

const DURATION = "untilLongRest";
const PARTY = "party";

/** The four built-in Monstrous Feast buff handlers. */
export const BUILTIN_BUFF_HANDLERS = [
    {
        id: "tempHP",
        label: "Temporary HP",
        keys: ["tempHP", "ambitiousTempHP"],
        managed: false,
        appliesTo: (fx) => Boolean(fx?.tempHP),
        summary: (fx) => (fx?.tempHP ? `${fx.tempHP} temp HP` : null),
        // Temp HP is rolled per member at serve time, never an Active Effect, so
        // it contributes no member line, manual line, kernel buff, or AE change.
        memberLine: () => null,
        manualLine: () => null,
        buff: () => null,
        changes: () => []
    },
    {
        id: "strengthAdvantage",
        label: "Strength advantage",
        keys: ["strengthAdvantage"],
        managed: true,
        appliesTo: (fx) => Boolean(fx?.strengthAdvantage),
        summary: (fx) => (fx?.strengthAdvantage ? "Strength advantage" : null),
        memberLine: (fx) => (fx?.strengthAdvantage
            ? "advantage on Strength checks until your next long rest" : null),
        manualLine: (fx) => (fx?.strengthAdvantage
            ? "Party gains advantage on Strength checks until the next long rest (track manually)." : null),
        buff: (fx) => (fx?.strengthAdvantage
            ? { type: "check_advantage", ability: "str", duration: DURATION, target: PARTY } : null),
        changes: (fx) => (fx?.strengthAdvantage ? [{
            key: "system.abilities.str.check.roll.mode",
            mode: aeMode("ADD"),
            value: "1",
            priority: 20
        }] : [])
    },
    {
        id: "darkvisionFeet",
        label: "Darkvision",
        keys: ["darkvisionFeet"],
        managed: true,
        appliesTo: (fx) => Boolean(fx?.darkvisionFeet),
        summary: (fx) => (fx?.darkvisionFeet ? `Darkvision ${fx.darkvisionFeet} ft` : null),
        memberLine: (fx) => (fx?.darkvisionFeet
            ? `${fx.darkvisionFeet}ft darkvision until your next long rest` : null),
        manualLine: (fx) => (fx?.darkvisionFeet
            ? `Party gains ${fx.darkvisionFeet}ft darkvision until the next long rest (track manually).` : null),
        buff: (fx) => (fx?.darkvisionFeet
            ? { type: "sense_darkvision", feet: Number(fx.darkvisionFeet), duration: DURATION, target: PARTY } : null),
        changes: (fx) => (fx?.darkvisionFeet ? [{
            key: "system.attributes.senses.darkvision",
            mode: aeMode("UPGRADE"),
            value: String(fx.darkvisionFeet),
            priority: 20
        }] : [])
    },
    {
        id: "perceptionAdvantageDim",
        label: "Keen senses in dim light",
        keys: ["perceptionAdvantageDim"],
        managed: true,
        appliesTo: (fx) => Boolean(fx?.perceptionAdvantageDim),
        summary: (fx) => (fx?.perceptionAdvantageDim ? "Keen senses in dim light" : null),
        // The perception buff only lands on the ambitious tier.
        memberLine: (fx, ambitious) => (ambitious && fx?.perceptionAdvantageDim
            ? "advantage on Perception checks until your next long rest" : null),
        manualLine: (fx, ambitious) => (ambitious && fx?.perceptionAdvantageDim
            ? "Party gains advantage on Perception in dim light until the next long rest (track manually)." : null),
        buff: (fx, ambitious) => (ambitious && fx?.perceptionAdvantageDim
            ? { type: "skill_advantage", skill: "prc", conditions: { dimLight: true }, duration: DURATION, target: PARTY } : null),
        changes: (fx, ambitious) => (ambitious && fx?.perceptionAdvantageDim ? [{
            key: "system.skills.prc.roll.mode",
            mode: aeMode("ADD"),
            value: "1",
            priority: 20
        }] : [])
    }
];

let _builtinsRegistered = false;

/**
 * Register the four built-in handlers into the active registry. Idempotent and
 * cheap, so it is safe to call from the accessors below as well as on ready.
 */
export function ensureBuiltinBuffHandlers() {
    const registry = buffRegistry();
    if (_builtinsRegistered && registry.has("tempHP")) return;
    for (const handler of BUILTIN_BUFF_HANDLERS) {
        registry.register(handler, { source: "builtin" });
    }
    _builtinsRegistered = true;
}

/**
 * MF-shaped handlers currently in the registry (those that declare buff keys).
 * @returns {object[]}
 */
function mfHandlers() {
    ensureBuiltinBuffHandlers();
    return buffRegistry().list().filter(h => Array.isArray(h?.keys));
}

/**
 * The union of every partyEffect key claimed by a registered handler.
 * @returns {Set<string>}
 */
function knownKeys() {
    const keys = new Set();
    for (const handler of mfHandlers()) {
        for (const key of handler.keys) keys.add(key);
    }
    return keys;
}

/**
 * Log once for any partyEffect key with no handler, so a stray or
 * not-yet-installed buff key is surfaced without breaking the card or the cook.
 * @param {object} partyEffect
 */
function warnUnknownKeys(partyEffect) {
    if (!partyEffect) return;
    const known = knownKeys();
    const registry = buffRegistry();
    for (const key of Object.keys(partyEffect)) {
        if (!known.has(key)) registry.warnUnknown(key);
    }
}

function callHandler(handler, method, partyEffect, ambitious) {
    if (typeof handler[method] !== "function") return null;
    try {
        return handler[method](partyEffect, ambitious);
    } catch (e) {
        Logger.warn(`Buff handler "${handler.id}" ${method} failed:`, e);
        return null;
    }
}

/**
 * Aggregated buff rendering over the registered handlers. Replaces the
 * hardcoded per-key branches the module used to carry.
 */
export const MealBuffHandlers = {
    ensureBuiltins: ensureBuiltinBuffHandlers,
    registry: buffRegistry,

    /**
     * Codex card summary lines.
     * @param {object} partyEffect
     * @returns {string[]}
     */
    summaries(partyEffect) {
        warnUnknownKeys(partyEffect);
        const lines = [];
        for (const handler of mfHandlers()) {
            const line = callHandler(handler, "summary", partyEffect);
            if (line) lines.push(line);
        }
        return lines;
    },

    /**
     * Per-member descriptive lines for a mapped system (dnd5e).
     * @param {object} partyEffect
     * @param {boolean} [ambitious]
     * @returns {string[]}
     */
    memberLines(partyEffect, ambitious = false) {
        const lines = [];
        for (const handler of mfHandlers()) {
            const line = callHandler(handler, "memberLine", partyEffect, ambitious);
            if (line) lines.push(line);
        }
        return lines;
    },

    /**
     * Track-manually advisory lines for systems with no Active Effect mapping.
     * @param {object} partyEffect
     * @param {boolean} [ambitious]
     * @returns {string[]}
     */
    manualLines(partyEffect, ambitious = false) {
        const lines = [];
        for (const handler of mfHandlers()) {
            const line = callHandler(handler, "manualLine", partyEffect, ambitious);
            if (line) lines.push(line);
        }
        return lines;
    },

    /**
     * Kernel buff descriptors for the shared cooking slot (persistent buffs).
     * @param {object} partyEffect
     * @param {boolean} [ambitious]
     * @returns {object[]}
     */
    buffs(partyEffect, ambitious = false) {
        const buffs = [];
        for (const handler of mfHandlers()) {
            const buff = callHandler(handler, "buff", partyEffect, ambitious);
            if (buff) buffs.push(buff);
        }
        return buffs;
    },

    /**
     * dnd5e Active Effect changes for the standalone applier.
     * @param {object} partyEffect
     * @param {boolean} [ambitious]
     * @returns {object[]}
     */
    changes(partyEffect, ambitious = false) {
        const changes = [];
        for (const handler of mfHandlers()) {
            const built = callHandler(handler, "changes", partyEffect, ambitious);
            if (Array.isArray(built) && built.length) changes.push(...built);
        }
        return changes;
    },

    /**
     * Whether the effect produces any persistent (managed) buff.
     * @param {object} partyEffect
     * @returns {boolean}
     */
    producesManaged(partyEffect) {
        return mfHandlers().some(handler =>
            handler.managed && handler.appliesTo?.(partyEffect));
    }
};

export { MODULE_ID };
