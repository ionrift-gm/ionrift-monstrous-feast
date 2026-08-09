import { Logger } from "../lib/Logger.js";
import { MODULE_ID } from "../data/moduleId.js";

const OPEN_SELECTOR = "[data-mf-open-cookbook], .mf-open-party-cookbook";

/** @type {(() => unknown)|null} */
let _openReadOnly = null;

// Chat renders <button> markup intact, so a button keeps Foundry from treating
// the launcher as a navigable link.
const LAUNCHER_BUTTON =
    '<button type="button" class="mf-open-party-cookbook" data-mf-open-cookbook>'
    + '<i class="fas fa-book-open"></i> Open the cookbook</button>';

// Journal reading view runs content through text enrichment; an anchor with no
// href is the most robust element that survives and never navigates. The shared
// class lets the one delegate match it.
const LAUNCHER_JOURNAL_LINK =
    '<a class="mf-open-party-cookbook" data-mf-open-cookbook>'
    + '<i class="fas fa-book-open"></i> Open the cookbook</a>';

/** Document-level click handler for party-cookbook launcher buttons. */
export const CookbookLauncher = {
    /**
     * @param {{ openReadOnly?: () => unknown }} dependencies
     */
    configure({ openReadOnly } = {}) {
        _openReadOnly = typeof openReadOnly === "function" ? openReadOnly : null;
    },

    /** @returns {string} markup for chat cards */
    linkHtml() {
        return LAUNCHER_BUTTON;
    },

    /** @returns {string} markup for the journal reading view */
    journalLinkHtml() {
        return LAUNCHER_JOURNAL_LINK;
    },

    init() {
        document.addEventListener("click", (event) => {
            const trigger = event.target?.closest?.(OPEN_SELECTOR);
            if (!trigger) return;
            event.preventDefault();
            if (_openReadOnly) _openReadOnly();
            else Logger.warn("CookbookLauncher: read-only opener is not configured.");
        });
    }
};

/**
 * Ensure a read-only "Party Cookbook" journal entry exists on every player's
 * shelf, holding a button that opens the shared viewer. GM only; idempotent.
 * @returns {Promise<JournalEntry|null>}
 */
export async function ensurePartyCookbookJournal() {
    if (!game.user.isGM) return null;

    const existing = game.journal?.find(entry => entry.getFlag(MODULE_ID, "partyCookbookJournal") === true);
    if (existing) return existing;

    const content = `<p>The party's shared cookbook. Open it to review which creatures are known and which recipes are inscribed. Whoever carries the book does the cooking; this view is for everyone.</p>`
        + `<p>${CookbookLauncher.journalLinkHtml()}</p>`;

    try {
        const [entry] = await JournalEntry.create([{
            name: "Party Cookbook",
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
            flags: { [MODULE_ID]: { partyCookbookJournal: true } },
            pages: [{
                name: "Party Cookbook",
                type: "text",
                text: {
                    format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML,
                    content
                }
            }]
        }]);
        return entry ?? null;
    } catch (err) {
        Logger.warn("Could not create the Party Cookbook journal entry:", err);
        return null;
    }
}
