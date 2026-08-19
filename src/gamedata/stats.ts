/**
 * Derived unit statistics.
 *
 * The player API reports a unit's *state* (rank, star level, equipped items) but
 * none of its resulting numbers. This reconstructs what the game shows on the
 * character screen from that state plus the game database.
 */

import { Rarity } from './enums.js';
import type { GameDatabase } from './types.js';
import type { Unit, UnitItem } from '../types/player.js';

/**
 * Bonus granted per star to a character's base stats.
 *
 * The game's Character Progression panel states it: "Each star gives a +10%
 * bonus to the Character's base stats. Each Rarity after Common gives a +20%
 * bonus to the Character's ability stats." Base stats therefore scale with
 * stars; rarity scales *ability* stats, which are not modelled here because
 * ability damage values are unresolved placeholders in the source data.
 */
export const STAR_BASE_STAT_BONUS = 0.1;

/** Bonus per rarity above Common, applied to ability stats. Not applied here. */
export const RARITY_ABILITY_STAT_BONUS = 0.2;

/** Aggregated equipment stats, keyed by stat name (`critChance`, `blockDmg`, …). */
export type ItemBonuses = Record<string, number>;

export interface ComputedUnitStats {
  rank: number;
  /** Star count, which drives the base-stat multiplier. */
  starLevel: number | undefined;
  rarity: Rarity | undefined;
  /** Unmodified values for the unit's rank, straight from the database. */
  base: { health: number; damage: number; armour: number };
  /** `1 + STAR_BASE_STAT_BONUS * starLevel`. */
  starMultiplier: number;
  /** Base values scaled by {@link ComputedUnitStats.starMultiplier}. */
  health: number;
  damage: number;
  armour: number;
  /** Summed stats of everything equipped. */
  itemBonuses: ItemBonuses;
}

/**
 * Normalise an equipment stat key.
 *
 * Booster items report `blockChanceBonus` / `blockDmgBonus` where the item they
 * boost reports `blockChance` / `blockDmg`. The game adds them into one figure —
 * a Force Field at 30% plus an Amplifier at 4% displays as 34% — so the suffix
 * is dropped and the values summed.
 */
function normaliseStatKey(key: string): string {
  return key.replace(/Bonus$/, '');
}

/** Sum the stats of every equipped item at its current level. */
export function computeItemBonuses(items: readonly UnitItem[], db: GameDatabase): ItemBonuses {
  const totals: ItemBonuses = {};
  for (const equipped of items) {
    const definition = db.items[equipped.id];
    // `level` is 1-based; a level beyond the published table yields nothing
    // rather than guessing an extrapolation.
    const level = definition?.levels[equipped.level - 1];
    if (!level) continue;
    for (const [key, value] of Object.entries(level.stats)) {
      const stat = normaliseStatKey(key);
      totals[stat] = (totals[stat] ?? 0) + value;
    }
  }
  return totals;
}

/**
 * Compute a unit's displayed stats.
 *
 * Returns `undefined` when the database has no stat block for the unit's rank,
 * rather than extrapolating one.
 *
 * Verified against the game for Gulgortz at Stone I with 6 stars: base
 * 100/26/26 x1.6 gives 160/41/41, matching the character screen exactly
 * (41.6 truncates to 41).
 */
export function computeUnitStats(unit: Unit, db: GameDatabase): ComputedUnitStats | undefined {
  const definition = db.units[unit.id];
  const rankStats = definition?.ranks.find((r) => r.rank === unit.rank);
  if (!rankStats) return undefined;

  const progression = db.progressionRequirements.find(
    (r) => r.progressionIndex === unit.progressionIndex,
  );
  const starLevel = progression?.starLevel;
  const starMultiplier = 1 + STAR_BASE_STAT_BONUS * (starLevel ?? 0);

  // The game truncates rather than rounds: 26 x 1.6 = 41.6 displays as 41.
  const scale = (value: number) => Math.floor(value * starMultiplier);

  return {
    rank: unit.rank,
    starLevel,
    rarity: progression?.rarity,
    base: { health: rankStats.health, damage: rankStats.damage, armour: rankStats.armour },
    starMultiplier,
    health: scale(rankStats.health),
    damage: scale(rankStats.damage),
    armour: scale(rankStats.armour),
    itemBonuses: computeItemBonuses(unit.items, db),
  };
}

/**
 * Power Score is deliberately not computed.
 *
 * The formula is unpublished and non-linear, and the community wiki records that
 * two characters with identical ability levels, ranks, rarity, stars and
 * equipment can still differ — so it depends on inputs (traits, hit counts,
 * damage types, which abilities a unit has) that no available source exposes.
 * Any formula here would be a guess presented as a number.
 *
 * Real values are available for units that have fought in a guild raid: the
 * `guildRaid` endpoint returns `PublicHeroDetail.power` per hero, for a key with
 * the Guild Raid scope.
 */
export const POWER_SCORE_IS_UNPUBLISHED = true;
