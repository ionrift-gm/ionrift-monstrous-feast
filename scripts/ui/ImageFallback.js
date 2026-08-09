import { CoreIcons } from "../data/CoreIcons.js";

/**
 * On image error, swap to a core icon (capture phase; one-shot).
 * @param {HTMLElement} root Application root element.
 * @param {string} [fallback] Replacement icon path. Defaults to a generic dish.
 */
export function attachImageFallback(root, fallback = CoreIcons.stew) {
    const el = root instanceof HTMLElement ? root : root?.[0];
    if (!el || el.dataset.mfImgGuard === "true") return;
    el.dataset.mfImgGuard = "true";

    el.addEventListener("error", (event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement)) return;
        if (img.dataset.mfFallbackApplied === "true") return;
        img.dataset.mfFallbackApplied = "true";
        img.src = fallback;
    }, true);
}
