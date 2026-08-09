import { Library } from "../../compat/Library.js";
import { Logger } from "../../lib/Logger.js";
import { MODULE_ID } from "../../data/moduleId.js";

/** Buff handlers for party-effect keys (codex, serve copy, kernel buffs, AE). */

/** Active Effect change modes, resilient to a missing global CONST (tests). */
const AE_MODE_FALLBACK = { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 };

function aeMode(name) {
    return globalThis.CONST?.ACTIVE_EFFECT_MODES?.[name] ?? AE_MODE_FALLBACK[name];
}

/** Local fallback when the kernel lacks `cooking.buffHandlers`. */
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

/** Kernel buffHandlers registry, or the local fallback. */
export function buffRegistry() {
    try {
        return Library.cooking?.buffHandlers ?? _localFallback;
    } catch {
        // `game` may be absent (early boot, headless tests); degrade cleanly.
        return _localFallback;
    }
}

const DURATION = "untilLongRest";
const SHORT_DURATION = "untilShortRest";
const PARTY = "party";

/** Compact duration qualifier for codex card summaries (Green, rest-scoped). */
const UNTIL_LONG_REST = "until long rest";
const UNTIL_SHORT_REST = "until short rest";

/**
 * Append the meal-slot ceiling on player-facing copy. Lines that already name
 * a rest window (short or long) are left alone; the slot cap is implied there.
 * Single-use and unqualified lines still get an explicit long-rest ceiling.
 * @param {string|null|undefined} line
 * @returns {string|null}
 */
export function applyMealBuffCeiling(line) {
    if (!line) return null;
    if (/\buntil long rest\b/i.test(line)) return line;
    if (/\buntil short rest\b/i.test(line)) return line;
    return `${line} (${UNTIL_LONG_REST})`;
}

function withMealBuffCeiling(line) {
    return applyMealBuffCeiling(line);
}

const LONG_REST_PAREN_SUFFIX = ` (${UNTIL_LONG_REST})`;
const LONG_REST_MEMBER_SUFFIX = " until your next long rest";

/**
 * Drop repeated long-rest qualifiers when several buff lines share the same
 * window. Keeps the suffix on the last matching line only.
 * @param {string[]} lines
 * @returns {string[]}
 */
export function compactBuffDurations(lines) {
    if (!lines || lines.length < 2) return [...(lines ?? [])];

    let compacted = [...lines];
    for (const suffix of [LONG_REST_PAREN_SUFFIX, LONG_REST_MEMBER_SUFFIX]) {
        const indices = compacted
            .map((line, index) => (line.endsWith(suffix) ? index : -1))
            .filter(index => index >= 0);
        if (indices.length < 2) continue;

        const last = indices[indices.length - 1];
        compacted = compacted.map((line, index) => {
            if (line.endsWith(suffix) && index !== last) {
                return line.slice(0, -suffix.length);
            }
            return line;
        });
    }
    return compacted;
}

/**
 * Split a summary line into card fields so effect and duration can render apart.
 * Trailing "(until long/short rest)" becomes duration; any text before that inside
 * the same parentheses becomes detail (e.g. "next 1d4 poison hits").
 * @param {string} line
 * @returns {{ label: string, detail: string|null, duration: string|null }}
 */
export function parseSummaryCard(line) {
    const text = String(line ?? "").trim();
    if (!text) return { label: "", detail: null, duration: null };

    const match = text.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (!match) return { label: text, detail: null, duration: null };

    const label = match[1].trim();
    const inner = match[2].trim();
    const untilMatch = inner.match(/^(.*?)(?:,\s*)?(until (?:long|short) rest)$/i);
    if (untilMatch) {
        const detail = untilMatch[1].trim().replace(/,\s*$/, "") || null;
        return { label, detail, duration: untilMatch[2] };
    }
    return { label, detail: inner, duration: null };
}

/**
 * Group flat card rows under a shared duration parent so the window is not
 * repeated on every effect line. Order follows first appearance of each duration.
 * @param {{ label: string, detail: string|null, duration: string|null }[]} cards
 * @returns {{ duration: string|null, effects: { label: string, detail: string|null }[] }[]}
 */
