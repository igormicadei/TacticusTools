# Sources and known caveats

This skill was built by crawling the community wiki and mining a community
tool's client code, then cross-referencing both against this repo's own
`src/gamedata` (which is itself independently verified against real character
screens — see the root `README.md`). Treat the three in that order of
authority for anything unit/item/ability-specific: `GameDatabase` first, wiki
prose second, mined client-code formulas third (real but unofficial, since
they're a fan tool's interpretation, not the game's own published word).

## Primary sources

- **tacticus.wiki.gg** — the current community wiki. The community migrated
  here from Fandom around **June 2025**; Fandom is no longer updated, and this
  session's network could not reach `*.fandom.com` at all (blocked at the
  proxy level) — every citation in this skill that might elsewhere be
  attributed to "the Tacticus Fandom wiki" was actually read from wiki.gg,
  which explicitly describes itself as adapting pre-June-2025 Fandom content.
  Page slugs are identical between the two, e.g. `/wiki/Unit_Progression`,
  `/wiki/Gameplay_Mechanics`.
  - Two independent crawls were run against wiki.gg (one via a general web
    crawl of the `Gameplay_Mechanics` hub and its links, one via raw
    MediaWiki `action=raw` pulls plus the `How_Does_That_Work` (HDTW) article
    index) — together they covered ~100 distinct pages. Where they returned
    the same fact independently (e.g. the damage formula, the ±20% variance,
    the star bonus), that is a real cross-check, not a single source repeated.
  - Wiki content is dual-licensed CC BY-SA 4.0 per the site footer; the
    material here is close paraphrase for internal reference use, not verbatim
    reproduction of large tables.
- **tacticustable.com** — a community data-browser/planner built directly on
  the game's own published config (the same `gameInfo.json` this repo fetches).
  Its formulas were recovered by downloading and reading its single minified
  JS bundle (a Create-React-App build ships one file, which made this
  possible) — these are real client-side game-logic computations, not
  documentation, so they carry the same caveat as any reverse-engineered code:
  correct as observed, not officially confirmed by the developer.
- **tacticusdb.com** — investigated but **not** a useful source for mechanics.
  It's a Next.js app that code-splits per route, so its actual
  characters/bosses/items content only loads client-side at runtime and
  could not be recovered by static fetching. Its only reachable prose is an
  `/about` disclaimer page (unofficial fan project, no public API). Nothing
  here is sourced from it beyond that.
- **This repo's own `README.md` and `src/gamedata/*.ts`** — several formulas
  (damage variance, pierce-ratio derivation, star multiplier, ability rarity
  bonus) were independently verified there against real character-screen
  screenshots, which is a stronger check than a wiki citation alone. Where a
  wiki claim and the repo's own verified formula agreed, that's noted in the
  relevant reference file; the one place they meaningfully diverge (crit/block
  chance stacking) is called out in `equipment-forge-and-items.md`.

## Known gaps, ambiguities, and unresolved contradictions

Don't cite these as settled facts without re-verifying against the live game
or wiki:

1. **Power Level cap and its history** (`Power_Score`, `HDTW_Mythic`): cited as
   raised from 70 to 100 with the Mythic patch (v1.31, Aug 2025) — plausible,
   consistent across two pages, but the wiki's own pattern is frequent
   increases, so treat 100 as dated rather than current.
2. **Mythic XP level cap**: sources disagree between 60 and 65 across
   different pages/patches (55 → 60 → reportedly 65 over time). Don't assert a
   specific number without checking `db.rarityCaps`/live game state first —
   and note the game's published config may not even carry a Mythic level cap
   at all (none is emitted by this repo's normalizer, since no source
   currently publishes one).
3. **Ascension "compounding" language**: `HDTW_Progression`'s prose is
   ambiguous on its own ("the final jump only yields 12.5%"). This skill
   resolves it as **linear, not compounding** based on two independent harder
   sources (this repo's `combat.ts`, confirmed against a real character
   screen; tacticustable.com's own explicit multiplier table) — see
   `progression-and-abilities.md` for the full reasoning. If a future wiki
   edit states the formula more precisely and it disagrees, trust the two
   code-level sources over new wiki prose unless that prose cites its own
   testing.
4. **Ability-upgrade coin cost figures show a possible timeline mismatch**:
   one page states the 1→50 ability level total is 698,725 Coins; another
   states the Mythic-rework reduced the level-50 cost from 250,000 to 125,000
   Coins. These read like a cumulative-total vs. marginal-step mismatch across
   different points in time rather than a real contradiction, but the wiki
   never reconciles them explicitly. Prefer `db.abilityUpgradeCosts` for a
   live, exact answer over either transcribed figure.
5. **Status effect index page has no per-effect rules text.** `/wiki/Effects`
   only returns effect names plus a Heal/Repair-removability flag — most of
   the ~20+ named ability-specific effects (Markerlight, Master Annihilator,
   Neuroparasite, Concealed, Elated, Thrilled, Copy, Supercharge, Watched, The
   Betrayer, ...) have no generic numeric text captured here. Where an effect's
   numbers were needed, they were recovered indirectly (e.g. Suppressed's
   exact numbers came from the **Suppressive Fire** trait's own description,
   not the Effects index). For any of the uncaptured ones, resolve the
   specific granting ability via `db.abilities`/`resolveAbility()` rather than
   assuming a generic definition exists.
6. **Damage cap numbers are almost entirely character-specific and
   unpublished.** Only one hard number exists wiki-wide (Vitruvius's Master
   Annihilator bonus hit, capped at 135 damage); several other capped
   abilities are named without a published cap value.
7. **Factions page arithmetic**: one wiki page's own header count of Imperial
   factions didn't match its list of named factions by one — treat any
   specific faction *count* as needing a recount against `db.units` rather
   than trusting a transcribed total, since faction rosters also grow with new
   releases.
8. **Arena league rank-up/rank-down thresholds** returned inconsistent-looking
   numbers across one crawl (a repeated value across two adjacent leagues) —
   treat exact Arena promotion/demotion cutoffs as lower-confidence than
   everything else in `game-modes.md`; re-verify directly against the wiki's
   `Arena` page if a task depends on the precise cutoff.
9. **Tournament Arena's on-death timing** (whether a defeat point is scored
   before or after an on-death trigger resolves) was reported inconsistently
   by players and was never confirmed on the wiki after the report — treat TA
   specifically as an open question, distinct from the otherwise-confirmed
   general on-death resolution order in `traits-and-status-effects.md`.
10. **The full `Special:AllPages` index was not exhaustively crawled** (it
    runs into the thousands of entries, dominated by per-unit/per-item/per-song
    pages). Character-specific HDTW deep-dives (single-unit ability
    interactions) were deliberately skipped as out of scope for a mechanics
    skill — if a task needs a *specific* unit's documented edge-case
    interaction, search `tacticus.wiki.gg/wiki/HDTW_<Something>` directly
    rather than assuming this skill's reference files are exhaustive at the
    per-unit level.

## What was deliberately excluded

Per-unit stats, per-unit ability text, and per-item stat tables are **not**
duplicated anywhere in this skill's reference files, even where the wiki
listed them — that data is already in `GameDatabase` from the game's own
config, is more current there, and would only drift out of sync if copied
here. The one exception is the small number of illustrative example values
(e.g. a single item's stats used to demonstrate the forging cost curve's
shape) kept explicitly as "illustrative, not exhaustive."
