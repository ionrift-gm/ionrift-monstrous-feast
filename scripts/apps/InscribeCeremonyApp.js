import { CoreIcons } from "../data/CoreIcons.js";
import { attachImageFallback } from "../ui/ImageFallback.js";
import { MealBuffHandlers } from "../data/MealBuffHandlers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @param {object} recipe
 * @returns {string[]}
 */
function buffLines(recipe) {
    return MealBuffHandlers.summaries(recipe?.partyEffect ?? {}, false);
}

/**
 * Cinematic confirm modal for inscribing a recipe page into the party cookbook.
 * Resolves true on confirm, false on cancel or close.
 */
export class InscribeCeremonyApp extends HandlebarsApplicationMixin(ApplicationV2) {
    #recipe = null;
    #bookName = "the party cookbook";
    #resolve = null;

    static DEFAULT_OPTIONS = {
        id: "monstrous-feast-inscribe-ceremony",
        classes: ["ionrift-window", "monstrous-feast-ceremony"],
        position: { width: 520, height: "auto" },
        window: { frame: false, positioned: true },
        actions: {
            confirm: InscribeCeremonyApp.#onConfirm,
            cancel: InscribeCeremonyApp.#onCancel
        }
    };

    static PARTS = {
        body: { template: "modules/ionrift-monstrous-feast/templates/inscribe-ceremony.hbs" }
    };

    /**
     * @param {object} args
     * @param {object} args.recipe
     * @param {string} [args.bookName]
     * @returns {Promise<boolean>}
     */
    static play({ recipe, bookName } = {}) {
        return new Promise((resolve) => {
            const app = new InscribeCeremonyApp();
            app.#recipe = recipe;
            app.#bookName = bookName ?? "the party cookbook";
            app.#resolve = resolve;
            app.render(true);
        });
    }

    async _prepareContext() {
        return {
            recipeName: this.#recipe?.name ?? "Unknown Recipe",
            recipeImg: this.#recipe?.output?.img ?? CoreIcons.stew,
            bookName: this.#bookName,
            buffs: buffLines(this.#recipe)
        };
    }

    _onRender(context, options) {
        attachImageFallback(this.element);
        if (this.element.dataset.mfBound !== "true") {
            this.element.dataset.mfBound = "true";
            this.element.addEventListener("click", (event) => {
                if (event.target === this.element) this.#finish(false);
            });
        }
    }

    #finish(result) {
        if (this.#resolve) {
            this.#resolve(result);
            this.#resolve = null;
        }
        this.close();
    }

    _onClose(options) {
        if (this.#resolve) {
            this.#resolve(false);
            this.#resolve = null;
        }
        return super._onClose(options);
    }

    static #onConfirm() {
        this.#finish(true);
    }

    static #onCancel() {
        this.#finish(false);
    }
}