export function groupSummaryCards(cards) {
    const groups = [];
    const byKey = new Map();

    for (const card of cards ?? []) {
        if (!card?.label) continue;
        const key = card.duration ?? "";
        let group = byKey.get(key);
        if (!group) {
            group = { duration: card.duration ?? null, effects: [] };
            byKey.set(key, group);
            groups.push(group);
        }
        group.effects.push({
            label: card.label,
            detail: card.detail ?? null
        });
    }

    return groups;
}

/**
 * Resolve strengthAdvantage recipe value to an Amber use cap (e.g. "1d4").
 * Legacy boolean recipes treat as "1d4".
 * @param {object} fx
 * @returns {string|null}
 */
function strengthUsesValue(fx) {
    const raw = fx?.strengthAdvantage;
    if (!raw) return null;
    if (raw === true) return "1d4";
    return String(raw);
}

/**
 * Resolve poisonResistance recipe value to an Amber hit cap (e.g. "1d4").
 * Legacy boolean recipes treat as "1d4".
 * @param {object} fx
 * @returns {string|null}
 */
function poisonUsesValue(fx) {
    const raw = fx?.poisonResistance;
    if (!raw) return null;
    if (raw === true) return "1d4";
    return String(raw);
}

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
        appliesTo: (fx) => Boolean(strengthUsesValue(fx)),
        summary: (fx) => {
            const uses = strengthUsesValue(fx);
            return uses ? `Strength advantage (next ${uses} checks)` : null;
        },
        memberLine: (fx) => {
            const uses = strengthUsesValue(fx);
            return uses
                ? `advantage on Strength checks for the next ${uses} checks (until long rest)` : null;
        },
        manualLine: (fx) => {
            const uses = strengthUsesValue(fx);
            return uses
                ? `Party gains Strength check advantage for ${uses} checks (track manually).` : null;
        },
        buff: (fx) => {
            const uses = strengthUsesValue(fx);
            return uses
                ? {
                    type: "check_advantage",
                    ability: "str",
                    uses,
                    duration: DURATION,
                    target: PARTY
                } : null;
        },
        changes: (fx) => (strengthUsesValue(fx) ? [{
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
        summary: (fx) => (fx?.darkvisionFeet ? `Darkvision ${fx.darkvisionFeet} ft (${UNTIL_LONG_REST})` : null),
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
        id: "poisonResistance",
        label: "Poison resistance",
        keys: ["poisonResistance"],
        managed: true,
        appliesTo: (fx) => Boolean(poisonUsesValue(fx)),
        summary: (fx) => {
            const uses = poisonUsesValue(fx);
            return uses ? `Poison resistance (next ${uses} poison hits, until short rest)` : null;
        },
        memberLine: (fx) => {
            const uses = poisonUsesValue(fx);
            return uses
                ? `poison damage resistance for the next ${uses} times you take poison damage (until short rest or 4 hours, whichever comes first)` : null;
        },
        manualLine: (fx) => {
            const uses = poisonUsesValue(fx);
            return uses
                ? `Party gains poison resistance for ${uses} poison hits (track manually).` : null;
        },
        buff: (fx) => {
            const uses = poisonUsesValue(fx);
            return uses
                ? {
                    type: "resistance",
                    damageType: "poison",
                    uses,
                    duration: SHORT_DURATION,
                    target: PARTY
                } : null;
        },
        changes: (fx) => (poisonUsesValue(fx) ? [{
            key: "system.traits.dr.value",
            mode: aeMode("ADD"),
            value: "poison",
            priority: 20
        }] : [])
    },
    {
        id: "passivePerceptionBonus",
        label: "Passive Perception bonus",
        keys: ["passivePerceptionBonus"],
        managed: true,
        appliesTo: (fx) => Boolean(fx?.passivePerceptionBonus),
        summary: (fx, ambitious) => (ambitious && fx?.passivePerceptionBonus
            ? `+${fx.passivePerceptionBonus} passive Perception (${UNTIL_LONG_REST})` : null),
        memberLine: (fx, ambitious) => (ambitious && fx?.passivePerceptionBonus
            ? `+${fx.passivePerceptionBonus} passive Perception until your next long rest` : null),
        manualLine: (fx, ambitious) => (ambitious && fx?.passivePerceptionBonus
            ? `Party gains +${fx.passivePerceptionBonus} passive Perception until the next long rest (track manually).` : null),
        buff: (fx, ambitious) => (ambitious && fx?.passivePerceptionBonus
            ? {
                type: "passive_perception",
                bonus: Number(fx.passivePerceptionBonus),
                duration: DURATION,
                target: PARTY
            } : null),
        changes: (fx, ambitious) => (ambitious && fx?.passivePerceptionBonus ? [{
            key: "system.skills.prc.passive",
            mode: aeMode("ADD"),
            value: String(fx.passivePerceptionBonus),
            priority: 20
        }] : [])
    },
    {
        id: "wisdomBonus",
        label: "Wisdom check bonus",
        keys: ["wisdomBonus"],
        managed: true,
        appliesTo: (fx) => Boolean(fx?.wisdomBonus),
        summary: (fx, ambitious) => (fx?.wisdomBonus
            ? `+${fx.wisdomBonus} Wisdom checks (${UNTIL_LONG_REST})` : null),
        memberLine: (fx, ambitious) => (fx?.wisdomBonus
            ? `+${fx.wisdomBonus} to Wisdom ability checks until your next long rest` : null),
        manualLine: (fx, ambitious) => (fx?.wisdomBonus
            ? `Party gains +${fx.wisdomBonus} to Wisdom checks until the next long rest (track manually).` : null),
        buff: (fx, ambitious) => (fx?.wisdomBonus
            ? {
                type: "ability_bonus",
                ability: "wis",
                bonus: Number(fx.wisdomBonus),
                duration: DURATION,
                target: PARTY
            } : null),
        changes: (fx, ambitious) => (fx?.wisdomBonus ? [{
            key: "system.abilities.wis.bonuses.check",
            mode: aeMode("ADD"),
            value: String(fx.wisdomBonus),
            priority: 20
        }] : [])
    },
    {
        id: "conSaveAdvantage",
        label: "Constitution save advantage",
        keys: ["conSaveAdvantage"],
        managed: true,
        appliesTo: (fx) => Boolean(fx?.conSaveAdvantage),
        summary: (fx, ambitious) => (fx?.conSaveAdvantage && !ambitious
            ? "Advantage on next CON save" : null),
        memberLine: (fx, ambitious) => (fx?.conSaveAdvantage && !ambitious
            ? "advantage on your next Constitution saving throw" : null),
        manualLine: (fx, ambitious) => (fx?.conSaveAdvantage && !ambitious
            ? "Party gains advantage on the next Constitution save (track manually)." : null),
        buff: (fx, ambitious) => (fx?.conSaveAdvantage && !ambitious
            ? {
                type: "advantage",
                save: { ability: "con" },
                duration: "nextSave",
                target: PARTY
            } : null),
        changes: (fx, ambitious) => (fx?.conSaveAdvantage && !ambitious ? [{
            key: "system.abilities.con.save.roll.mode",
            mode: aeMode("ADD"),
            value: "1",
            priority: 20
        }] : [])
    },
    {
        id: "wisSaveAdvantage",
        label: "Wisdom save advantage",
        keys: ["wisSaveAdvantage"],
        managed: true,
        appliesTo: (fx) => Boolean(fx?.wisSaveAdvantage),
        summary: (fx, ambitious) => (ambitious && fx?.wisSaveAdvantage
            ? "Advantage on next WIS save" : null),
        memberLine: (fx, ambitious) => (ambitious && fx?.wisSaveAdvantage
            ? "advantage on your next Wisdom saving throw" : null),
        manualLine: (fx, ambitious) => (ambitious && fx?.wisSaveAdvantage
            ? "Party gains advantage on the next Wisdom save (track manually)." : null),
        buff: (fx, ambitious) => (ambitious && fx?.wisSaveAdvantage
            ? {
                type: "advantage",
                save: { ability: "wis" },
                duration: "nextSave",
                target: PARTY
            } : null),
        changes: (fx, ambitious) => (ambitious && fx?.wisSaveAdvantage ? [{
            key: "system.abilities.wis.save.roll.mode",
            mode: aeMode("ADD"),
            value: "1",
            priority: 20
        }] : [])
    },
    {
        id: "conSaveBonus",
        label: "Constitution save bonus (limited)",
        keys: ["conSaveBonus"],
        managed: true,
        appliesTo: (fx) => Boolean(fx?.conSaveBonus),
        summary: (fx, ambitious) => {
            if (!ambitious || !fx?.conSaveBonus) return null;
            const uses = String(fx.conSaveBonus);
            return `+1 CON saves (next ${uses} saves, ${UNTIL_SHORT_REST})`;
        },
        memberLine: (fx, ambitious) => (ambitious && fx?.conSaveBonus
            ? `+1 to Constitution saves for the next ${fx.conSaveBonus} saves (${UNTIL_SHORT_REST})` : null),
        manualLine: (fx, ambitious) => (ambitious && fx?.conSaveBonus
            ? `Party gains +1 to Constitution saves for ${fx.conSaveBonus} saves (track manually).` : null),
        buff: (fx, ambitious) => (ambitious && fx?.conSaveBonus
            ? {
                type: "save_bonus",
                save: { ability: "con" },
                bonus: 1,
                uses: String(fx.conSaveBonus),
                duration: SHORT_DURATION,
                target: PARTY
            } : null),
        changes: (fx, ambitious) => (ambitious && fx?.conSaveBonus ? [{
            key: "system.abilities.con.bonuses.save",
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

/** Aggregated buff rendering over registered handlers. */
export const MealBuffHandlers = {
    ensureBuiltins: ensureBuiltinBuffHandlers,
    registry: buffRegistry,

    /**
     * Codex / chat summary lines (comma-join friendly; shared duration compacted).
     * @param {object} partyEffect
     * @param {boolean} [ambitious]
     * @returns {string[]}
     */
    summaries(partyEffect, ambitious = false) {
        warnUnknownKeys(partyEffect);
        const lines = [];
        for (const handler of mfHandlers()) {
            const line = callHandler(handler, "summary", partyEffect, ambitious);
            if (line) lines.push(withMealBuffCeiling(line));
        }
        return compactBuffDurations(lines);
    },

    /**
     * Recipe-card buff groups. Duration is the parent; effects nest under it so
     * a shared window is not repeated on every line.
     * @param {object} partyEffect
     * @param {boolean} [ambitious]
     * @returns {{ duration: string|null, effects: { label: string, detail: string|null }[] }[]}
     */
    cardSummaries(partyEffect, ambitious = false) {
        warnUnknownKeys(partyEffect);
        const cards = [];
        for (const handler of mfHandlers()) {
            const line = callHandler(handler, "summary", partyEffect, ambitious);
            if (!line) continue;
            cards.push(parseSummaryCard(withMealBuffCeiling(line)));
        }
        return groupSummaryCards(cards);
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
            if (line) lines.push(withMealBuffCeiling(line));
        }
        return compactBuffDurations(lines);
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
            if (line) lines.push(withMealBuffCeiling(line));
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
     * Delegates to the kernel resolver from each handler's buff descriptor.
     * @param {object} partyEffect
     * @param {boolean} [ambitious]
     * @returns {object[]}
     */
    changes(partyEffect, ambitious = false) {
        const changes = [];
        const buffs = Library.cooking?.buffs;
        for (const handler of mfHandlers()) {
            const buff = callHandler(handler, "buff", partyEffect, ambitious);
            if (buff && buffs?.toActiveEffectChanges) {
                const built = buffs.toActiveEffectChanges(null, buff);
                if (Array.isArray(built) && built.length) {
                    changes.push(...built);
                    continue;
                }
            }
            const legacy = callHandler(handler, "changes", partyEffect, ambitious);
            if (Array.isArray(legacy) && legacy.length) changes.push(...legacy);
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
