/**
 * Chat card HTML for butcher prompts and results.
 */

export function buildPromptCard(target, butcherActors) {
    const dc = target.dc;
    const butcherNames = butcherActors.map(a => a.name).join(", ");

    return `<div class="mf-butcher-card" data-mf-card="prompt">
        <div class="mf-butcher-header">
            <img src="${target.actorImg}" alt="${target.actorName}" class="mf-butcher-img" />
            <div class="mf-butcher-title">
                <h3>${target.actorName}</h3>
                <span class="mf-butcher-tier tier-${target.registryEntry.tier ?? "common"}">${target.registryEntry.tier ?? "common"}</span>
            </div>
        </div>
        <p class="mf-butcher-flavour">${target.registryEntry.flavour ?? ""}</p>
        <div class="mf-butcher-info">
            <span><strong>DC:</strong> ${dc}</span>
            <span><strong>${target.crLabel}:</strong> ${target.cr}</span>
        </div>
        <p class="mf-butcher-who"><i class="fas fa-user"></i> ${butcherNames} can butcher this creature.</p>
        <div class="mf-butcher-actions">
            <button type="button" class="mf-btn-butcher" data-action="butcher" data-combatant-id="${target.combatantId}" data-target-actor-id="${target.actor.id}" data-token-id="${target.tokenId ?? target.combatantId}">
                <i class="fas fa-drumstick-bite"></i> Butcher
            </button>
            <button type="button" class="mf-btn-pass" data-action="pass" data-combatant-id="${target.combatantId}" data-target-actor-id="${target.actor.id}" data-token-id="${target.tokenId ?? target.combatantId}">
                <i class="fas fa-times"></i> Pass
            </button>
        </div>
    </div>`;
}

export function buildResultCard(result, butcherName) {
    const tierClass = `tier-${result.tier}`;
    const yieldLines = result.yields.map(y =>
        `<li>${y.qty}x ${y.name}${y.type === "loot" ? " <span class='mf-loot-tag'>loot</span>" : ""}</li>`
    ).join("");

    const outcomeLabel = {
        nat20: "Natural 20",
        nat1: "Natural 1",
        exceptional: "Exceptional",
        standard: "Standard",
        basic: "Basic"
    }[result.outcome] ?? result.outcome;

    let mishapHtml = "";
    if (result.mishap) {
        mishapHtml = `<div class="mf-butcher-mishap">
            <i class="fas fa-skull"></i>
            <span>${result.mishap.desc}</span>
            ${result.mishap.damage ? `<span class="mf-mishap-damage">${result.mishap.damage} ${result.mishap.damageType ?? ""}</span>` : ""}
        </div>`;
    }

    return `<div class="mf-butcher-card result" data-mf-card="result">
        <div class="mf-butcher-header">
            <img src="${result.creatureImg}" alt="${result.creatureName}" class="mf-butcher-img" />
            <div class="mf-butcher-title">
                <h3>${result.creatureName}</h3>
                <span class="mf-butcher-tier ${tierClass}">${result.tier}</span>
            </div>
        </div>
        <div class="mf-butcher-summary">
            <span><i class="fas fa-user"></i> ${butcherName}</span>
            <span>Roll <strong>${result.roll}</strong> vs DC <strong>${result.dc}</strong></span>
            <span class="mf-outcome outcome-${result.outcome}">${outcomeLabel}</span>
        </div>
        <p class="mf-butcher-flavour">${result.narrative}</p>
        <ul class="mf-butcher-yields">${yieldLines}</ul>
        <p class="mf-butcher-inventory"><i class="fas fa-backpack"></i> Added to ${butcherName}'s inventory.</p>
        ${mishapHtml}
    </div>`;
}

export function buildPassedCard(creatureName) {
    return `<div class="mf-butcher-card passed"><p class="mf-passed">Passed on butchering ${creatureName}.</p></div>`;
}
