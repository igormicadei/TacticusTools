/**
 * Per-unit shard/orb progress toward the next promotion and the next
 * ascension — the two milestones `db.progressionRequirements` prices —
 * joined against what the player currently holds.
 */

import { GRAND_ALLIANCE_NAMES, type Rarity } from '@lib/gamedata/enums.js';
import { ownedByKey } from '@lib/gamedata/requirements.js';
import type { GameDatabase, ProgressionKind, ProgressionRequirement } from '@lib/gamedata/types.js';
import type { GrandAlliance } from '@lib/types/common.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { buildRoster, type RosterEntry } from './roster.ts';

/** Orbs of one rarity, needed toward a milestone. */
export interface OrbCost {
  rarity: Rarity;
  amount: number;
}

/**
 * What reaching one milestone costs, possibly bridging more than one row.
 *
 * A bridge that spans several rows can need more than one orb rarity — the
 * Legendary→Mythic ascension sits three rows past some starting points, and
 * the two promotions in front of it cost Legendary orbs while the ascension
 * itself costs Mythic ones. `orbs` is a list rather than a single rarity so
 * that case is represented rather than collapsed into a wrong total.
 */
export interface ProgressionCost {
  shards: number;
  mythicShards: number;
  orbs: readonly OrbCost[];
  /**
   * True when the milestone itself is a promotion but an ascension had to be
   * bought first to reach it — the number on screen is bigger than a single
   * star costs because it is really two (or more) purchases folded into one.
   */
  bridgedAscension: boolean;
  toRarity: Rarity | undefined;
}

export interface ShardRow extends RosterEntry {
  alliance: GrandAlliance | undefined;
  /**
   * Undefined for a not-yet-owned unit: neither promotion nor ascension
   * applies before it is unlocked, and this repo has no reliable per-unit
   * unlock-shard cost to show in its place (the one published figure is a
   * single community-wiki number that does not hold up — some units are
   * known to cost into the hundreds) — see {@link GameDatabase.unitUnlockShards}
   * for the constant kept on hand for whenever a real source publishes it.
   */
  nextPromotion: ProgressionCost | undefined;
  /** Orbs currently held, keyed by the rarity {@link ProgressionCost.orbs} names. */
  nextPromotionHeldOrbs: ReadonlyMap<Rarity, number>;
  nextAscension: ProgressionCost | undefined;
  nextAscensionHeldOrbs: ReadonlyMap<Rarity, number>;
  /**
   * Missing shards + missing orbs (every rarity involved, summed) for that
   * milestone, `Infinity` when there is no such milestone left (fully
   * progressed, or not yet owned — see {@link nextPromotion}). Lower sorts
   * closer.
   */
  promotionShortfall: number;
  ascensionShortfall: number;
}

/**
 * Sum of every progression row from `fromIndex + 1` up to and including the
 * next row of `stopKind`.
 *
 * A milestone is never reachable in isolation when the rung right in front of
 * it is the *other* kind: Common's third star sits behind an ascension to
 * Uncommon, so "what does my next promotion cost" cannot stop at that
 * ascension row — it has to fold in every step up to and including the
 * promotion that actually follows. The reverse holds too: "what does my next
 * ascension cost" from a fresh Common unit has to buy the stars in between
 * before the ascension is reachable at all.
 */
