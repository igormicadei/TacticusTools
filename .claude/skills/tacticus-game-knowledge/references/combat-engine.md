# Combat engine — damage, armour, crits, block, shields

Sources: tacticus.wiki.gg `HDTW_Damage`, `Damage_Types_and_Pierce_Ratio`,
`Combat_Basics`, `HDTW_DmgBuff`, `HDTW_DamCap`, `HDTW_DamPen`, `HDTW_Overkill`,
`HDTW_AddHits`, `HDTW_NormAtt`, `HDTW_HeavyWeapon`, `HDTW_CantCrit`,
`HDTW_Shields`, `HDTW_BlockMod`, `HDTW_DmgPreview`. Full citation list in
`sources-and-caveats.md`. There is **no "miss" mechanic** in Tacticus — every
attack that can be made connects, subject only to armour/pierce/block.

## The full damage formula

```
DamVar = [Damage × (1 ± up to 0.20)] ± Pre-Armour Modifiers
DamagePerHit = MAX[ (DamVar − Armour), (DamVar × PierceRatio) ] × Post-Armour Modifiers
Total = DamagePerHit × Hits
```

Build-up, in the order the game actually applies it:

1. **Base**: `Damage × Hits`.
2. **Variance**: every **Normal Attack** (not most abilities, which usually
   state their own range instead) rolls **±20%** on `Damage`, before anything
   else. `src/gamedata/combat.ts`'s `DAMAGE_VARIANCE = 0.2` and `band()` already
   implement this; `total`/`effective`/`perHit` on an `AttackProfile` are the
   low/mid/high band.
