import { CoreIcons } from "../data/CoreIcons.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @param {object} recipe
 * @param {boolean} ambitious
 * @returns {string[]}
 */
function buffLines(recipe, ambitious) {
    const fx = recipe?.partyEffect ?? {};
    const lines = [];
    const hp = ambitious ? (fx.ambitiousTempHP ?? fx.tempHP) : fx.tempHP;
    if (hp) lines.push(`${hp} temp HP`);
    if (fx.strengthAdvantage) lines.push("Strength advantage");
    if (fx.darkvisionFeet) lines.push(`Darkvision ${fx.darkvisionFeet} ft`);
    if (fx.perceptionAdvantageDim) lines.push("Keen senses in dim light");
    return lines;
}

/**
 * Cinematic plated-meal reveal after a successful cook.
 */
export class CookCeremonyApp extends HandlebarsApplicationMixin(ApplicationV2) {
    #recipe = null;
    #ambitious = false;
    #cookName = "";
    #resolve = null;

    static DEFAULT_OPTIONS = {
        id: "monstrous-feast-cook-ceremony",
        classes: ["ionrift-window", "monstrous-feast-ceremony"],
        position: { width: 520, height: "auto" },
        window: { frame: false, positioned: true },
        actions: {
            done: CookCeremonyApp.#onDone
        }
    };

    static PARTS = {
        body: { template: "modules/ionrift-monstrous-feast/templates/cook-ceremony.hbs" }
    };

    /**
     * @param {object} args
     * @param {object} args.recipe
     * @param {boolean} [args.ambitious]
     * @param {string} [args.cookName]
     * @returns {Promise<void>}
     */
    static play({ recipe, ambitious = false, cookName = "" } = {}) {
        return new Promise((resolve) => {
            const app = new CookCeremonyApp();
            app.#recipe = recipe;
            app.#ambitious = ambitious;
            app.#cookName = cookName;
            app.#resolve = resolve;
            app.render(true);
        });
    }

    async _prepareContext() {
        const output = this.#ambitious
            ? (this.#recipe?.ambitiousOutput ?? this.#recipe?.output)
            : this.#recipe?.output;

        return {
            title: this.#ambitious ? "A Feast Well Made" : "Served Up",
            narrative: this.#recipe?.successNarrative ?? "The dish comes together over the fire.",
            mealName: output?.name ?? this.#recipe?.name ?? "Monster Dish",
            mealImg: output?.img ?? CoreIcons.stew,
            rarity: output?.rarity ?? "common",
            ambitious: this.#ambitious,
            cookName: this.#cookName,
            buffs: buffLines(this.#recipe, this.#ambitious)
        };
    }

    _onRender() {
        if (this.element.dataset.mfBound !== "true") {
            this.element.dataset.mfBound = "true";
            this.element.addEventListener("click", (event) => {
                if (event.target === this.element) this.#finish();
            });
        }
    }

    #finish() {
        if (this.#resolve) {
            this.#resolve();
            this.#resolve = null;
        }
        this.close();
    }

    _onClose(options) {
        if (this.#resolve) {
            this.#resolve();
            this.#resolve = null;
        }
        return super._onClose(options);
    }

    static #onDone() {
        this.#finish();
    }
}
