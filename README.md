# Ionrift Monstrous Feast

![Foundry v12+](https://img.shields.io/badge/Foundry-v12%2B-333333?style=flat&logo=foundryvirtualtabletop)
![Systems](https://img.shields.io/badge/system-dnd5e-blue)
![Status](https://img.shields.io/badge/status-Early%20Access-8b5cf6)

**Butcher and cook the monsters you kill.** Turn slain creatures into ingredients, track discoveries in a shared party cookbook, and serve fresh meals with real mechanical buffs.

### Support Ionrift

[![Patreon](https://img.shields.io/badge/Patreon-ionrift-ff424d?logo=patreon&logoColor=white)](https://patreon.com/ionrift)
[![Discord](https://img.shields.io/badge/Discord-Ionrift-5865F2?logo=discord&logoColor=white)](https://discord.gg/vFGXf7Fncj)

> Documentation, setup guides, and troubleshooting: **[Ionrift Wiki](https://github.com/ionrift-gm/ionrift-library/wiki)**

---

## How it works

1. **Butcher.** After combat, eligible corpses get canvas markers and chat offers. A Survival roll determines yield quality: basic cuts, standard portions, or exceptional trophies.
2. **Discover.** Each butchered creature logs in the party **Monster Cooking** book. Recipe pages found as loot inscribe full dishes when used.
3. **Cook.** The book keeper opens the Living Cookbook, picks an inscribed recipe, and rolls Survival with DC modifiers for Chef, utensils, and improvised gear.
4. **Serve.** Successful cooks plate the meal immediately. The party eats on the spot: shared meal buffs and per-member temp HP. No inventory meal items.

---

## Features

- **Combat-end butchering** with corpse markers, chat cards, and reach checks on the active scene.
- **Progressive discovery:** creature yields and inscribed recipes tracked separately on one shared cookbook.
- **Living Cookbook UI** with Creatures and Recipes tabs, cook sessions, and a read-only Party Cookbook journal for the table.
- **Party meals** with standard and ambitious tiers, optional seasoning, and feast serving with temp HP rolls.
- **Starter content:** seven creature types, nine recipes, pantry staples, and recipe pages in the bundled compendium.
- **Respite handoff** when both modules are installed: rest-phase cooking can open the Monstrous Feast cookbook instead of the native crafting UI.

---

## Installation

1. Install via manifest URL:
   `https://github.com/ionriftgm/ionrift-monstrous-feast/releases/latest/download/module.json`
2. Enable **Monstrous Feast** and **Ionrift Library** in your world.
3. Reload the world. Open the GM console (`/feast`) and grant the **Monster Cooking** book to a party member.

Full walkthrough: **[Setup: Monstrous Feast](https://github.com/ionrift-gm/ionrift-library/wiki/13-Setup-Monstrous-Feast)** on the Ionrift Wiki.

---

## Requirements

| Module / system | Required? | What it enables |
|-----------------|-----------|-----------------|
| [`ionrift-library`](https://github.com/ionrift-gm/ionrift-library) v2.5.3+ | **Yes** | Creature classification, system bridge, cooking buff pipeline |
| DnD 5e | **Yes** | Butcher and cook rolls, meal buffs |
| [`ionrift-respite`](https://github.com/ionrift-gm/ionrift-respite) | Optional | Rest cooking handoff, ingredient spoilage metadata |

---

## Quick test

```javascript
game.ionrift.monstrousFeast.grantBook(game.actors.getName("Your PC"))
game.ionrift.monstrousFeast.openLivingCookbook(bookItem, actor)
game.ionrift.monstrousFeast.cook(actor, "cook_campfire_monster_roast")
```

Loop ingredients for a smoke test:

- **Campfire Monster Roast:** 2x Monster Meat (from any butcher yield)
- **Bear Roast:** Bear Haunch + Rations
- **Owlbear Stew:** Owlbear Flank + Rations

---

## Documentation

- **[Setup: Monstrous Feast](https://github.com/ionrift-gm/ionrift-library/wiki/13-Setup-Monstrous-Feast)** — Installation, settings, starter compendium
- **[Butchering and Cooking](https://github.com/ionrift-gm/ionrift-library/wiki/14-Monstrous-Feast-Butchering-and-Cooking)** — Full hunt-to-table loop

---

## Bug reports

1. Check the **[Ionrift Wiki](https://github.com/ionrift-gm/ionrift-library/wiki)** for troubleshooting.
2. Post to the **[Ionrift Discord](https://discord.gg/vFGXf7Fncj)** with Foundry version, module versions, and console errors.
3. Open a **[GitHub Issue](https://github.com/ionriftgm/ionrift-monstrous-feast/issues)**.

---

## License

MIT. See [LICENSE](LICENSE).

---

**Part of the [Ionrift Module Suite](https://github.com/ionrift-gm)**

[Wiki](https://github.com/ionrift-gm/ionrift-library/wiki) · [Discord](https://discord.gg/vFGXf7Fncj) · [Patreon](https://patreon.com/ionrift)
