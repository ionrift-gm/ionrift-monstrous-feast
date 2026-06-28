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
