/**
 * Planning an equipment slot: what it would cost to put a specific item, at a
 * specific level, into one of a unit's slots — and what that does to its
 * stats.
 *
 * This is a separate small engine from `plan.ts`'s rank/rarity/level planning
 * rather than an extension of it: equipment does not share that pipeline's
 * dependencies (a level target does not drag an item level with it, the way
 * an ability target drags a character level), and its currencies — Dust, Gold,
 * Mythic Dust, Forge Badges — are not the materials `requirements.ts` prices.
 * The Tacticus API reports none of the first three as a balance a player
 * holds, so unlike a material shortfall this is a cost, not a netted need —
 * see the module notes below for what that means for a plan reader.
 */

import { computeUnitStats, type ComputedUnitStats } from './stats.js';
import type { GameDatabase, ItemDefinition } from './types.js';
import type { Rarity } from './enums.js';
import type { Unit, UnitItemSlot } from '../types/player.js';

/** What a plan asks for: this item, at this level, in this slot. */
export interface ItemTarget {
  slotId: UnitItemSlot;
  itemId: string;
  level: number;
}

/** One item's span in the path — either levelling it, or closing it out before an ascension. */
export interface ItemPlanLeg {
  itemId: string;
  name: string;
  rarity: Rarity | undefined;
  /** 0 means "not yet owned"; otherwise the level already held. */
  fromLevel: number;
  toLevel: number;
  dust: number;
  gold: number;
  mythicDust: number;
  /** Set when this leg is reached by ascending from the item named here. */
  ascendedFrom?: string;
}

export interface ItemPlanCost {
  dust: number;
  gold: number;
  mythicDust: number;
  /** Forge Badges needed, by rarity, for every ascension the path crosses. */
  forgeBadges: Partial<Record<Rarity, number>>;
}

export interface ItemPlanEndpoint {
  itemId: string;
  name: string;
  level: number;
  rarity: Rarity | undefined;
}

export interface ItemPlan {
  slotId: UnitItemSlot;
  target: ItemPlanEndpoint;
  /** What the unit currently wears there, when anything. */
  current?: ItemPlanEndpoint;
  /**
   * Whether `target` sits on the deterministic ascension chain out of what is
   * currently worn (`db.items[x].nextInSeries`, followed forward).
   *
   * The game itself also offers ascension as a *choice* between that
   * deterministic next item and a second, differently-typed item the wiki
   * describes as unpredictable — see `equipment-forge-and-items.md`. That
   * second branch is not published anywhere `gameInfo.json` exposes, so it
   * cannot be walked here: `false` means the target was priced as a fresh
   * item instead of a continuation, which undercounts a path that in fact
   * goes through one of those unpublished branches.
   */
  connected: boolean;
  /** Ordered legs from the current item (or nothing) to the target. */
  legs: ItemPlanLeg[];
  cost: ItemPlanCost;
  blocked?: string;
  notes: string[];
}

const MAX_CHAIN = 20;

/** `nextInSeries`, followed forward from `id` until it loops or runs out. */
function itemChainFrom(id: string, db: GameDatabase): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = id;
  while (current && !seen.has(current) && chain.length < MAX_CHAIN) {
    seen.add(current);
    chain.push(current);
    current = db.items[current]?.nextInSeries;
  }
  return chain;
}

/**
 * Currency cost of levelling one item from `fromLevel` to `toLevel`.
 *
 * Each `ItemLevel` entry carries what it costs to *reach* that level from the
 * one before it — level 1's own entry is non-zero (a Common item's first
 * level already asks 10 Dust in the published table) rather than free, the
 * same way a unit's first rank upgrade is not free. So the span from
 * `fromLevel` to `toLevel` sums the entries strictly after `fromLevel` up to
 * and including `toLevel`; `fromLevel = 0` (nothing owned yet) sums from the
 * item's own level 1.
 */
export function costOfSpan(
  item: ItemDefinition,
  fromLevel: number,
  toLevel: number,
): { dust: number; gold: number; mythicDust: number } {
  let dust = 0;
  let gold = 0;
  let mythicDust = 0;
  for (const level of item.levels.slice(fromLevel, toLevel)) {
    dust += level.dustCost ?? 0;
    gold += level.goldCost ?? 0;
    mythicDust += level.mythicDustCost ?? 0;
  }
  return { dust, gold, mythicDust };
}

function endpoint(itemId: string, level: number, db: GameDatabase): ItemPlanEndpoint {
  const def = db.items[itemId];
  return { itemId, name: def?.name ?? itemId, level, rarity: def?.rarity };
}

/**
 * What it would cost to reach `target`, and what the unit wears there today.
 *
 * Walks `nextInSeries` forward from whatever is currently in the slot. When
 * the target is on that chain, every item strictly before it is costed to its
 * own maximum level (an item cannot ascend before it is maxed) plus one Forge
 * Badge of the next item's rarity per ascension crossed — the one fact about
 * ascension's currency cost the community wiki states with confidence, even
 * though the Coins/Salvage price of the ascension itself is not published and
 * so is not counted. When the target is not on that chain — nothing is worn
 * yet, or the target is a different item entirely — it is costed alone from
 * level 1, and `connected` is `false`; see {@link ItemPlan.connected}.
 */
