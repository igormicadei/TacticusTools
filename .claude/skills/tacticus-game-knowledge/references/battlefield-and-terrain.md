# Battlefield, terrain, turns, and positioning

Sources: tacticus.wiki.gg `Terrain`, `HDTW_Fire`, `HDTW_Ice`, `HDTW_Surrounding`,
`HDTW_Turns`, `HDTW_Displacement`, `Advanced_Mechanics`, `Combat_Basics`. Full
citations in `sources-and-caveats.md`. None of this has a field in
`GameDatabase` — no map/terrain data is published or fetched by this repo.

## Turns, rounds, and actions

- A **turn** is one player acting with any/all of their deployed units, ending
  when no actions remain or the player double-taps End Turn. There is **no
  fixed order** between your own units within your turn — freely interleave
  partial actions across characters.
- A **round** is one turn per side — normally 2, but battles with allied NPC
  factions can have more.
- Each unit gets **one Action per turn** unless something grants an extra one,
  and **you cannot move after attacking** (attacking ends that unit's movement
  option for the turn).
- **Start-of-turn resolution order** (fixed priority, established via wiki
  testing and confirmed across two changelog reworks — Dec 2024 and Jan 2025):

  | # | Event |
  |---|---|
  | 0 | Deployment (Draft TA, mid-battle spawns) |
  | 1 | Effects/buffs expire |
  | 2 | Trigger-and-wait effects activate (Overwatch, Terminator Armour, etc.) |
  | 3 | Health-regen traits/abilities (simultaneous) |
  | 4 | Special hex effects — **Healing hex resolves before Fire damage** |
  | 5 | Fire hex spreading |
  | 6 | Delayed attacks queued on a prior turn |
  | 7 | "At the start of their turn" abilities, in deployment order |
  | 8 | Summons act, in the order they were summoned |

- **Charging**: a unit is "charging" in a turn where it moved to become
  adjacent to its melee target, having started that movement *not* already
  adjacent to it — referenced by abilities that trigger "on Charge."

## Adjacent vs. Surrounding — precise, and easy to get wrong

- **Surrounding** = the 6 hexes physically around a reference hex, **ignoring
  elevation** — this extends across a Bridge's far side or over a Cliff.
- **Adjacent** = the subset of Surrounding hexes that are within **±1
  elevation** *and* do not cross a Bridge side or pass over a Cliff border.
  **Melee attacks can only target Adjacent hexes** — this is why elevation and
  bridges matter for targeting, not just movement.
- A **cliff border** is an elevation difference of **2 or more** between
  neighboring hexes — impassable to anything without Flying, and blocks line
  of sight for ranged attacks unless the attacker has Indirect Fire.

## Elevation and line of sight

- Units climb **at most 1 elevation level per hex** stepped into; a 2+ level
  jump requires a cliff border, which is otherwise impassable.
- **High Ground**: a unit on higher ground deals **+50% Damage** to a unit on
  lower ground — this is a *post-armour* modifier (see `combat-engine.md`).
  Maps support up to 4 distinct elevation levels; a unit can have High Ground
  against one enemy while itself standing on lower ground relative to a third.
- A unit standing on top of a cliff can fire down and be fired upon normally;
  the cliff only blocks vision/fire *across* the border, not from atop it.
- **Indirect Fire** bypasses line-of-sight blocking from cliffs and ignores
  Trenches entirely.

## Terrain types

| Terrain | Rule |
|---|---|
| Normal | No special effect |
| Bridge | Only 2 of 6 sides are accessible/adjacent; the other 4 are impassable and non-adjacent |
| Broken Ice | Stops movement on entry unless Flying/Unstoppable/Vehicle. If a unit starts its turn there and leaves, the hex becomes impassable (except to Flying) until it reforms **after 2 rounds** |
| Healing Hex | Restores **35%** of a unit's *initial* Health at the start of their turn — this is a real **Heal** effect (removes many debuffs; only affects non-Mechanical units) |
| Impassable | Cannot be occupied by anything |
| Open/Opened Hatchway | Moving onto it opens the nearest hatchway; a closed hatchway blocks vision/interaction beyond it |
| Razor Wire | Stops movement on entry unless Flying/Unstoppable/Vehicle. Units standing on it take **+50% Damage** |
| Tall Grass | Ranged attacks against a unit here get **−2 hits** (min 1). Big Target/Vehicle get no benefit from standing in it. Fire can spread into it |
| Trenches | Units take **−50% damage** from attacks whose line **crosses** a trench border (attacks from outside always cross; from inside the same connected trench, only if the path bends). High Ground does not apply to a unit in Trenches. Big Target/Vehicle get no benefit. **Indirect Fire ignores this entirely** |
| Wave Spawn Point | Impassable to player units/summons; Normal terrain to enemies — hex effects can still apply to it |

## Hex effects (transient overlays — only one active per hex at a time; a new one replaces the old)

| Effect | Rule | Duration |
|---|---|---|
| Contamination | **−30% Armour** for units on/starting their turn on it. No effect on Mechanical units or units with Contagions of Nurgle | 2 rounds |
| Despoiled Ground | Units starting their turn here take **6–9% of initial Health** as **Direct** damage (bypasses armour). Affected **Chaos** units also deal **+15% damage** to Xenos/Imperial targets, but only until the end of that unit's own turn | 2 rounds |
| Fire | Entering must stop movement (except Flying/Unstoppable). Starting a turn on it deals **20% of initial Health** as **Flame** damage (armour/block apply normally). Can spread to adjacent Tall Grass — a hex that *just* caught fire via spread this instant does not also deal damage that same turn | 2 rounds (4 turns) |
| Ice | Stops movement on entry unless Flying/Unstoppable/Vehicle. Units standing on it take **+25% Crit Damage** specifically (boosts the Crit Damage stat/value, not generic bonus damage or Crit Chance) — **never applies to Guild Raid bosses**, since they carry the Immune trait | 2 rounds |

Map tilesets (Arctic, Cadia, Craftworld, Desert, Forge World, Mars, Necron,
Space Hulk, Temperate, and "Infested" variants) are purely cosmetic skins over
these same terrain/hex rules.

## Displacement — Push, Pull, Throw

None of the three count as **Movement**: they do not trigger Overwatch or
movement-keyed passives.

- **Push**: moves the target one adjacent hex directly away from the source.
- **Pull**: one adjacent hex directly toward the source.
- **Throw**: a specified or random direction, and **can skip over** intervening
  hexes.
- A valid destination hex must be: within ±1 elevation, not across a Bridge
  side, not impassable terrain, and unoccupied (a Steppable, e.g. a Decoy,
  doesn't count as occupying it).
- **No valid destination → "knockback"**: the unit instead takes **20% of its
  max Health as Direct damage**. This can be Blocked but is **not** subject to
  other damage buffs, High Ground, Razor Wire, or Trenches. If the *target*
  hex is occupied by another unit, that unit takes the same knockback damage
  too.
- A few characters override the generic rule (Screamer-Killer adds extra
  Direct damage beyond knockback; Tanksmasha's "push" is mechanically a throw
  with its own damage instead of knockback; Tjark can Pull across elevation
  differences that would normally block it) — check the unit's own ability text
  via `db.abilities` before assuming the generic rule applies.
