# Homebrew content

Add custom creatures and recipes two ways:

1. **World homebrew (for this world).** In the GM console (`/feast`), choose
   **Setup and tools**, then **Import JSON** or **Export JSON**. Survives module
   updates.
2. **File drop-in (edit files on disk).** Edit the JSON files in this folder and click **Reload Registry**.

Files in this folder:

- `creatures.json`: custom butchering yields, keyed by creature classifier id
- `recipes.json`: custom recipes in a `recipes` array

After editing files, open the GM console and click **Reload Registry**, or run
`game.ionrift.monstrousFeast.reloadRegistries()`. No world reload is needed.

Homebrew loads at the highest precedence. It overrides overlay content, which
overrides bundled content. An entry whose id matches a bundled or pack entry
replaces it. Use a new id to add content alongside the defaults.

Reference the bundled content while authoring:

- `../../scripts/data/catalogs/creature-registry.json`
- `../../scripts/data/catalogs/recipes-core.json`

To find the classifier id for a creature, select its token and run
`game.ionrift.monstrousFeast.inspectButcher(token)`.

Full field reference, the party-effect buff keys, and worked examples are in the
Homebrew JSON guide on the Ionrift Wiki:
https://github.com/ionrift-gm/ionrift-library/wiki/15-Monstrous-Feast-Homebrew-JSON

These files survive module updates. Keep a copy outside the module folder if you want one.
