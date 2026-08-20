# Shelved: hex diagrams of a unit's attacks

**Status: not built, deliberately.** Investigated August 2026 against `gameInfo`
1.41.101.1. This records what was found so the question does not have to be
reopened from cold.

## The idea

Draw each attack on a hex grid — the unit on one cell, damage annotated on the
cells it reaches — so that area, adjacency, range, lines and splash read
visually instead of as prose. Ability shapes would come from parsing the English
description into a structured grid, at build time.

## What the data actually carries

`gameInfo` has 90 distinct keys across every ability's `constants`. Searching
them for anything shape-bearing — area, radius, shape, cone, line, adjacent,
pattern, direction — returns exactly two: `nrOfTargets` and
`maxAdjacentTargets`. Both are counts. Neither says *where*.

Of the 196 abilities that deal damage:

| | count |
| --- | --- |
| deal damage | 196 |
| …with a structured `range` | 106 |
| …with **any** target-count field | **7** |

`attackRangeType` looks promising and is not. It has four values — `Ranged` 85,
`Melee` 71, `Normal` 10, and `null` for the remaining 406 — and it describes how
the *first* target is reached, not the footprint. Swooping Hawk is tagged
`Melee` yet hits two hexes behind the target; Blade of Magnus is `Melee` yet
splashes to everything adjacent to the target. It is also applied
inconsistently: 47 abilities are `null` while still carrying a `damageProfile`
and dealing damage, including riders that are conceptually the same as the ten
tagged `Normal`.

So the shape exists only in prose. Bucketing the 196 damaging descriptions by
phrasing:

```
all adjacent to me   69      conditional on state   62
target + adjacent    31      rider on normal attack 33
all enemies          27      summons                21
behind the target    10      within N hexes          5
straight line         6      wave / cone             3

matched more than one bucket   77
matched no bucket              49
```

## Why it was shelved

Not the parsing. An LLM pass at **build time** — parse once, commit the JSON,
ship it static — is cheap, needs no key in the browser, costs nothing per view,
is deterministic, and produces only 196 rows, few enough to review by hand and
to diff on each patch.

The problem is that most of these are not static shapes at all. They are rules
over battlefield state:

> "…that target **or** an enemy unit adjacent to **both** the target and the Hive Tyrant"
>
> "Charges in one of 6 directions and keeps moving in a straight line **until he
> hits an obstacle or a Big Target**"
>
> "Whenever an enemy adjacent to Exitor-Rho is attacked by **another friendly
> Mechanical unit**…"
>
> "Adds +1 hit **for each** attack with Psychic Damage that…"

For those there is no single correct grid to draw — the footprint differs every
battle. Rendering them faithfully needs unit positions, obstacles, faction and
trait checks, and turn order. That is the game engine, not a diagram.

Summons are the sharpest case: the summoned unit has its own stats, range and
turn, and the summoner still acts.

## What would be feasible, if revisited

A **closed shape vocabulary** over the clean subset — single target, target plus
adjacent, all adjacent to self, within N hexes, N hexes behind. Roughly 50–70 of
the 196 land there, and they are the ones whose one-line description already
says what you need.

The normal attacks need no parsing at all: melee is the six adjacent hexes,
ranged is everything within `rangeWeapon.range`, and per Combat Basics a ranged
attack is disabled while an enemy is adjacent. Correct and free — but a diagram
that restates the head line in more pixels.

### The rule to keep if it is ever built

Parse into that closed vocabulary with an explicit *did not parse* outcome.
Render only what parsed; leave everything else as prose. **A grid showing the
wrong hexes is worse than no grid** — the reader cannot tell it is wrong,
whereas prose they can read for themselves.

## The cheap alternative, also not built

`range` is structured on both weapons and 106 abilities, so a small reach
indicator per attack is derivable with no parsing. Much less than a hex grid,
but honest. Offered and not taken up; still available.

## Reproducing the counts

Everything above comes from `gameInfo.json`, which the loader caches — see
`src/gamedata/loader.ts`. The fields are mapped in `src/gamedata/sources/gameinfo.ts`;
`abilities[].constants` and `.variables` are open maps, so their keys are not in
the type and have to be counted from the raw file.