3. **Pre-armour modifiers** (flat, e.g. Calgar's Rites of Battle "+X Damage",
   Sibyll Devine's Nightshroud "−X"): applied next, to `DamVar`.
4. **Armour**: reduces damage **one-for-one per hit**.
5. **Pierce ratio floor**: no matter how high Armour is, a hit never deals less
   than `DamVar × PierceRatio`. This is `pierceRatio` / `armourFloorAt` in
   `combat.ts`. Worked example: 100 damage, 40% pierce, 75 armour → naive
   `100 − 75 = 25`, but the floor is `100 × 0.4 = 40`, so **40 is dealt**.
6. **Post-armour modifiers** (multiplicative, applied last — High Ground +50%,
   Trenches −50%, Razor Wire +50%, Heavy Weapon +25%, Terminator Armour's
   first-hit −75%): these multiply the *already-pierce-floored* per-hit value,
   so they also multiply through any Crit Damage bonus baked into step 2.

**Damage type / pierce ratio table** — this is the game's own per-weapon
figure, not a damage-type generalization; `db.pierceByDamageProfile` in the
repo is derived directly from the roster and cross-checked against this table
(all 20 agree, plus Direct which no hero weapon carries):

| Damage Type | Pierce | Damage Type | Pierce |
|---|---|---|---|
| Physical | 1% (worst) | Piercing | 80% |
| Las | 10% (+50% vs. Emplacement/Heavy Weapon targets) | Plasma | 65% |
| Blast | 15% (ignores Swarm, 2-Man Team) | Melta | 75% (+50% dmg vs. Vehicles) |
| Projectile | 15% | Toxic | 70% (25% chance to apply Contamination) |
| Bolter | 20% | Molecular | 60% |
| Chain | 20% | Eviscerating | 50% |
| Pulse | 20% | Power | 40% |
| Flame | 25% (ignites the hex) | Particle | 35% |
| Bio | 30% | Heavy Round | 55% |
| Energy | 30% | Direct | 100% (ignores armour; "true damage") |
| — | — | Psychic | 100% (ignores armour; **cannot be Blocked**; rare as a base weapon stat) |

## Crits

- Crit Chance is rolled **per hit**, starting with hit 1; a success lets the
  next hit roll too. The chain (`critChain` in `combat.ts`) **stops at the
  first failed roll and does not resume** — so crit chance is worth far more on
  a 1-hit weapon than a 4-hit one (`chance^n` for `n` hits in a row).
  **Act of Faith** is the one documented exception: it boosts Crit
  Chance/Damage for the whole *Attack*, not per hit.
  Additional hits appended to an attack extend the *same* crit chain (so they
  need every prior hit to have crit too); a genuinely separate triggered attack
  (e.g. a bounce) starts its own independent chain.
- On a crit, `Damage` in the formula above is replaced by `Damage + Crit
  Damage` **before** variance/armour/pierce — so Crit Damage also raises the
  pierce floor, since the floor scales off the (now-boosted) damage.
- As of the wiki's last check, no ability grants a *second* independent Crit
  Chance roll on the same hit.

## Block and multiple block sources

- Block works exactly like the crit chain, but on the defender: roll on hit 1,
  keep rolling on success, stop on first failure. **Blocks can reduce a hit's
  damage all the way to 0** — unlike most damage penalties, which floor at 1.
- **Multiple block sources** (e.g. an equipped Block item *and* an
  ability-granted Block): the chain rolls against the **highest** Block Damage
  source until it fails, then immediately rolls the **next** source *on that
  same hit* — it does not skip to the next hit.
- **Block Boosters and passive Block-Chance/Damage bonuses only buff
  equipment-sourced Block** — they do not buff Blocks granted purely by an
  ability, with one documented cross-source exception (Azrael's/Arjac's bonus
  Block Damage does affect Varro Tigurius's ability-granted Block — an
  ability-to-ability interaction). You cannot equip a Block Booster without an
  equipped Block item; removing the base item disables the Booster too.

## Shields

Shields (Thaumachus/Wrask passives, some Tournament Arena power-ups) are a
separate HP pool with distinct rules, not just "extra health":

- **0 Armour** — nothing reduces damage while hitting the shield.
- **No terrain modifier** applies to shield damage: no High Ground, Razor
  Wire, or Trenches bonus/penalty.
- Hit-count changes (Camouflage, Tall Grass, bonus hits) still apply normally.
- A **damage cap** on a bonus hit is **ignored** against a shield — the hit
  lands at full uncapped value.
- Damage-reduction traits/abilities (Jain Zar, Certus, Terrifying,
  Terminator Armour's first-hit reduction) do **not** reduce shield damage —
  but do apply once to the "breakthrough" damage after the shield pops.
- Block still rolls visually and still needs to succeed to chain into
  subsequent hits, but does **not** reduce shield damage.
- Damage-**stat** buffs and Crits **do** increase shield damage (they modify
  the base value before the shield is even considered). Pre-armour "damage
  dealt" percentage buffs (Psychic Stalk-style) and post-armour percentage
  modifiers (Heavy Weapon) do **not** increase shield damage. Max-damage
  effects do apply.
- **Breakthrough**: once the shield's HP is exhausted, the remainder of that
  hit is recalculated as if it were a fresh attack against the real target —
  variance is not re-rolled, but terrain/elevation modifiers that were ignored
  against the shield now apply.
- **Overkill ignores shield damage entirely** — only breakthrough damage
  against actual Health counts toward the 2× threshold.

## Overkill

- Triggers on **either**: the killing hit is a **Crit**, or the whole attack's
  total damage (summed across every hit) is **more than double** the target's
  remaining Health at the start of that attack. Evaluated across the entire
  multi-hit attack, not hit-by-hit — hits landing after the target is already
  dead mid-attack still count toward the total.
- A crit **earlier** in the chain that "bleeds into" a non-crit fatal hit does
  not itself count as the trigger — the actual fatal hit must be the crit.
- Only abilities/traits that **explicitly** claim overkill-immunity are safe
  from it (Final Vengeance, Resilient, Necron Reanimation Protocols).
  **Always Overkilled** is a separate forced-overkill effect that overrides
  even those.
- **Resilient**: *"Any time this unit takes lethal Damage and is not already at
  1 Health it goes down to 1 Health instead of dying, except if Overkilled."*
  This triggers **once per whole attack** — the instant one hit would apply
  non-overkilling lethal damage, the unit drops to 1 HP and every *remaining*
  hit of that same attack is voided (otherwise the next hit would trivially
  overkill the now-1-HP unit).

## Damage caps, buffs, and penalties — where in the formula each applies

Caps can sit at three different points, and **where** decides what it
interacts with — this is the single most common source of "why didn't that
bonus apply" confusion:

- **Cap on the base Damage value** (before modifiers): the capped attack still
  fully benefits from bonuses/crits/pre-armour modifiers layered on afterward.
- **Pre-armour cap** (on a bonus specifically, applied after other pre-armour
  modifiers): only the bonus itself is capped; other contributing buffs aren't.
- **Cap on "the hit" as the very last step**: benefits fully from pre-armour
  modifiers (helps penetrate armour) but any post-armour modifier is then
  itself subject to the cap. Multiple caps apply in formula order — an early
  cap can wash out a large bonus stacked on afterward. Only one hard number is
  published (Vitruvius's Master Annihilator bonus hit caps at 135 damage);
  others are known to exist but undocumented numerically.

**Buffs** — "Gain +X Damage" vs. "Deal +X Damage" are not the same thing:

- **"Gain +X Damage"** raises the Damage **stat**, so it only helps Normal
  Attacks and abilities that explicitly ride on that stat (labeled
  normal-attack abilities).
- **"Deal +X Damage"** applies more broadly — Normal Attacks *and* Ability
  Attacks that carry their own separate damage value.
- **"Ignores attacker modifiers, cannot Crit"** abilities (nicknamed "Can't
  Crit" / IAMACC on the wiki) benefit from **neither** — and this is also the
  one rule with **zero exceptions**: no trait, ability, or effect can ever
  change such an ability's Hit count. Everything else about what raises or
  lowers a Can't-Crit ability's damage is empirical/case-by-case (armour and
  Block still apply normally; a short, wiki-tested allow/deny list exists if a
  specific interaction needs checking — see `sources-and-caveats.md`).

**Penalties** — two sub-types with different formula placement:

- **Damage-stat penalty** (reduces the visible Damage stat): pre-armour, does
  **not** affect ability damage (abilities use their own stated values).
- **"Damage dealt" penalty** (a flat pre-armour reduction that isn't shown on
  the stat, e.g. Camo Cloak, Nightshroud): pre-armour, but **does** affect
  ability damage too. The only way to tell the two apart in practice is
  whether the unit's displayed Damage stat itself changed.
- **Negative multipliers** (Suppressed, Stunned, Terminator Armour, Trenches,
  most Guild Raid boss debuffs) are **post-armour**.

## Extra hits, Heavy Weapon, Mk X Gravis

- **Added Hits** carry their own stated damage/type, independent of the
  triggering attack. **Extra Hits** ("X+1") inherit the triggering attack's
  full profile. Both: don't count as a separate attack for frequency-tracking
  effects, append to the **end** of the triggering attack's crit chain (so all
  prior hits must crit first), and are still subject to damage caps.
- **Heavy Weapon** trait: **+25% Ranged Damage** to normal attacks and
  ranged-tagged abilities, if the unit **did not move this turn**. Forced
  movement (push/pull) does not disqualify it — only voluntary movement does.
  Applies as a **post-armour** multiplier, so it also multiplies an
  already-applied Crit Damage bonus.
- **Mk X Gravis** trait: incoming damage passes through Armour **twice**. The
  second pass recomputes the pierce floor against the *result* of the first
  pass, not the original damage — confirmed weaker than the naive
  reading (200 dmg / 40% pierce / 100 armour: pass 1 gives 100, pass 2 gives
  `max(100−100, 100×0.4)=40`, not `max(200−200,200×0.4)=80`). **Does not apply
  on a Crit hit at all.**

## Damage preview UI (for cross-checking a displayed number)

The in-battle preview shows `[(Damage + Buffs − Armour − Debuffs) × Modifiers]
× Hits` and does **not** factor in Crit chance in the headline number — but the
health-bar color coding (yellow = guaranteed, light red = potential/blockable,
dark red = remaining) does account for Block chance. A solid skull icon means
guaranteed kill; a cracked skull means guaranteed Overkill.
