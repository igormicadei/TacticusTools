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
