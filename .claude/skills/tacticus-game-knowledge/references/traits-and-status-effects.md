# Traits and status effects

Sources: tacticus.wiki.gg `Trait`, `Effects`, `HDTW_Heal`, `HDTW_OnDeath`,
`HDTW_Resilient`, `HDTW_LtGB`. Full citations in `sources-and-caveats.md`.

## Traits live in the database — don't hardcode them here

Every unit's traits and their exact in-game text are in
`db.traits[traitId]` (`name`, `description`, `hero`) — see
`gamedata-module.md`. That text is more current and more precise than a
hand-copied table would be (trait wording changes with balance patches), so
**look it up rather than trusting a cached list**. What follows here is the
cross-cutting mechanical *context* that a single trait's own description text
usually doesn't spell out, because it depends on how the trait interacts with
the combat engine or with other traits.

### Interactions worth knowing that aren't obvious from the trait text alone

- **Resilient** ("drops to 1 HP instead of dying, unless Overkilled") fires
  **once per whole attack**: the instant one hit would apply non-overkilling
  lethal damage, the unit drops to 1 HP and every *remaining* hit of that same
  attack is voided — otherwise the next hit would trivially overkill the now
  1-HP unit. See `combat-engine.md`'s Overkill section for the full mechanic.
- **Immune** (found on Guild Raid bosses/minibosses) blocks hex effects
  *and* prevents Armour/Hits/Movement/Range from being reduced *and* blocks
  Stun/Suppress/Taunt *and* blocks knockback damage — it is a broader shield
  against negative effects than its short description implies. This is why
  Ice's Crit Damage bonus, Contamination's armour reduction, etc. never affect
  a raid boss.
- **Swarm**: a multi-member unit takes 1 hit per living member (each incoming
  hit can only ever damage one member); healing restores members rather than a
  flat HP pool. Worked example: a 500 HP, 5-member swarm that's taken 300
  damage has 2 members (200 HP) left; healing 200 HP brings a member back,
  restoring it to 4 members (400 HP). Not affected by Blast damage.
- **Mk X Gravis**, **Heavy Weapon**, **Can't-Crit ("ignores attacker
  modifiers") abilities** — these are combat-formula interactions, documented
  in full in `combat-engine.md` rather than repeated here.
- **Let the Galaxy Burn** (Black Legion faction trait) is the reference example
  for "conditional bonus-hit" traits generally: its 33% chance for a bonus hit
  *and* to apply Despoiled Ground is **one single roll, not two independent
  ones** — either both happen or neither does. If the target already has a hex
  effect (hex effects don't stack), the bonus hit still triggers automatically
  but Despoiled Ground does not.
- **Overwatch**: a unit that hasn't attacked this turn auto-attacks the first
  enemy that moves into its range on the enemy's turn (skipping one with
  Infiltrate). An Overwatch attack **is** a Normal Attack — it can carry Heavy
  Weapon's bonus if the unit didn't move on its own last turn, and it counts
  for any effect gated on "Normal Attack."
- **Get Stuck In** (Orks): generated extra hits count toward its own trigger
  condition (based on current hit count including already-added hits), but its
  own generated hits do not recursively re-trigger themselves.

## Status effects that are battle state, not unit traits

These are not in `GameDatabase` at all — they're applied during a battle by
abilities/terrain rather than being a fixed property of a unit.

| Effect | Rule | Removed by Heal/Repair? |
|---|---|---|
| Stunned | Only 1 Movement, −50% Damage, cannot use Active Abilities | Yes |
| Suppressed | −30% Damage, −1 Movement, cannot fire Overwatch, lasts 2 rounds. Healing/Repairing removes the effect but does **not** retroactively re-enable Overwatch for that same turn | Yes |
| Taunted | Can only target the taunting unit; can't move away, use Active Ability, Heal, Repair, or target anyone else. Untargeted attacks (AoE etc.) may still hit others | Yes |
| Contamination, Fire, Ice, Despoiled Ground | See `battlefield-and-terrain.md` (hex effects) | No |
| Always Overkilled | Units defeated by this attack can't be revived and count as overkilled even if normally immune to it | — |

The wiki's `Effects` index also lists ~20 more per-ability-specific tags
(Markerlight, Master Annihilator, Neuroparasite, Concealed, Revealed, Elated,
Thrilled, Copy, Infiltrate, Supercharge, Watched, The Betrayer, ...) whose exact
numeric text is tied to the specific ability that grants them — check that
ability's own resolved description via `db.abilities` / `resolveAbility()`
rather than assuming a generic number, since these vary per source.

## Healing, Repair, Revive, Resurrect — four different things

The wiki uses this taxonomy, and it matters because the rules genuinely differ:

- **Heal** (`Healer` trait) works on non-Mechanical units only; **Repair**
  (`Mechanic` trait) works on Mechanical units only. Both are a special
  **Action**, not an attack — they restore `user's Damage stat × hits of their
  highest-hit Normal Attack`, with **no variance and no attack modifiers**
  (elevation, conditional bonuses) applied. A flat Damage-**stat** buff does
  increase the restored amount; a Hits-only buff does not (an interaction the
  wiki itself flags as possibly unintended).
- **Healing/Repairing abilities** usually keep the Mechanical/non-Mechanical
  split but use their own stated value, not Damage×Hits.
- **Abilities that set Health to a fixed value** (e.g. Abaddon's Drach'nyen)
  are explicitly **not** classified as healing even though Health goes up —
  they don't count for "Heal/Repair X Health"-style conditions.
- **Revive** interrupts death *before* the unit is counted as defeated: sets
  Health to an ability-specified value. A revived unit that hadn't acted yet
  can still act that turn. On-defeat triggers of the *attacker* (e.g.
  Head-Claimer-style effects) still fire even though the target survived —
  but the revived unit's *own* on-death effects, Tournament Arena points, and
  Battle-Fatigue-style triggers do **not** fire, since it was never actually
  defeated.
- **Resurrect** requires the unit to be **fully defeated first** — every normal
  on-death trigger fires as usual (unlike Revive) — and it's then brought back
  at an ability-specified Health value. Some resurrect sources have their own
  restrictions (only non-Overkilled targets; only a specific alliance; one
  variant explicitly works *even if* Overkilled) — check the specific
  ability's text rather than assuming resurrect always ignores Overkill.
- **"Cannot be Revived, Healed, Repaired, nor otherwise restore Health"**
  debuffs block not just the direct action but any *secondary* benefit that
  would normally accompany it (a passive that only triggers off a successful
  heal, for instance, is also blocked).

## On-death resolution order and simultaneous defeat

- **Key rule**: "on death" / "when defeated" / "loses its last health" triggers
  (Explodes, Putrid Explosion, Final Vengeance, revive-on-death effects) **all
  resolve and complete before the triggering unit is actually counted as
  defeated** for victory-condition purposes.
- This produces a specific, non-obvious outcome: if unit A's attack defeats
  unit B (B's team's last unit), and B has an Explodes-style trigger that then
  kills A (A's team's last unit), **B's team wins** — because B's own death
  resolves to completion (including its explosion) before B is finally counted
  as dead, so from the game's perspective B "died second." This can chain
  through multiple on-death triggers.
- An ability that prevents defeat outright (a revive-on-death effect) triggers
  *before* the unit is considered defeated, so the unit survives outright — no
  victory point is scored for "defeating" it and its own on-death effects never
  fire, because it was never defeated at all.
- **Open question, not resolved**: Tournament Arena specifically has had
  inconsistent player reports about whether a defeat point is awarded before
  or after an on-death effect resolves there — treat TA's exact behavior here
  as unconfirmed rather than matching the general rule above.
