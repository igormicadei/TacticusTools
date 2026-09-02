# Unit progression and ability scaling

Sources: tacticus.wiki.gg `Unit_Progression`, `HDTW_Progression`, `HDTW_Mythic`,
`Abilities`, `Machines_of_War`; formulas mined from tacticustable.com's client
bundle (see `sources-and-caveats.md`). Cross-referenced against
`src/gamedata/stats.ts`, `combat.ts`, `plan.ts`, and the repo README's
"Derived stats" / "Star progression" sections, which independently verified
several of these against real character screens — prefer those when they
disagree with a wiki paraphrase.

Four **independent** progression axes: XP Level, Upgrade Rank, Stars
(Promotion), and Rarity (Ascension) — plus Equipment, which is flat and scales
with none of them.

## XP Level

- No direct stat benefit by itself. It gates two things: the maximum Ability
  level (`maxAbilityLevel(xpLevel) = xpLevel` in `plan.ts`, confirmed — no
  ability exceeds its unit's level across a real roster), and whether a rank's
  upgrades can be applied (`levelToCompleteRank`). A rank's upgrades are
  level-gated, so raising a rank pulls character level up with it, not the
  other way around.
- **Level is capped by Rarity** — `db.rarityCaps`: Common 8, Uncommon 17, Rare
  26, Epic 35, Legendary 50. No Mythic cap is published in the game's config;
  the wiki's own figure has moved across patches (55 → 60 → reportedly 65) as
  Mythic content expanded — treat any specific Mythic level cap as
  patch-dependent and unconfirmed rather than a fixed constant.

## Upgrade Rank

- The repo's `Rank` enum models 20 ranks, Stone I → Mythic II (indices 0–19).
  The wiki describes **three** post-Diamond-III ranks ("Adamantine I–III");
  this repo's enum currently has only **two** (Mythic I/II). `parseRank` in
  `enums.ts` aliases the wiki's `Adamantine I` to Mythic I and Codex's numeric
  `Rank 20` to Mythic II, but has **no alias for `Adamantine II` or
  `Adamantine III`** — passing either currently returns `undefined`, not a
  rank. Don't assume both extra wiki-named ranks parse; if a task needs to
  resolve `Adamantine II`/`III` from user input, that alias doesn't exist yet
  and should be added to `RANK_LOOKUP` (and the `Rank` enum extended) rather
  than assumed. See `sources-and-caveats.md`. A new character starts at
  Stone I (rank 0, no upgrades applied).
- **Each rank costs 6 upgrade items**: two each boosting Health, Damage, and
  Armour. Exact materials per unit/rank are in `db.units[id].ranks[rank].upgrades`
  — don't hand-transcribe a cost table here.
- `maxRankForRarity(rarity) = min(3 × (rarity + 1), 19)` — **derived**, not
  published: Common tops out at Iron I, Uncommon at Bronze I, etc. Matches the
  in-game "MAX. RANK: I" badge shown for those two rarities.
- `levelToCompleteRank(rank)` — the character level needed to apply a rank's
  *last* upgrade (its second row is level-gated per upgrade; the table records
  the highest threshold, i.e. the level that lets you leave the rank). This
  table is transcribed from the wiki (no machine-readable source models it) and
  is undefined for Diamond III and the Mythic ranks, which postdate the table —
  treated as ungated rather than guessed at. See `plan.ts` for the exact values
  and the cross-checks that support them.
- **Order independence**: applying rank upgrades before vs. after a
  promotion/ascension yields the *same* final stats, because both ultimately
  modify base stats and the multiplier applies to the sum. Verified with a
  worked Vindicta example on the wiki and matching `computeUnitStats`'s
  behavior of scaling `base`, then adding upgrades as a flat term.

## Stars (Promotion) — the base-stat multiplier

- **Each star is +10% to base Health, Armour, and Damage.**
  `STAR_BASE_STAT_BONUS = 0.1` in `stats.ts`; `starMultiplier = 1 + 0.1 ×
  cumulativeStars`. The game **truncates** (floors), never rounds:
  `floor(base × multiplier) + rankUpgrades + equipment`. Rank upgrades and
  equipment are added *after* scaling, not before — scaling the sum gives a
  visibly wrong (too high) number. Three character-screen values confirm this
  exactly; see the repo README's "Derived stats" section for the worked
  examples (Gulgortz, Haarken, Tigurius).
- **Cumulative star count vs. displayed star count are different numbers.**
  `starLevel` (cumulative, drives the multiplier) runs ahead of
  `tierStarLevel` (what the character screen shows, counted within the current
  rarity) because an ascension does not itself add a star. Verified case:
  progression index 9 displays 1 star (tier) while the cumulative count used
  by the multiplier is 6; index 11 displays 3 but the multiplier uses 8.
  `computeTierStarLevel()` in `stats.ts` implements the display-side count.
- Max is **14 cumulative stars at Mythic** (11 at Legendary's "Blue Star" tier,
  the gate that must be crossed before Mythic ascension is possible, +3 more
  through the Mythic band).
- Shard/orb cost **per star level** is in `db.progressionRequirements` — do not
  hand-copy a cost table; two specific values (star 1, and the Uncommon
  ascension at star 3) are corrected in `src/gamedata/corrections.ts` from the
  game's own UI screenshots, because Codex's source table reports 0 or omits
  them entirely.

## Rarity (Ascension) — the ability-value multiplier

- **Ascension raises Active/Passive ability *base values*, not unit stats** —
  the two multipliers are strictly separate: stars never move an ability, and
  rarity never moves Health/Damage/Armour.
- **The bonus is linear (flat +20% of the ability's level-1 base per tier),
  not compounding — this resolves an ambiguity the wiki itself flags.** The
  wiki's prose ("the first ascension grants a full 20%... the final jump only
  yields 12.5%") reads as if it could be compounding, but two independent,
  harder sources say otherwise:
  - `src/gamedata/combat.ts`: `ABILITY_RARITY_BONUS = 0.2`,
    `bonus = 1 + 0.2 × rarity`, applied only to the variables an ability itself
    flags via `variablesAffectedByRarityBonus`. Confirmed against a real
    character screen: Vindicta's Fire of Absolution at ability level 11 reads
    64 in the table; she's Uncommon (rarity 1), `64 × 1.2 = 76.8`, displayed as
    77 (the game **rounds** ability values, unlike the truncation used for
    stats).
  - tacticustable.com's own client code carries the identical table as an
    explicit multiplier, not a compounding formula:

    | Rarity | Multiplier | Ability level cap |
    |---|---|---|
    | Common | ×1.0 | 8 |
    | Uncommon | ×1.2 | 17 |
    | Rare | ×1.4 | 26 |
    | Epic | ×1.6 | 35 |
    | Legendary | ×1.8 | 50 |
    | Mythic | ×2.0 | 60 |

  Treat the wiki's "12.5% final jump" phrasing as an editor's (slightly
  misleading) way of describing the *relative* size of a fixed +20%-of-base
  step against an already-inflated total, not a different formula — a flat
  `+0.2 × rarity` produces exactly that relative shrinkage as a side effect.
- Rarity also gates the equipment you can use (own rarity or lower only) and,
  via `db.rarityCaps`, the character level ceiling.

## Machines of War — a different, additive ability formula

MoW abilities do **not** use the rarity-multiplier table above. Recovered from
tacticustable.com's client code:

```
multiplier = 1 + 0.05 × rarityTier + 0.05 × starTier + (starTier === 11 ? 0.05 : 0)
```

i.e. **+5% per rarity tier and +5% per star tier**, both additive, with an
**extra flat +5%** specifically at star-progression index 11 — the first
"Blue Star" (first Legendary star-tier) breakpoint, mirroring the
character-side "Blue Star" gate before Mythic. A Common, 0-star MoW reaches
roughly **+80%** stronger abilities by white-star Legendary per the wiki's
independent estimate, consistent with this formula. MoW ability leveling uses
**Components + Badges**, not XP — there is no MoW experience system.
Mythic-tier MoWs additionally gain one passive **Mythic Ability** that
typically buffs Mythic-rarity characters.

## Mythic rarity (introduced Patch 1.31, August 2025)

- **Ascension-only** — no unit is ever released natively at Mythic; a
  Legendary unit must reach **11 stars ("Blue Star")** first, then ascend using
  Mythic Shards + Mythic Orbs (a currency pair separate from regular
  shards/orbs — the player API tracks them as `Unit.mythicShards` distinctly
  from `Unit.shards`, hence `ShardType: 'regular' | 'mythic'` in
  `types.ts`/`corrections.ts`).
- Adds 3 upgrade ranks (Adamantine I–III) and (per the wiki, patch-dependent)
  further ability levels beyond the pre-Mythic cap.
- The Mythic curve is **shallower/more linear** than the Legendary curve: cited
  comparison is Adamantine III ≈ 1.5× a Diamond III unit's stats, where Diamond
  III is itself ≈ 2.5× a Gold III unit's stats — i.e. diminishing relative
  growth at the very top, not runaway scaling.
- On ascending to Mythic, **one equipment slot converts to a Relic slot**; see
  `equipment-forge-and-items.md`.
- Ability-upgrade Coin costs were reduced as part of the Mythic rollout
  (reaching ability level 50 dropped from 250,000 to 125,000 Coins, with
  existing players refunded the difference) — a reminder that ability-cost
  figures are patch-dated; use `db.abilityUpgradeCosts` for the current live
  numbers rather than a transcribed total.

## Ability leveling — the gate, not just the cost

- **Ability level can never exceed the character's XP level**, and XP level is
  itself capped by rarity — so ability level is transitively gated by rarity,
  which is exactly why `resolvePlan()` in `plan.ts` pulls the character level
  (and, transitively, rarity) up whenever an ability-level target is set.
- Both Active and Passive level up on the same Coins + alliance-matched Badge
  cost curve, in `db.abilityUpgradeCosts` — a row is the cost of *leaving*
  that level, not of reaching the next one (`planCosts()` in `requirements.ts`
  gets this right: the level-14-to-15 cost sits at the row for level 14, not
  15).
- **Passive Ability unlocks at Uncommon rarity or higher**; **Active is
  available from Common**. Every *character* has exactly one of each — but
  **not every Machine of War does**: 11 MoW units (e.g. Galatian,
  `ultraDreadnought`) have no `passiveAbilityId` in `db.units`, and
  `unitCombat()` already treats the field as optional. Don't assume
  `db.units[id]` has both slots filled without checking.
