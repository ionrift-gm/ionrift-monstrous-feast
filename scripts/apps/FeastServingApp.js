import { MealEffects } from "../services/MealEffects.js";
import { attachImageFallback } from "../ui/ImageFallback.js";
import { RollRequestQueue } from "../services/RollRequestQueue.js";

const rollMechanicsPath = "../../../ionrift-library/scripts/services/RollRequestMechanics.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** @type {FeastServingApp|null} */
let OPEN = null;

/**
 * GM panel to orchestrate per-player temp HP rolls after a successful cook.
 */
export class FeastServingApp extends HandlebarsApplicationMixin(ApplicationV2) {
    #recipe = null;
    #ambitious = false;
    #tempFormula = "";
    #cookName = "";
    /** @type {Map<string, { id: string, name: string, img: string, status: string, total: number|null, rolling: boolean }>} */
    #members = new Map();
    #servingStarted = false;

    static DEFAULT_OPTIONS = {
        id: "monstrous-feast-serving",
        classes: ["ionrift-window", "monstrous-feast-serving"],
        position: { width: 480, height: "auto" },
        window: {
            title: "Serve the Feast",
            icon: "fas fa-bowl-food",
            resizable: true
        },
        actions: {
            beginServing: FeastServingApp.#onBeginServing,
            rollForMember: FeastServingApp.#onRollForMember,
            rollAllRemaining: FeastServingApp.#onRollAllRemaining,
            closeServing: FeastServingApp.#onCloseServing
        }
    };

    static PARTS = {
        body: { template: "modules/ionrift-monstrous-feast/templates/feast-serving.hbs" }
    };

    /**
     * @param {object} args
     * @param {object} args.recipe
     * @param {boolean} [args.ambitious]
     * @param {string} args.tempFormula
     * @param {string} [args.cookName]
     */
    static open(args = {}) {
        if (!game.user.isGM) return null;
        if (!args.tempFormula) return null;

        if (OPEN?.rendered) {
            OPEN.#initState(args);
            OPEN.render(false);
            return OPEN;
        }

        const app = new FeastServingApp();
        app.#initState(args);
        OPEN = app;
        app.render(true);
        return app;
    }

    #initState({ recipe, ambitious = false, tempFormula = "", cookName = "" } = {}) {
        this.#recipe = recipe;
        this.#ambitious = ambitious;
        this.#tempFormula = tempFormula;
        this.#cookName = cookName;
        this.#servingStarted = false;
        this.#members = new Map();

        for (const actor of MealEffects.getPartyMembers()) {
            this.#members.set(actor.id, {
                id: actor.id,
                name: actor.name,
                img: actor.img ?? "",
                status: "waiting",
                total: null,
                rolling: false
            });
        }
    }

    async _prepareContext() {
        const members = [...this.#members.values()];
        const rolledCount = members.filter(entry => entry.status === "rolled").length;
        const mealName = this.#recipe?.name ?? "Meal";

        return {
            mealName,
            tempFormula: this.#tempFormula,
            cookName: this.#cookName,
            ambitious: this.#ambitious,
            members,
            rolledCount,
            totalCount: members.length,
            allRolled: members.length > 0 && rolledCount === members.length,
            servingStarted: this.#servingStarted
        };
    }

    _onRender(context, options) {
        attachImageFallback(this.element);
    }

    _onClose(options) {
        if (OPEN === this) OPEN = null;
        return super._onClose(options);
    }

    static #onBeginServing() {
        return this.#beginServing();
    }

    static #onRollForMember(_event, target) {
        const memberId = target?.dataset?.memberId;
        if (!memberId) return;
        return this.#rollForMember(memberId, true);
    }

    static #onRollAllRemaining() {
        return this.#rollAllRemaining();
    }

    static #onCloseServing() {
        this.close();
    }

    async #beginServing() {
        if (this.#servingStarted) return;
        this.#servingStarted = true;
        this.render(false);
        await this.#rollAllRemaining();
    }

    async #rollAllRemaining() {
        const pending = [...this.#members.values()].filter(entry => entry.status !== "rolled");
        for (const entry of pending) {
            await this.#rollForMember(entry.id, false);
        }
    }

    /**
     * @param {string} memberId
     * @param {boolean} gmDirect When true, roll locally without prompting the player.
     */
    async #rollForMember(memberId, gmDirect = false) {
        const entry = this.#members.get(memberId);
        const actor = game.actors.get(memberId);
        if (!entry || !actor || entry.status === "rolled" || entry.rolling) return;

        entry.rolling = true;
        this.render(false);

        const flavor = `${this.#recipe?.name ?? "Meal"} temp HP (${this.#tempFormula})`;
        let total = 0;

        try {
            if (gmDirect || !game.ionrift?.library?.rollRequest) {
                const { executeFormulaRoll } = await import(rollMechanicsPath);
                const result = await executeFormulaRoll(actor, this.#tempFormula, {
                    flavor: gmDirect ? `${flavor} [GM roll]` : flavor
                });
                total = result.total;
            } else {
                const result = await RollRequestQueue.request({
                    actorId: actor.id,
                    type: "formula",
                    formula: this.#tempFormula,
                    title: "Meal Temp HP",
                    flavor,
                    offlinePolicy: "gm-fallback"
                }, { key: `mealTempHP:${this.#recipe?.id ?? "?"}:${actor.id}` });
                total = result.total;
            }

            await MealEffects.applyTempHP(actor, total);
            entry.status = "rolled";
            entry.total = total;
        } catch (err) {
            entry.status = "waiting";
            ui.notifications?.warn(`Could not roll temp HP for ${actor.name}.`);
        } finally {
            entry.rolling = false;
            this.render(false);
        }
    }
}
