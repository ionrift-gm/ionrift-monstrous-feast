# Changelog

All notable changes to Monstrous Feast are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

## [1.0.2] (2026-09-17)

### Fixed
- The setup warning no longer appears on Pathfinder 2e and Starfinder 2e worlds. Starter content loads from bundled data when the compendium is not available for the active system.

## [1.0.1] (2026-09-17)

### Fixed
- Starter compendium now loads correctly in Pathfinder 2e and Starfinder 2e worlds. Previously, the module showed a persistent setup warning after every reload on non-dnd5e systems.

## [1.0.0] (2026-08-10)

### Added
- General availability. Leaving Early Access; install from the GitHub release.

### Changed
- Split the GM console into separate Help and Manage flyouts. Getting started stays under Help; world homebrew JSON and party cookbook progress live under Manage.
- Recipe cards group meal effects under a shared duration header so rest windows are not repeated on every line.

## [0.1.0] (2026-07-02)

### Added
- Butcher the monsters you kill. 16-creature registry with combat-end prompts, survival rolls, and ingredient grants.
- Living Cookbook with progressive recipe discovery. Cook ingredients at camp and feed the party.
- Three starter recipes with party-wide meal effects that buff the next day of adventuring.
- Cookbook review panel with creature browse and GM Test Butcher action.
- Chat commands `/feast` and `/monstrousfeast`, plus token toolbar entry for quick access.
- D&D 5e and Pathfinder 2e system support at launch.
- PF2e meal buffs routed through the kernel BuffApplicator with GM relay for cross-owner applies.

### Changed
- Pathfinder 2e launch support restored alongside D&D 5e.
