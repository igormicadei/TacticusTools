/**
 * Values taken from the game's own UI where no data source publishes them.
 *
 * Everything here is evidence from an in-game screenshot rather than a fetched
 * source, so each entry records what it fixes and stays isolated from the
 * normalizer. Rows populated from this table are marked
 * `shardsSource: 'gameUi'`, and an entry should be deleted the moment a source
 * starts publishing the value.
 *
 * Evidence: the Character Progression panel for a base-Common character shows
 * `10 shards -> 1 star`, `15 shards -> 2 stars`, `15 shards + 10 orbs ->
 * ascend to Uncommon`, `15 shards -> 3 stars`. Codex's `unitlevel` agrees on
 * the second and fourth of those, reports `0` for the first, and omits the
 * ascension row entirely.
 *
 * Both corrections assume the promotion table is global rather than per
 * character, which is what a single 20-row source table implies.
 */
export interface ProgressionShardCorrection {
  progressionIndex: number;
  shards: number;
  /** Why the source value is being overridden or filled in. */
  reason: string;
}

export const PROGRESSION_SHARD_CORRECTIONS: readonly ProgressionShardCorrection[] = [
  {
    progressionIndex: 1,
    shards: 10,
    reason: "Codex unitlevel reports 0; the game's progression panel shows 10 shards for the first star",
  },
  {
    progressionIndex: 3,
    shards: 15,
    reason: 'Codex unitlevel omits this index; the ascension to Uncommon costs 15 shards alongside its 10 orbs',
  },
];

/**
 * Shards to unlock a not-yet-owned character — added to the roster at
 * Common, 0 stars (`progressionIndex` 0), before any of the table above
 * applies.
 *
 * Neither of this repo's two sources publishes this: `gameInfo.json`'s hero
 * entries carry no unlock-cost field, and Codex's `unitlevel` /
 * `orbpromotionrequirement` tables both start counting at `progressionIndex`
 * 0 — i.e. from a unit already in the roster — so their lowest row prices
 * reaching 0 stars, not being unlocked in the first place. A unit's
 * `baseRarity` looks like it might scale this, but does not: a live player
 * response for a Legendary-`baseRarity` character (Calgar) reports
 * `progressionIndex: 0` once owned, the same starting rung every other
 * rarity uses, so unlocking always lands at Common regardless of the
 * character's own flavor rarity.
 *
 * The only source that publishes a number at all is the community wiki's
 * shard-cost table (tacticus.wiki.gg/wiki/Shards, row "0 Unlock — 40"),
 * which does not break the figure down by rarity either. Treated as the same
 * grade of evidence as the rest of this file — a screenshot/page reading,
 * not a modeled value — and worth replacing the moment a machine-readable
 * source publishes it directly.
 */
export const UNIT_UNLOCK_SHARDS = 40;
