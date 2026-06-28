import { ButcherEngine } from "../engine/ButcherEngine.js";

const MODULE_ID = "ionrift-monstrous-feast";

export const ChatHandler = {
    init() {
        Hooks.on("renderChatMessageHTML", (message, html) => {
            if (!message.flags?.[MODULE_ID]?.butcherPrompt) return;
            if (!game.user.isGM) return;

            const root = html.querySelector?.("[data-mf-card='prompt']");
            if (!root || root.dataset.mfBound === "true") return;
            root.dataset.mfBound = "true";

            root.addEventListener("click", async (event) => {
                const button = event.target.closest("button[data-action]");
                if (!button || !root.contains(button)) return;
                event.preventDefault();

                const action = button.dataset.action;
                const combatantId = button.dataset.combatantId;

                if (action === "pass") {
                    const target = ButcherEngine.getPendingTarget(combatantId);
                    await ButcherEngine.passTarget(combatantId, target?.actorName ?? "creature");
                    root.replaceWith(Object.assign(document.createElement("p"), {
                        className: "mf-passed",
                        textContent: "Passed."
                    }));
                    return;
                }

                if (action !== "butcher") return;

                const target = ButcherEngine.getPendingTarget(combatantId);
                if (!target) {
                    ui.notifications.warn("Butcher prompt expired or already resolved.");
                    return;
                }
                const butcher = ButcherEngine.resolveButcherActor();
                if (!butcher) {
                    ui.notifications.warn("No eligible butcher available.");
                    return;
                }

                // Claim the target before awaiting so a second click or a
                // re-render rebinding this listener cannot resolve it twice.
                ButcherEngine.clearPendingTarget(combatantId);

                root.querySelector(".mf-butcher-actions")?.replaceWith(Object.assign(document.createElement("p"), {
                    className: "mf-passed",
                    textContent: "Butchering..."
                }));

                await ButcherEngine.resolve(butcher, target);
                root.replaceWith(Object.assign(document.createElement("p"), {
                    className: "mf-passed",
                    textContent: `Butchered ${target.actorName}.`
                }));
            });
        });
    }
};
