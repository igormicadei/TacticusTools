---
name: tacticus-game-knowledge
description: Deep knowledge of Warhammer 40,000 Tacticus (the mobile tactics game this repo builds tools for) — its engine and combat math, damage types and pierce, crits, block, shields, terrain and hex effects, traits and status effects, unit progression (XP/rank/rarity/stars/ascension/Mythic), abilities and their scaling, equipment/forging/crafting, currencies, and every game mode (Campaign, Arena, Onslaught, Guild Raid, Guild War, Salvage Run, Tournament Arena, Incursion, Survival, Quest, HRE/LE, Crusade, Battle Pass). Use this skill whenever a task touches game mechanics, balance, formulas, unit stats, combat calculations, farming/progression planning, or anything about how Tacticus actually works — not just when the user says "explain the game." It applies to work in src/gamedata, ui/, docs, or any feature that computes, displays, or reasons about in-game numbers. Always consult this before guessing at a formula, a rank/rarity/star rule, a damage type's pierce ratio, or a game mode's rules — most of this is not obvious from the code alone and guessing produces confidently wrong numbers.
user-invocable: true
---

# Tacticus game knowledge

This skill exists because this repo (`TacticusTools`) computes and displays real
numbers from a game whose full rules are not published in any single place —
they're split across the game's own published config, a community wiki, and
things only observable by testing. Getting a formula slightly wrong produces a
plausible-looking number that is simply incorrect, so treat this skill as the
place to check before asserting anything mechanical.

## Two sources of truth — don't confuse them

**1. `src/gamedata` — the live, structured `GameDatabase`.** This is fetched from
the game's own published config (`tacticustable.com/gameInfo.json`) plus the
Tacticus Codex, normalized, and kept current. It is authoritative for anything
**unit-, item-, or ability-specific**: every unit's stats/traits/weapons per rank,
every item's stats per level, every ability's per-level values, every trait's
verbatim in-game text, every campaign node's enemies and drop rates, the XP
table, and the shard/orb cost per star level.

→ Read `references/gamedata-module.md` first for what's in it and how to query
it. **Never hand-transcribe a unit's stats, an item's numbers, an ability's
values, or a trait's wording into a reference file or a one-off answer** — look
it up in the database, because it is more current than anything written here
and will drift out of sync if duplicated.

**2. `references/*.md` in this skill — engine mechanics the database does not
carry.** The database has no notion of turn order, terrain, hex effects, crit
chains, block stacking, damage caps, status effects, or the rules of Arena,
Guild War, Onslaught, etc. That knowledge lives in the reference files below,
gathered from the community wiki (tacticus.wiki.gg, the successor to the
now-abandoned tacticus.fandom.com) and from formulas mined out of
tacticustable.com's client code. Community-sourced knowledge is not the same
grade of authority as the game's own config — where a source is uncertain,
contradicts another, or is one wiki editor's paraphrase, that is flagged
in-line and in `references/sources-and-caveats.md`. Read the caveats before
treating a number here as exact.

## Reference map

| File | Covers |
|---|---|
| `references/gamedata-module.md` | What's in `GameDatabase`, the key functions (`computeUnitStats`, `unitCombat`, `resolveAbility`, `resolvePlan`, `planCosts`, `itemSource`, `nodeStatuses`...), and how to query them instead of guessing |
| `references/combat-engine.md` | The full damage formula, armour vs. pierce ratio, damage variance, crit chains, block/multi-block, shields, damage caps/buffs/penalties, overkill, added/extra hits, Heavy Weapon, Mk X Gravis, "Can't Crit" abilities |
| `references/battlefield-and-terrain.md` | Turns/rounds and their resolution order, movement/actions, adjacency vs. surrounding, elevation/cliffs/line of sight, terrain types, hex effects (Fire/Ice/Contamination/Despoiled Ground), displacement (push/pull/throw), charging |
| `references/traits-and-status-effects.md` | How to read traits (use the DB, not this file, for exact wording), the cross-cutting interactions traits create (Resilient, Overkill-immunity, Immune, Swarm...), status effects that are battle state rather than unit traits (Stunned, Suppressed, Taunted...), healing/repair/revive/resurrect, on-death resolution order |
| `references/progression-and-abilities.md` | XP levels, upgrade ranks, stars/promotion, rarity/ascension, Mythic rarity, the star-multiplier and ability-rarity-bonus formulas (confirmed linear, not compounding), ability leveling costs, Machines of War ability scaling |
| `references/equipment-forge-and-items.md` | Equipment slots/categories, the crit/block **diminishing-returns** stacking formula, rarity-cap scaling-down rules, forging and crafting cost tables, Mythic binding, Relics |
| `references/game-modes.md` | Every game mode's rules and numbers: Campaign, Arena, Onslaught, Guild Raid (incl. the Prime boss debuff formulas), Guild War, Salvage Run, Tournament Arena, Incursion, Survival, Quest, HRE, LE, Crusade, Battle Pass, Machines of War |
| `references/economy-and-meta.md` | Currencies and shops, Requisitions/gacha odds, Power Score, factions/alliances, energy, guilds, missions, glossary of abbreviations |
| `references/sources-and-caveats.md` | Every URL consulted, and every gap/ambiguity/contradiction the research surfaced — read this before citing an exact number as certain |

## Working principles

- **Check the database before the wiki, and the wiki before memory.** If a
  question is about a specific unit, item, or ability's numbers, it is in
  `GameDatabase` — look it up rather than recalling it. If it's about a rule the
  database has no field for (how block stacks, what a hex effect does), use the
  matching reference file. Only fall back to general knowledge for things
  neither source covers, and say so.
- **Formulas here describe the game, not this repo's code — check they still
  agree.** `src/gamedata` already implements a good chunk of this correctly
  (damage/pierce math, star scaling, crit/block stacking, ability resolution,
  evolution planning), each cross-checked against a real character screen or a
  mined formula at the time this skill was written. Most of `game-modes.md`,
  `battlefield-and-terrain.md`, and the trait/status-effect interactions have
  no code counterpart at all — the database has no terrain, turn-order, or
  game-mode fields — so there's nothing to reconcile there. Where a reference
  file does describe something the code also computes, don't assume they still
  agree without spot-checking; the code is a moving target and a future change
  could drift from a rule documented here.
- **The game changes.** Numbers tied to a patch (Power Level caps, event shard
  costs, rank caps) are dated in the reference files where the source dated
  them. Prefer the database for anything it covers, since it refreshes from the
  live game config; treat a dated wiki figure as "true as of that patch" and
  re-verify before relying on it for something balance-sensitive.
- **Traits and abilities are prose, not parameters, in the actual game data** —
  `db.traits[id].description` and a resolved ability's description are the
  exact in-game wording, conditionals and all. Quote or closely paraphrase them
  rather than inventing a cleaner-sounding rule; the real conditions ("if it has
  not moved this turn", "the first time this unit is defeated") are usually
  exactly why a trait matters.
