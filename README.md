# Monstrous Feast

Hunt, butcher, and cook the monsters you kill. Monstrous Feast turns slain creatures into ingredients, lets the party cook them at camp, and feeds everyone for real mechanical buffs.

## How it works

When a combat ends, the module looks at the creatures that fell and offers to butcher them. Each creature yields ingredients based on what it was and how tough it was. Those ingredients feed monster recipes that produce food with buffs the party carries into the next fight.

## Requirements

Monstrous Feast requires [Ionrift Library](https://github.com/ionrift-gm/ionrift-library) (2.5.2 or newer). Foundry installs it automatically when you add this module. The library supplies creature classification and cross-system support for DnD5e, PF2e, and Daggerheart.

## How to review it now

1. Enable **Monstrous Feast** and **Ionrift Library**, then reload the world.
2. Open the GM panel from the token toolbar drumstick icon or `/feast`.
3. Click **Grant Monster Cooking Book** (or `game.ionrift.monstrousFeast.grantBook(actor)`).
4. Open the book from the character sheet, then **Open Living Cookbook**.
5. **Butcher:** select a defeated creature token, run **Test Butcher**, check chat for yields.
6. **Cook:** on an unlocked Living Cookbook page, click **Cook** when ingredients are present.

Full loop test ingredients:
- Campfire Monster Roast: 2x Monster Meat (from any butcher yield)
- Bear Roast: Bear Haunch + Rations
- Owlbear Stew: Owlbear Flank + Wild Herbs + Rations

Console helpers:

```javascript
game.ionrift.monstrousFeast.grantBook(game.actors.getName("Your PC"))
game.ionrift.monstrousFeast.openLivingCookbook(bookItem, actor)
game.ionrift.monstrousFeast.cook(actor, "cook_campfire_monster_roast")
```

Launch systems: D&D 5e and Pathfinder 2e. The module routes actor queries through `game.ionrift.library.system`.

## License

MIT. See [LICENSE](LICENSE).
