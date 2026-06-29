import { CoreIcons } from "../data/CoreIcons.js";

/**
 * Swap any image that fails to load to a known-good core icon, so a missing or
 * mistyped art path can never render as a broken-image glyph in the UI.
 *
 * The error event does not bubble, so the listener is registered in the capture
 * phase on the application root. A data flag stops a failing fallback from
 * looping.
 *
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
