import { Logger } from "../lib/Logger.js";

/**
 * Registration hook for GM console panels.
 *
 * The free GM console ships the Registry viewer and the Setup flyout, nothing
 * more. An installed premium tool contributes its own surface by registering a
 * panel here; the console then mounts it as an extra tab. With nothing
 * registered, no premium tab appears, so there is never a teaser or lock badge
 * advertising absent content.
 *
 * Panel shape:
 *   - `id`      stable id (required)
 *   - `label`   tab label (required)
 *   - `icon`    Font Awesome class for the tab (optional)
 *   - `content` HTML string rendered into the panel body (optional)
 *   - `onRender(panelEl, app)` called after render for interactivity (optional)
 */

/** @type {Map<string, object>} id -> panel */
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
