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

/** Flat stat added by the rank upgrades a unit has applied. */
export interface RankUpgradeBonuses {
  health: number;
  damage: number;
  armour: number;
}

export interface ComputedUnitStats {
  rank: number;
  /**
   * Cumulative star count, which drives the base-stat multiplier.
   *
   * This is not what the character screen shows — see
   * {@link ComputedUnitStats.tierStarLevel}.
   */
  starLevel: number | undefined;
  /**
   * Stars shown on the character screen, counted within the current rarity.
   *
   * Verified for Epic: progression index 9 displays 1 star and index 11
   * displays 3, while the cumulative counts are 6 and 8.
   */
  tierStarLevel: number | undefined;
  rarity: Rarity | undefined;
  /** Unmodified values for the unit's rank, straight from the database. */
  base: { health: number; damage: number; armour: number };
  /** `1 + STAR_BASE_STAT_BONUS * starLevel`. */
  starMultiplier: number;
  /** Flat additions from applied rank upgrades, before which nothing is scaled. */
  rankUpgrades: RankUpgradeBonuses;
  /** How many of the rank's upgrade slots are filled. */
  rankUpgradesApplied: number;
  rankUpgradesAvailable: number;
  /**
   * Flat health and armour granted by equipment, already included in the
   * figures below. Equipment is added after scaling, not multiplied by it.
   */
  equipment: { health: number; armour: number };
  /**
   * Final displayed values:
   * `floor(base * multiplier) + rankUpgrades + equipment`.
   */
  health: number;
  damage: number;
  armour: number;
  /** Summed stats of everything equipped. */
  itemBonuses: ItemBonuses;
}

/** Map a source `statType` onto the stat it increases. */
const UPGRADE_STAT_TARGET: Record<string, keyof RankUpgradeBonuses> = {
  hp: 'health',
  dmg: 'damage',
  fixedArmor: 'armour',
};

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
 * `floor(base * starMultiplier) + appliedRankUpgrades + equipment`, verified
 * against three character screens: Gulgortz at Stone I with 6 stars and no
 * upgrades applied (100/26/26 x1.6 -> 160/41/41), Haarken at Iron II with 8
 * stars and five upgrades applied (floor(234 x 1.8) + 58 -> 479 health), and
 * Tigurius at Bronze II with 6 stars, four upgrades and Adorned Plated Greaves
 * (floor(68 x 1.6) + 17 + 87 -> 212 armour).
 *
 * Equipment lands outside the star multiplier: Tigurius's 87 armour arrives
 * whole, and scaling it would give 351 rather than the 212 the game shows.
 *
 * Returns `undefined` when the database has no stat block for the unit's rank,
 * rather than extrapolating one.
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

  // `unit.upgrades` holds indices into the rank's upgrade list.
  const rankUpgrades: RankUpgradeBonuses = { health: 0, damage: 0, armour: 0 };
  let applied = 0;
  for (const index of unit.upgrades) {
    const upgrade = rankStats.upgrades[index];
    if (!upgrade) continue;
    applied += 1;
    const target = upgrade.statType ? UPGRADE_STAT_TARGET[upgrade.statType] : undefined;
    if (target) rankUpgrades[target] += upgrade.statIncrease ?? 0;
  }

  // The game truncates rather than rounds, and adds rank upgrades *after*
  // scaling: Haarken at 8 stars is floor(234 x 1.8) + 58 = 479, where scaling
  // the sum would give 525.
  const scale = (value: number, flat: number) => Math.floor(value * starMultiplier) + flat;

  // Equipment grants flat health and armour, which the game folds into the
  // headline figures rather than listing separately — the crit and block stats
  // are what it shows on their own. Only these two stats appear on equipment;
  // nothing grants damage.
  const itemBonuses = computeItemBonuses(unit.items, db);
  const equipment = { health: itemBonuses.hp ?? 0, armour: itemBonuses.fixedArmor ?? 0 };

  return {
    rank: unit.rank,
    starLevel,
    tierStarLevel: computeTierStarLevel(unit.progressionIndex, db, progression?.rarity),
    rarity: progression?.rarity,
    base: { health: rankStats.health, damage: rankStats.damage, armour: rankStats.armour },
    starMultiplier,
    rankUpgrades,
    rankUpgradesApplied: applied,
    rankUpgradesAvailable: rankStats.upgrades.length,
    equipment,
    health: scale(rankStats.health, rankUpgrades.health) + equipment.health,
    damage: scale(rankStats.damage, rankUpgrades.damage),
    armour: scale(rankStats.armour, rankUpgrades.armour) + equipment.armour,
    itemBonuses,
  };
}

/**
 * Stars as the character screen counts them: within the current rarity rather
 * than cumulatively.
 *
 * Entering a rarity by ascending counts as that tier's first star, so Epic's
 * three steps read 1, 2, 3. Common is the exception — a unit is unlocked into it
 * rather than ascending, so its first step is zero stars, which is what the
 * game's progression panel shows.
 *
 * Only the Epic band is confirmed against the game; the rest follows the same
 * rule.
 */
export function computeTierStarLevel(
  progressionIndex: number,
  db: GameDatabase,
  rarityHint?: Rarity,
): number | undefined {
  const rarity =
    rarityHint ??
    db.progressionRequirements.find((r) => r.progressionIndex === progressionIndex)?.rarity;
  if (rarity === undefined) return undefined;
  const first = db.progressionRequirements
    .filter((r) => r.rarity === rarity)
    .reduce<number | undefined>(
      (min, r) => (min === undefined ? r.progressionIndex : Math.min(min, r.progressionIndex)),
      undefined,
    );
  if (first === undefined) return undefined;
  return progressionIndex - first + (rarity === Rarity.Common ? 0 : 1);
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
