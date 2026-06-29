import { GMRelay } from "./GMRelay.js";

const MODULE_ID = "ionrift-monstrous-feast";
const REGISTRY_FLAG = "corpseRegistry";

/** @readonly */
export const BUTCHER_STATE = Object.freeze({
    READY: "ready",
    HARVESTED: "harvested",
    PASSED: "passed"
});

/**
 * @param {Scene|null} [scene]
 * @returns {Record<string, object>}
 */
export function getSceneCorpseRegistry(scene = globalThis.canvas?.scene ?? null) {
    return scene?.getFlag?.(MODULE_ID, REGISTRY_FLAG) ?? {};
}

/**
 * @param {string} tokenId
 * @param {object|null} target
 * @param {string|null} state
 * @returns {Promise<void>}
 */
export async function writeSceneCorpseEntry(tokenId, target, state) {
    if (!game.user?.isGM || !globalThis.canvas?.scene || !tokenId) return;
    const scene = globalThis.canvas.scene;
    const registry = { ...getSceneCorpseRegistry(scene) };
    if (state == null) {
        delete registry[tokenId];
    } else {
        registry[tokenId] = {
            state,
            actorUuid: target?.actor?.uuid ?? null,
            actorName: target?.actorName ?? null,
            tokenId
        };
    }
    await scene.setFlag(MODULE_ID, REGISTRY_FLAG, registry);
}

/**
 * @param {Token|null} token
 * @returns {string|null}
 */
function _tokenDocumentId(token) {
    return token?.document?.id ?? token?.id ?? null;
}

/**
 * @param {Token} token
 * @returns {string|null}
 */
export function getButcherState(token) {
    const tokenId = _tokenDocumentId(token);
    const fromToken = token?.document?.getFlag?.(MODULE_ID, "butcherState");
    if (fromToken) return fromToken;

    const fromActor = token?.actor?.getFlag?.(MODULE_ID, "butcherState");
    if (fromActor) return fromActor;

    if (tokenId) {
        const entry = getSceneCorpseRegistry()[tokenId];
        if (entry?.state) return entry.state;
    }
    return null;
}

/**
 * @param {Token|null} token
 * @param {string|null} state
 * @param {object|null} [target]
 * @returns {Promise<void>}
 */
export async function setButcherState(token, state, target = null) {
    const doc = token?.document;
    const tokenId = _tokenDocumentId(token) ?? target?.tokenId ?? null;
    const actor = token?.actor ?? target?.actor ?? null;

    if (doc?.setFlag || doc?.unsetFlag) {
        if (state == null) await doc.unsetFlag(MODULE_ID, "butcherState");
        else await doc.setFlag(MODULE_ID, "butcherState", state);
    }

    if (game.user?.isGM && actor?.setFlag) {
        if (state == null) await actor.unsetFlag(MODULE_ID, "butcherState");
        else await actor.setFlag(MODULE_ID, "butcherState", state);
    }

    if (game.user?.isGM && tokenId) {
        await writeSceneCorpseEntry(tokenId, target ?? { tokenId, actor }, state);
    }
}

/**
 * Persist butcher corpse state locally or through the GM relay.
 * @param {Token|null} token
 * @param {object|null} target
 * @param {string|null} state
 * @returns {Promise<void>}
 */
export async function persistButcherState(token, target, state) {
    if (game.user?.isGM) {
        await setButcherState(token, state, target);
        return;
    }
    GMRelay.persistButcherState({
        tokenId: _tokenDocumentId(token) ?? target?.tokenId ?? null,
        actorUuid: target?.actor?.uuid ?? token?.actor?.uuid ?? null,
        actorName: target?.actorName ?? token?.actor?.name ?? null,
        state
    });
}

/**
 * @param {Token|null} token
 * @param {object|null} [target]
 * @returns {Promise<void>}
 */
export async function clearButcherState(token, target = null) {
    await persistButcherState(token, target, null);
}

/**
 * @param {string} tokenDocumentId
 * @returns {Promise<void>}
 */
export async function clearSceneCorpseEntry(tokenDocumentId) {
    if (!tokenDocumentId || !game.user?.isGM || !globalThis.canvas?.scene) return;
    const registry = { ...getSceneCorpseRegistry() };
    if (!(tokenDocumentId in registry)) return;
    delete registry[tokenDocumentId];
    await globalThis.canvas.scene.setFlag(MODULE_ID, REGISTRY_FLAG, registry);
}

/**
 * Corpses that can still be offered for butchering.
 * @param {string|null} state
 * @returns {boolean}
 */
export function isButcherableState(state) {
    return state !== BUTCHER_STATE.HARVESTED && state !== BUTCHER_STATE.PASSED;
}

/**
 * @param {string|null} state
 * @returns {boolean}
 */
export function showHarvestedMarker(state) {
    return state === BUTCHER_STATE.HARVESTED;
}

/**
 * Resolve a canvas token from persisted registry metadata.
 * @param {string} tokenId
 * @param {object} entry
 * @returns {Token|null}
 */
export function resolveTokenFromRegistryEntry(tokenId, entry) {
    const placeables = globalThis.canvas?.tokens?.placeables ?? [];
    const byId = placeables.find(
        token => token.id === tokenId || token.document?.id === tokenId
    );
    if (byId) return byId;

    const actorUuid = entry?.actorUuid;
    if (!actorUuid) return null;
    try {
        const doc = fromUuidSync(actorUuid);
        const actor = doc?.actor ?? doc ?? null;
        if (!actor?.id) return null;
        return placeables.find(
            token => token.actor?.id === actor.id || token.document?.actorId === actor.id
        ) ?? null;
    } catch {
        return null;
    }
}
