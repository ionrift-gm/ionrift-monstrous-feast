import { ButcherEngine } from "../engine/ButcherEngine.js";

const MODULE_ID = "ionrift-monstrous-feast";

function readPromptHints(button) {
    return {
        actorId: button.dataset.targetActorId ?? null,
        tokenId: button.dataset.tokenId ?? button.dataset.combatantId ?? null
    };
}

async function handleButcherPromptClick(root, button) {
    const combatantId = button.dataset.combatantId;
    const action = button.dataset.action;
    const hints = readPromptHints(button);
    const target = ButcherEngine.resolvePromptTarget(combatantId, hints);

    if (action === "pass") {
        if (!target) {
            ui.notifications.warn("Butcher prompt expired or already resolved.");
            return;
        }
        const butcher = ButcherEngine.resolveActingButcher();
        if (!butcher) {
            ui.notifications.warn("No eligible butcher available.");
            return;
        }
        await ButcherEngine.passTarget(combatantId, target.actorName ?? "creature", target);
        root.replaceWith(Object.assign(document.createElement("p"), {
            className: "mf-passed",
            textContent: "Passed."
        }));
        return;
    }

    if (action !== "butcher") return;

    if (!target) {
        ui.notifications.warn("Butcher prompt expired or already resolved.");
        return;
    }

    const butcher = ButcherEngine.resolveActingButcher();
    if (!butcher) {
        ui.notifications.warn("No eligible butcher available.");
        return;
    }

    // Claim the target before awaiting so a second click cannot resolve twice.
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
}

export const ChatHandler = {
    init() {
        Hooks.on("renderChatMessageHTML", (message, html) => {
            if (!message.flags?.[MODULE_ID]?.butcherPrompt) return;

            const root = html.querySelector?.("[data-mf-card='prompt']");
            if (!root || root.dataset.mfBound === "true") return;
            root.dataset.mfBound = "true";

            root.addEventListener("click", async (event) => {
                const button = event.target.closest("button[data-action]");
                if (!button || !root.contains(button)) return;
                event.preventDefault();

                try {
                    await handleButcherPromptClick(root, button);
                } catch (err) {
                    ui.notifications.error("Butchering failed. See the console for details.");
                    console.error(err);
                }
            });
        });
    }
};
