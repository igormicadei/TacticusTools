# The `src/gamedata` module — query this before guessing

This repo already builds and ships a normalized, per-id `GameDatabase` from the
game's own published config. If a question is about a specific unit, item,
ability, trait, campaign node, NPC, or XP/progression cost, **it is almost
certainly already here** — look it up rather than recalling a number or
transcribing one from a wiki page, because this is more current and more exact
than anything hand-written.

```ts
import { gamedata } from 'tacticus-tools'; // or the equivalent local import path

const db = await gamedata.loadGameDatabase(); // cache-first, 7-day TTL
```

Full field-level docs live in `src/gamedata/types.ts` (read it directly for the
exact shape — this file is a map, not a copy). The README.md at the repo root
also has a long, carefully-verified narrative walkthrough of the same material;
prefer it over re-deriving something covered here.

## What's in `GameDatabase`

| Field | Keyed by | Contains |
|---|---|---|
| `units` | `UnitId` | Every character and Machine of War: base rarity, alliance, movement, item slot types, traits, ability ids, melee/ranged `WeaponProfile` (hits, damage type, range, pierce ratio), and per-rank stats + rank-up materials |
| `upgrades` | `UpgradeId` | Rank-up materials: rarity, crafting recipe (`crafting`/`baseUpgrades`), and `farmableAt` (normalized campaign nodes) |
| `items` | `ItemId` | Equipment: rarity, per-level stats (`ItemLevel.stats`, plus `dustCost`/`goldCost`/`mythicDustCost` — the forging cost of *that specific item's* level), allowed factions |
| `abilities` | `AbilityId` | Per-level `variables`/`textVariables`/`constants`, which variables get the rarity bonus, and `attackRangeType` when the ability is itself an attack |
| `traits` | trait id (string) | Verbatim in-game name + description (marked-up), and whether it's a hero trait — **this is the authoritative trait text**, not `references/traits-and-status-effects.md` |
| `pierceByDamageProfile` | damage type string | Pierce ratio 0–1, derived from the weapons themselves (cross-checked against the wiki's independently-written table — see `combat-engine.md`) |
| `npcs` | `NpcId` | Enemy stats by rank (sparse) |
| `campaigns` | `CampaignId` | Per-node enemy composition, drop rates, energy cost, reward material/shard |
| `shardSources` | `UnitId` | Nodes that drop a unit's shards |
| `xpLevels` | array | `totalXp` (cumulative, reached-at semantics) and `xpToNextLevel` per level |
| `xpBooks` | array | XP granted per book rarity |
| `abilityUpgradeCosts` | array | Gold + badge cost of leaving each ability level |
| `progressionRequirements` | array | Shards/orbs to reach each star level, `kind` (promotion/ascension), derived `starLevel` |
| `rarityCaps` | array | Level ceiling per rarity (Common 8, Uncommon 17, Rare 26, Epic 35, Legendary 50 — no published Mythic cap, so none is emitted) |
| `stats` | — | Merge-quality counters (how many enemies/battle refs resolved, etc.) |

## Key functions — use these, don't reimplement them

All in `src/gamedata/*.ts`; import from the package root.

- **`computeUnitStats(unit, db)`** (`stats.ts`) — reconstructs the character
  screen's Health/Damage/Armour from rank base stats, cumulative star
  multiplier, applied rank upgrades, and equipment. Returns `undefined` rather
  than extrapolating if the database has no stat row for the unit's rank.
- **`computeItemBonuses(items, db)`** (`stats.ts`) — sums equipped items' stats.
  **Known gap**: this currently does a flat sum for every stat including
  `critChance`/`blockChance`. The real game uses diminishing-returns stacking
  for those two specifically — see `equipment-forge-and-items.md` for the exact
  formula and a worked example. Don't assume this function's crit/block output
  matches the game exactly.
- **`unitCombat(unit, damage, rarity, db, critChance?)`** (`combat.ts`) —
  resolves a unit's melee/ranged attack profiles, every ability at its current
  level and rarity, resolved trait text, and the crit-chain probabilities for
  multi-hit attacks.
- **`resolveAbility(ability, level, rarity, db, slot, context)`** (`combat.ts`)
  — fills an ability's `{[variable]}` placeholders in at a given level, applying
  the rarity bonus only to variables the ability itself flags. See
  `progression-and-abilities.md` for why the bonus is linear, not compounding.
- **`pierceRatio(damageProfile, db)`** (`combat.ts`) — pierce ratio for a named
  damage type, falling back to the one hard-coded exception (`DirectDamage`,
  100%) that no hero weapon carries so it can't be derived from the roster.
- **`resolvePlan(unit, target, db, from?)`** (`plan.ts`) — turns a target
  rank/level/rarity/ability-level into an ordered, dependency-resolved sequence
  of steps (promote → ascend → rank → level → ability), honoring the gating
  rules documented at the top of that file (level ≤ rarity cap, ability level ≤
  character level, rank ≤ `3 × (rarity + 1)`, the level-to-complete-a-rank
  table). Those gating rules are **derived from observed rosters**, not all
  published — see the file's own doc comments for the evidence behind each one
  before assuming a different rule.
- **`planCosts` / `allocateHoldings` / `aggregate`** (`requirements.ts`) — what
  a plan costs in upgrades/XP/badges/shards/orbs, spread across held inventory
  in plan order, with crafted items expanded recursively into their base
  materials.
- **`itemSource` / `itemSources` / `nodeStatuses`** (`requirements.ts`) —
  where an item comes from (farm node vs. crafted recipe vs. neither), and
  which of its nodes the player has actually unlocked, with energy-per-drop.
- **`buildTimeline(plans, player, db)`** (`timeline.ts`) — merges multiple
  units' plans into one shared allocation of inventory, ordered by rank-up
  bundles.

## Things the database deliberately does **not** compute

- **Power Score.** The formula is unpublished and non-linear (see
  `economy-and-meta.md`); `POWER_SCORE_IS_UNPUBLISHED = true` in `stats.ts`
  documents why a formula here would be a guess presented as fact. Real values
  exist only via the `guildRaid` API endpoint's `PublicHeroDetail.power`.
- **Terrain, hex effects, turn order, block/crit-chain interactions, status
  effects, or any game-mode's rules.** None of this has a field in
  `GameDatabase` — it's battle-state and rules knowledge, not published game
  config, so it lives in the other reference files in this skill instead.