export function resolveItemTarget(unit: Unit, target: ItemTarget, db: GameDatabase): ItemPlan {
  const notes: string[] = [];
  const targetDef = db.items[target.itemId];
  if (!targetDef) {
    return {
      slotId: target.slotId,
      target: endpoint(target.itemId, target.level, db),
      connected: false,
      legs: [],
      cost: { dust: 0, gold: 0, mythicDust: 0, forgeBadges: {} },
      blocked: `No item "${target.itemId}" in the database.`,
      notes,
    };
  }

  const cap = targetDef.levels.length || 1;
  const targetLevel = Math.min(Math.max(1, Math.round(target.level)), cap);
  const targetInfo = endpoint(target.itemId, targetLevel, db);

  const worn = unit.items.find((i) => i.slotId === target.slotId);
  const current = worn ? endpoint(worn.id, worn.level, db) : undefined;

  const legs: ItemPlanLeg[] = [];
  const forgeBadges: Partial<Record<Rarity, number>> = {};
  let dust = 0;
  let gold = 0;
  let mythicDust = 0;
  let connected = true;

  const charge = (span: { dust: number; gold: number; mythicDust: number }) => {
    dust += span.dust;
    gold += span.gold;
    mythicDust += span.mythicDust;
  };

  if (current && current.itemId === target.itemId) {
    if (targetLevel <= current.level) {
      notes.push('Already at or past this level.');
    } else {
      const span = costOfSpan(targetDef, current.level, targetLevel);
      legs.push({
        itemId: target.itemId,
        name: targetDef.name,
        rarity: targetDef.rarity,
        fromLevel: current.level,
        toLevel: targetLevel,
        ...span,
      });
      charge(span);
    }
    return { slotId: target.slotId, target: targetInfo, current, connected, legs, cost: { dust, gold, mythicDust, forgeBadges }, notes };
  }

  const chain = current ? itemChainFrom(current.itemId, db) : [];
  const index = current ? chain.indexOf(target.itemId) : -1;

  if (current && index > 0) {
    for (let i = 0; i < index; i += 1) {
      const fromId = chain[i]!;
      const toId = chain[i + 1]!;
      const fromDef = db.items[fromId];
      const toDef = db.items[toId];
      if (!fromDef || !toDef) {
        connected = false;
        break;
      }
      const startLevel = i === 0 ? current.level : 0;
      const closeOut = costOfSpan(fromDef, startLevel, fromDef.levels.length || 1);
      legs.push({
        itemId: fromId,
        name: fromDef.name,
        rarity: fromDef.rarity,
        fromLevel: startLevel,
        toLevel: fromDef.levels.length || 1,
        ...closeOut,
      });
      charge(closeOut);
      const badgeRarity = toDef.rarity ?? fromDef.rarity;
      if (badgeRarity !== undefined) {
        forgeBadges[badgeRarity] = (forgeBadges[badgeRarity] ?? 0) + 1;
      }
    }
    if (connected) {
      const span = costOfSpan(targetDef, 0, targetLevel);
      const ascendedFrom = chain[index - 1];
      legs.push({
        itemId: target.itemId,
        name: targetDef.name,
        rarity: targetDef.rarity,
        fromLevel: 0,
        toLevel: targetLevel,
        ...span,
        ...(ascendedFrom !== undefined ? { ascendedFrom } : {}),
      });
      charge(span);
    }
  } else {
    connected = false;
  }

  if (!connected) {
    legs.length = 0;
    dust = 0;
    gold = 0;
    mythicDust = 0;
    for (const key of Object.keys(forgeBadges)) delete forgeBadges[Number(key) as Rarity];
    if (current) {
      notes.push(
        `${targetDef.name} is not on the deterministic ascension chain from ${current.name} — ` +
          'the game can also offer ascension as a second, unpredictable item. Cost assumes ' +
          'starting it fresh at level 1.',
      );
    } else {
      notes.push('Nothing is currently worn in this slot; cost assumes acquiring it fresh.');
    }
    const span = costOfSpan(targetDef, 0, targetLevel);
    legs.push({
      itemId: target.itemId,
      name: targetDef.name,
      rarity: targetDef.rarity,
      fromLevel: 0,
      toLevel: targetLevel,
      ...span,
    });
    charge(span);
  }

  return {
    slotId: target.slotId,
    target: targetInfo,
    ...(current ? { current } : {}),
    connected,
    legs,
    cost: { dust, gold, mythicDust, forgeBadges },
    notes,
  };
}

/**
 * The unit's stats if `target` were already equipped, everything else held
 * equal — the "what would this slot get me" question a plan exists to answer.
 *
 * Built the same way {@link resolveItemTarget}'s caller reads the current
 * item: replace whatever is in the slot with the hypothetical one and run it
 * through the same {@link computeUnitStats} the character screen matches.
 */
export function projectedItemStats(
  unit: Unit,
  target: ItemTarget,
  db: GameDatabase,
): ComputedUnitStats | undefined {
  const items = unit.items.filter((i) => i.slotId !== target.slotId);
  items.push({ slotId: target.slotId, id: target.itemId, level: target.level });
  return computeUnitStats({ ...unit, items }, db);
}
