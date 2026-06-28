const TIER_ORDER = { common: 0, uncommon: 1, rare: 2, legendary: 3 };
const PAGE_SIZE = 6;

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
        this.grid = codex.querySelector("[data-codex-grid]");
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

        this.apply();
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
        return [...cards].sort((a, b) => {
            if (sort === "name") {
                return a.dataset.label.localeCompare(b.dataset.label);
            }
            if (sort === "cr") {
                return Number(a.dataset.cr) - Number(b.dataset.cr)
                    || a.dataset.label.localeCompare(b.dataset.label);
            }
            return (TIER_ORDER[a.dataset.tier] ?? 9) - (TIER_ORDER[b.dataset.tier] ?? 9)
                || a.dataset.label.localeCompare(b.dataset.label);
        });
    }

    apply() {
        const visible = this._sorted(this.cards.filter(card => this._matches(card)));

        for (const card of this.cards) card.style.display = "none";

        const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
        if (this.state.page >= pageCount) this.state.page = pageCount - 1;
        const start = this.state.page * PAGE_SIZE;
        const slice = visible.slice(start, start + PAGE_SIZE);

        for (const card of slice) {
            card.style.display = "";
            this.grid.appendChild(card);
        }

        if (this.empty) this.empty.hidden = visible.length !== 0;
        if (this.pager) {
            this.pager.hidden = visible.length <= PAGE_SIZE;
            if (this.pageInfo) this.pageInfo.textContent = `${this.state.page + 1} / ${pageCount}`;
        }
    }
}
