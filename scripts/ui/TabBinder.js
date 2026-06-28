/**
 * Shared pill-tab switching for Monstrous Feast ApplicationV2 windows.
 * @param {HTMLElement} root
 */
export function bindTabs(root) {
    const nav = root?.querySelector("[data-mf-tabs]");
    if (!nav || nav.dataset.bound === "true") return;
    nav.dataset.bound = "true";

    nav.addEventListener("click", (event) => {
        const button = event.target.closest("[data-mf-tab]");
        if (!button || button.disabled) return;
        const tab = button.dataset.mfTab;
        if (!tab) return;

        for (const btn of nav.querySelectorAll("[data-mf-tab]")) {
            btn.classList.toggle("active", btn === button);
        }
        for (const panel of root.querySelectorAll("[data-mf-panel]")) {
            panel.classList.toggle("active", panel.dataset.mfPanel === tab);
        }
    });
}

/**
 * Header flyout panels (Setup, How to use). A toggle button opens its matching
 * panel as an anchored overlay; clicking the toggle again, a close control, or
 * outside the panel dismisses it. Delegated on the persistent root element so it
 * survives part re-renders.
 * @param {HTMLElement} root
 */
export function bindFlyouts(root) {
    if (!root || root.dataset.mfFlyoutsBound === "true") return;
    root.dataset.mfFlyoutsBound = "true";

    const closeAll = () => {
        for (const panel of root.querySelectorAll("[data-mf-flyout-panel]")) {
            panel.classList.remove("open");
        }
        for (const toggle of root.querySelectorAll("[data-mf-flyout]")) {
            toggle.classList.remove("active");
        }
    };

    root.addEventListener("click", (event) => {
        const toggle = event.target.closest("[data-mf-flyout]");
        if (toggle) {
            event.preventDefault();
            const name = toggle.dataset.mfFlyout;
            const panel = root.querySelector(`[data-mf-flyout-panel="${name}"]`);
            if (!panel) return;
            const wasOpen = panel.classList.contains("open");
            closeAll();
            if (!wasOpen) {
                panel.classList.add("open");
                toggle.classList.add("active");
            }
            return;
        }

        if (event.target.closest("[data-mf-flyout-close]")) {
            closeAll();
            return;
        }

        if (!event.target.closest("[data-mf-flyout-panel]")) {
            closeAll();
        }
    });
}