function sumToNext(
  fromIndex: number,
  stopKind: ProgressionKind,
  byIndex: ReadonlyMap<number, ProgressionRequirement>,
): ProgressionCost | undefined {
  let shards = 0;
  let mythicShards = 0;
  const orbsByRarity = new Map<Rarity, number>();
  let bridgedAscension = false;
  let toRarity: Rarity | undefined;

  // Bounded well past the 20-row ladder so a data gap returns "maxed" rather
  // than spinning.
  for (let index = fromIndex + 1; index <= fromIndex + 20; index += 1) {
    const row = byIndex.get(index);
    if (!row) return undefined;
    if (row.shards) {
      if (row.shardType === 'mythic') mythicShards += row.shards;
      else shards += row.shards;
    }
    if (row.orbs && row.orbRarity !== undefined) {
      orbsByRarity.set(row.orbRarity, (orbsByRarity.get(row.orbRarity) ?? 0) + row.orbs);
    }
    toRarity = row.rarity;
    if (stopKind === 'promotion' && row.kind === 'ascension') bridgedAscension = true;
    if (row.kind === stopKind) {
      return {
        shards,
        mythicShards,
        orbs: [...orbsByRarity.entries()].map(([rarity, amount]) => ({ rarity, amount })),
        bridgedAscension,
        toRarity,
      };
    }
  }
  return undefined;
}

function heldOrbsFor(
  cost: ProgressionCost | undefined,
  alliance: GrandAlliance | undefined,
  owned: ReadonlyMap<string, number>,
): ReadonlyMap<Rarity, number> {
  const held = new Map<Rarity, number>();
  if (!cost || !alliance) return held;
  for (const o of cost.orbs) held.set(o.rarity, owned.get(`orb:${alliance}:${o.rarity}`) ?? 0);
  return held;
}

function shortfall(
  cost: ProgressionCost | undefined,
  heldShards: number,
  heldMythicShards: number,
  heldOrbs: ReadonlyMap<Rarity, number>,
): number {
  if (!cost) return Number.POSITIVE_INFINITY;
  const missingShards = Math.max(0, cost.shards - heldShards);
  const missingMythic = Math.max(0, cost.mythicShards - heldMythicShards);
  const missingOrbs = cost.orbs.reduce(
    (sum, o) => sum + Math.max(0, o.amount - (heldOrbs.get(o.rarity) ?? 0)),
    0,
  );
  return missingShards + missingMythic + missingOrbs;
}

/** One row per unit known to either side — same coverage as {@link buildRoster}. */
export function buildShardRows(player: PlayerResponse, db: GameDatabase): ShardRow[] {
  const roster = buildRoster(player, db);
  const owned = ownedByKey(player, db);
  const byIndex = new Map(db.progressionRequirements.map((r) => [r.progressionIndex, r]));

  return roster.map((entry) => {
    const alliance: GrandAlliance | undefined =
      entry.unit?.grandAlliance ??
      (entry.definition?.grandAlliance !== undefined
        ? GRAND_ALLIANCE_NAMES[entry.definition.grandAlliance]
        : undefined);

    // Before the unit is owned, neither promotion nor ascension is a real
    // milestone yet, and there is no reliable unlock-shard figure to show in
    // their place — see the `ShardRow.nextPromotion` doc comment.
    if (!entry.unit) {
      return {
        ...entry,
        alliance,
        nextPromotion: undefined,
        nextPromotionHeldOrbs: new Map(),
        nextAscension: undefined,
        nextAscensionHeldOrbs: new Map(),
        promotionShortfall: Number.POSITIVE_INFINITY,
        ascensionShortfall: Number.POSITIVE_INFINITY,
      };
    }

    const currentIndex = entry.unit.progressionIndex;
    const nextPromotion = sumToNext(currentIndex, 'promotion', byIndex);
    const nextAscension = sumToNext(currentIndex, 'ascension', byIndex);
    const nextPromotionHeldOrbs = heldOrbsFor(nextPromotion, alliance, owned);
    const nextAscensionHeldOrbs = heldOrbsFor(nextAscension, alliance, owned);

    return {
      ...entry,
      alliance,
      nextPromotion,
      nextPromotionHeldOrbs,
      nextAscension,
      nextAscensionHeldOrbs,
      promotionShortfall: shortfall(nextPromotion, entry.shards, entry.mythicShards, nextPromotionHeldOrbs),
      ascensionShortfall: shortfall(nextAscension, entry.shards, entry.mythicShards, nextAscensionHeldOrbs),
    };
  });
}
