import { Logger } from "../lib/Logger.js";

/**
 * Optional GM console panel registry.
 * Panel: `{ id, label, icon?, content?, onRender? }`.
 */

/** @type {Map<string, object>} Panels keyed by id. */
const _panels = new Map();

export const ConsolePanelRegistry = {
    /**
     * @param {{ id: string, label: string, icon?: string, content?: string, onRender?: Function }} panel
     * @returns {boolean}
     */
    register(panel) {
        if (typeof panel?.id !== "string" || !panel.id.trim()) {
            Logger.warn("ConsolePanelRegistry.register: panel needs a string id.");
            return false;
        }
        if (typeof panel?.label !== "string" || !panel.label.trim()) {
            Logger.warn(`ConsolePanelRegistry.register: panel "${panel.id}" needs a label.`);
            return false;
        }
        _panels.set(panel.id, panel);
        return true;
    },

    /**
     * @param {string} id
     * @returns {boolean}
     */
    unregister(id) {
        return _panels.delete(id);
    },

    /**
     * @param {string} id
     * @returns {object|undefined}
     */
    get(id) {
        return _panels.get(id);
    },

    /**
     * @returns {object[]}
     */
    list() {
        return [..._panels.values()];
    }
};
