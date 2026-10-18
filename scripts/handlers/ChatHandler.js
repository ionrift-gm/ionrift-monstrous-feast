import { ButcherEngine } from "../engine/ButcherEngine.js";
import { MODULE_ID } from "../data/moduleId.js";

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

function attachToChatMessage(message, html) {
    const flags = message?.flags?.[MODULE_ID];
    if (!flags) return;

    if (flags.butcherPrompt) {
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
        return;
    }

    if (flags.butcherResult) {
        const root = html.querySelector?.("[data-mf-card='result']");
        if (!root) return;

        if (!game.user?.isGM) {
            root.querySelectorAll(".mf-gm-only, .mf-btn-undo").forEach(el => el.remove());
            return;
        }

        if (flags.undone) {
            root.querySelectorAll(".mf-gm-only, .mf-btn-undo").forEach(el => el.remove());
            if (!root.querySelector(".mf-butcher-undone")) {
                const undone = document.createElement("div");
                undone.className = "mf-butcher-undone";
                undone.innerHTML = `<i class="fas fa-rotate-left"></i> Butchering undone by GM. Offering restored.`;
                root.appendChild(undone);
            }
            return;
        }

        if (!root.querySelector(".mf-btn-undo") && !root.querySelector(".mf-butcher-undone")) {
            const actions = document.createElement("div");
            actions.className = "mf-butcher-actions mf-gm-only";
            actions.innerHTML = `
                <button type="button" class="mf-btn-undo" data-action="undo" title="GM: Undo butchering, remove items, and restore offering">
                    <i class="fas fa-rotate-left"></i> Undo Butchering
                </button>
            `;
            root.appendChild(actions);
        }

        if (root.dataset.mfResultBound === "true") return;
        root.dataset.mfResultBound = "true";

        root.addEventListener("click", async (event) => {
            const button = event.target.closest("button[data-action='undo']");
            if (!button || !root.contains(button)) return;
            event.preventDefault();

            if (!game.user?.isGM) return;

            button.disabled = true;
            button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Undoing...`;

            try {
                await ButcherEngine.undoResult(message, root);
            } catch (err) {
                button.disabled = false;
                button.innerHTML = `<i class="fas fa-rotate-left"></i> Undo Butchering`;
                ui.notifications?.error("Failed to undo butchering. See console for details.");
                console.error("Monstrous Feast | Undo failed:", err);
            }
        });
    }
}

export const ChatHandler = {
    init() {
        Hooks.on("renderChatMessageHTML", (message, html) => {
            attachToChatMessage(message, html);
        });

        Hooks.on("renderChatMessage", (message, html) => {
            const element = html instanceof HTMLElement ? html : html?.[0];
            if (element) attachToChatMessage(message, element);
        });

        if (canvas?.ready || game.messages?.contents?.length) {
            this.scanRenderedMessages();
        } else {
            Hooks.once("ready", () => this.scanRenderedMessages());
        }
    },

    scanRenderedMessages() {
        for (const message of game.messages?.contents ?? []) {
            if (!message.flags?.[MODULE_ID]) continue;
            const element = document.querySelector(`[data-message-id="${message.id}"]`);
            if (element) attachToChatMessage(message, element);
        }
    }
};
