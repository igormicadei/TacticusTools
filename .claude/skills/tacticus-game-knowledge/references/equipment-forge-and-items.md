# Equipment, forging, and crafting

Sources: tacticus.wiki.gg `Equipment`, `HDTW_Forge`, `HDTW_EqCap`,
`HDTW_BlockMod`, `Relics`; stat-stacking and boss-debuff formulas mined from
tacticustable.com's client bundle. Cross-referenced against
`src/gamedata/stats.ts` and `types.ts`.

**Per-item exact numbers are in the database, not here.** `db.items[id]` has
every item's rarity, per-level stats, and forging cost
(`ItemLevel.dustCost`/`goldCost`/`mythicDustCost`) straight from the game's own
config — look an item up rather than trusting the illustrative rarity-tier
tables below, which describe the general shape of the cost curve, not any one
item's exact numbers.

## Slots and categories

- **3 equipment slots** per unit: **Crit** item, **Defense** item, **Booster**.
  Defense subdivides into **Block** items (Block Chance/Damage) and
  **Defensive** items (Armour and/or flat Health). Boosters subdivide into
  Block Boosters and Crit Boosters.
- Each unit has a **fixed** subcategory per slot (you can't choose Block vs.
  Defensive freely for a given unit's Defense slot) — check `db.units[id]
  .itemSlots` for what a specific unit can equip.
- **Only Rare+ rarity units can equip a Booster at all.**
- A unit can equip gear of its own rarity **or lower**, never higher.
- Equipment rarity ladder: Common → Uncommon → Rare → Epic → Legendary →
  Mythic → Relics.
- **Equipment stat bonuses are flat and do not scale** with the wearer's rank
  or stars — only Health and fixed Armour appear on equipment (nothing grants
  Damage), and the game folds both directly into the headline stat rather than
  listing them separately. `computeUnitStats()` implements this correctly:
  equipment is added *after* the star multiplier, not before.

## Crit Chance / Block Chance stacking is diminishing-returns, not additive

`computeItemBonuses()` in `src/gamedata/stats.ts` implements this correctly:
Crit/Block Chance from gear stack via diminishing returns, everything else
(health, damage, armour, flat Crit/Block *Damage*) sums flatly, and `*Bonus`
booster stats only apply once their base stat is already present — folded in
slot order (`Slot1`/`Slot2`/`Slot3`) to match the game's own sequencing. Worth
knowing the exact formula anyway, since it explains why a displayed total
isn't a simple sum of the equipped items' tooltip values.

Recovered directly from tacticustable.com's client code (a function that folds
each equipped item's stat block onto a running total, applied per slot in
sequence — so slot order matters for the convergence math):

```
new = old + (100 − old) × add / 100        // critChance and blockChance ONLY
new = old + add                            // every other stat (hp, dmg, armour, etc.)
```

Each successive point of Crit/Block Chance from gear **converges toward 100%**
rather than adding linearly — the same shape as compounding independent-chance
events. Worked example: 20% base crit + a 30%-crit item → `20 + (100−20)×30/100
= 20 + 24 = 44%`, **not 50%**.

`*Bonus` fields (`critChanceBonus`, `blockChanceBonus`, `critDmgBonus`,
`blockDmgBonus` — booster stats) are a third rule: they only apply **if the
corresponding base stat is already non-zero** on the unit. A Crit Booster does
nothing for a unit with no crit-chance source from its weapon/other gear in
the first place — consistent with "you can't equip a Booster without the
matching base item" below.

## Block Boosters — the narrower rule from `combat-engine.md`

Block Boosters and passive Block-Chance/Damage bonuses only affect
**equipment-sourced** Block, not Block granted purely by an ability (with a
documented ability-to-ability exception — see `combat-engine.md`). You cannot
equip a Block Booster without first equipping a Block item; unequipping the
base item disables the Booster too.

## Rarity caps scale equipment *down*, except Booster percentages

When a game mode or a unit's own rarity caps a character below the equipment's
own rarity (Tournament Arena, Guild War lineup caps, Incursion tiers), the
**equipment's effect scales down to the level cap of the character's effective
rarity** — the item's actual level is irrelevant once capped:

| Effective rarity cap | Equipment acts as |
|---|---|
| Common | Common level 3 |
| Uncommon | Uncommon level 5 |
| Rare | Rare level 7 |
| Epic | Epic level 9 |
| Legendary | Legendary level 11 |

**Exception**: Crit Chance / Block Chance **percentage** bonuses from Boosters
do **not** scale down — a Legendary booster keeps its full percentage value
even when the wearer is capped down to Rare or Epic. A unit capped at Common or
Uncommon gets **no Booster benefit at all**, since Boosters require Rare+ to
equip in the first place. Practical upshot the wiki states directly: under a
rarity cap, always equip the *highest-rarity* item you have regardless of its
level — it scales down but never below the cap's own floor.

## Mythic binding and Relics

- **Mythic equipment binds permanently** to the character on equip; moving it
  requires either a higher-level Mythic item, a Relic, or paying an unbinding
  cost (1 Mythic Forge Badge + 100 Mythic Salvage). Mythic items forge only up
  to **level 10** — this breaks the level pattern every lower rarity follows.
- **Relics** are unlocked via the Mythic equipment-slot conversion (see
  `progression-and-abilities.md`): one of the unit's normal slots becomes a
  Relic slot. Relics mirror the normal category split (Crit/Block/Defense/
  Boosters) but carry bespoke effects beyond flat stats, are obtained via the
  Rogue Trader shop and character-specific Mythic Missions, and are
  **permanently bound** the moment they're equipped — never unbindable, unlike
  ordinary Mythic gear.

## Forging and crafting — the tier-conversion recipes

These recipes (badge-to-badge, orb-to-orb, forge-badge-to-forge-badge) are a
separate currency-tier-conversion system, distinct from `db.upgrades`'
material-crafting recipes, and are **not modeled anywhere in `GameDatabase`** —
there's no field for them, so this is the only place they're recorded. Costs
below are dated to a Jan 2026 wiki snapshot; re-verify before treating them as
exact for a balance-sensitive calculation, since a per-forge item requirement
was already reduced once (Aug 2025: badges needed 5→3, orbs 10→5).

**Ability Badge, one tier up** (1 Forge Badge of the target rarity + N of the
next rarity down + Coins):

| Target | Forge Badge | Lower badges needed | Coins |
|---|---|---|---|
| Uncommon | Uncommon | 3× Common | 1,000 |
| Rare | Rare | 3× Uncommon | 1,500 |
| Epic | Epic | 3× Rare | 3,000 |
| Legendary | Legendary | 3× Epic | 6,000 |
| Mythic | Mythic | 3× Legendary | 9,000 |

**Orb, one tier up** (Common has no orb tier; Uncommon orbs cannot be forged,
they're the floor):

| Target | Forge Badge | Lower orbs needed | Coins |
|---|---|---|---|
| Rare | Rare | 5× Uncommon | 1,500 |
| Epic | Epic | 5× Rare | 5,000 |
| Legendary | Legendary | 5× Epic | 20,000 |
| Mythic | Mythic | 5× Legendary | 35,000 |

**Forge Badge itself, one tier up** (uses Salvage, not a badge of any kind):

| Target | Lower Forge Badges needed | Salvage | Coins |
|---|---|---|---|
| Rare | 5× Uncommon | 5 | 500 |
| Epic | 5× Rare | 10 | 1,000 |
| Legendary | 5× Epic | 20 | 2,000 |
| Mythic | 5× Legendary | 30 | 3,000 |

**Item ascension** (after forging to max level for the current rarity): costs
Coins + Salvage + one Forge Badge of the target rarity, and offers a choice
between the *same* item at the next rarity or a second, randomly-chosen item
of the same equipment sub-type — no known pattern predicts which second item
is offered.

A practical corollary worth knowing when comparing options: "Epic equipment at
level 9 has stats very similar to Legendary equipment at level 4, for
substantially less Salvage/Coins" (wiki's own observation from the cost
curves).
