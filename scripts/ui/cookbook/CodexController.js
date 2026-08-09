const TIER_ORDER = { common: 0, uncommon: 1, rare: 2, legendary: 3 };
/** Baseline cards per page; the live page size rounds up to whole grid rows. */
const BASE_PAGE_SIZE = 8;

/**
 * Wires search, tier/type filters, sort, "cookable now" toggle, and pagination
 * to an already-rendered codex partial. Operates purely on the DOM so it never
 * triggers an Application re-render (keeps search focus stable).
 */
export class CodexController {
    /**
     * @param {HTMLElement} root Element containing a [data-codex] block.
     */
    static attach(root) {
        const codex = root.querySelector?.("[data-codex]");
        if (!codex || codex.dataset.codexBound === "true") return;
        codex.dataset.codexBound = "true";
        new CodexController(codex).init();
    }

    /** @param {HTMLElement} codex */
    constructor(codex) {
        this.codex = codex;
        this.sectionBlocks = Array.from(codex.querySelectorAll("[data-codex-section]"));
        this.grid = codex.querySelector("[data-codex-section-grid]")
            ?? codex.querySelector("[data-codex-grid]");
        this.cards = Array.from(codex.querySelectorAll("[data-codex-card]"));
        this.empty = codex.querySelector("[data-codex-empty]");
        this.pager = codex.querySelector("[data-codex-pager]");
        this.pageInfo = codex.querySelector("[data-codex-pageinfo]");
        this.state = { search: "", tier: "", type: "", sort: "tier", cookable: false, page: 0 };
    }

    init() {
        const search = this.codex.querySelector("[data-codex-search]");
        const tier = this.codex.querySelector("[data-codex-tier]");
        const type = this.codex.querySelector("[data-codex-type]");
        const sort = this.codex.querySelector("[data-codex-sort]");
        const cookable = this.codex.querySelector("[data-codex-cookable]");
        const prev = this.codex.querySelector("[data-codex-prev]");
        const next = this.codex.querySelector("[data-codex-next]");

        search?.addEventListener("input", () => {
            this.state.search = search.value.trim().toLowerCase();
            this.state.page = 0;
            this.apply();
        });
        tier?.addEventListener("change", () => { this.state.tier = tier.value; this.state.page = 0; this.apply(); });
        type?.addEventListener("change", () => { this.state.type = type.value; this.state.page = 0; this.apply(); });
        sort?.addEventListener("change", () => { this.state.sort = sort.value; this.apply(); });
        cookable?.addEventListener("change", () => { this.state.cookable = cookable.checked; this.state.page = 0; this.apply(); });
        prev?.addEventListener("click", () => { this.state.page = Math.max(0, this.state.page - 1); this.apply(); });
        next?.addEventListener("click", () => { this.state.page += 1; this.apply(); });

        // Column count tracks container width (responsive auto-fill grid), so
        // reflow pages when the window resizes to keep rows full.
        if (typeof ResizeObserver !== "undefined" && this.grid) {
            let raf = null;
            this._resizeObserver = new ResizeObserver(() => {
                if (raf) cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => { raf = null; this.apply(); });
            });
            this._resizeObserver.observe(this.grid);
        }

        this.apply();
    }

    /**
     * Live column count of the responsive grid, read from the resolved
     * grid-template-columns track list. Falls back to 1 before layout.
     * @returns {number}
     */
    _columnCount() {
        if (!this.grid) return 1;
        const template = getComputedStyle(this.grid).gridTemplateColumns ?? "";
        if (!template || template === "none") return 1;
        return Math.max(1, template.split(" ").filter(Boolean).length);
    }

    /**
     * Cards per page, rounded up to whole grid rows so a page never breaks
     * mid-row and leaves a ragged gap before the next page.
     * @returns {number}
     */
    _pageSize() {
        const columns = this._columnCount();
        const rows = Math.max(1, Math.ceil(BASE_PAGE_SIZE / columns));
        return columns * rows;
    }

    _matches(card) {
        const { search, tier, type, cookable } = this.state;
        if (tier && card.dataset.tier !== tier) return false;
        if (type && card.dataset.type !== type) return false;
        if (cookable && card.dataset.cookable !== "true") return false;
        if (search) {
            // Only the per-entry blob (empty for locked entries) so a search
            // never reveals the name of an undiscovered creature.
            const blob = (card.dataset.search ?? "").toLowerCase();
            if (!blob.includes(search)) return false;
        }
        return true;
    }

    _sorted(cards) {
        const { sort } = this.state;
        const knownRank = card => (card.dataset.unlocked === "true" ? 0 : 1);
        const compare = (a, b) => {
            const byKnown = knownRank(a) - knownRank(b);
            if (byKnown) return byKnown;
            if (sort === "name") {
                return a.dataset.label.localeCompare(b.dataset.label);
            }
            if (sort === "cr") {
                return Number(a.dataset.cr) - Number(b.dataset.cr)
                    || a.dataset.label.localeCompare(b.dataset.label);
            }
            return (TIER_ORDER[a.dataset.tier] ?? 9) - (TIER_ORDER[b.dataset.tier] ?? 9)
                || a.dataset.label.localeCompare(b.dataset.label);
        };

        const methods = cards.filter(card => card.dataset.section === "methods").sort(compare);
        const creatures = cards.filter(card => card.dataset.section !== "methods").sort(compare);
        return [...methods, ...creatures];
    }

    apply() {
        const visible = this._sorted(this.cards.filter(card => this._matches(card)));

        for (const card of this.cards) card.style.display = "none";

        const pageSize = this._pageSize();
        const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
        if (this.state.page >= pageCount) this.state.page = pageCount - 1;
        const start = this.state.page * pageSize;
        const slice = visible.slice(start, start + pageSize);

        for (const block of this.sectionBlocks) {
            const sectionId = block.dataset.codexSection;
            const grid = block.querySelector("[data-codex-section-grid]");
            const sectionVisible = visible.filter(card => card.dataset.section === sectionId);
            const sectionOnPage = slice.filter(card => card.dataset.section === sectionId);
            block.hidden = sectionVisible.length === 0;
            if (!grid) continue;
            for (const card of sectionOnPage) {
                card.style.display = "";
                grid.appendChild(card);
            }
        }

        if (this.empty) this.empty.hidden = visible.length !== 0;
        if (this.pager) {
            this.pager.hidden = visible.length <= pageSize;
            if (this.pageInfo) this.pageInfo.textContent = `${this.state.page + 1} / ${pageCount}`;
        }
    }
}
