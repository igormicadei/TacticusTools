/**
 * What each plan step costs, where those items come from, and how the ones
 * already held cover the plan.
 */

import { Rarity, parseRarity } from './enums.js';
import type { BattleRef, UnitId } from './ids.js';
import { battleKey } from './ids.js';
import type { EvolutionPlan, PlanStep } from './plan.js';
import type { GameDatabase } from './types.js';
import type { PlayerResponse, Unit } from '../types/player.js';

/* -------------------------------------------------------------------------- */
/* Requirements                                                               */
/* -------------------------------------------------------------------------- */

export type RequirementKind = 'upgrade' | 'xp' | 'badge' | 'shard' | 'orb';

export interface ItemRequirement {
  /**
   * Stable identity used to pool the same item across steps, e.g.
   * `upgrade:upgHpC002`, `badge:Xenos:2`, `shard:orksWarboss`.
   */
  key: string;
  kind: RequirementKind;
  name: string;
  rarity?: Rarity;
  amount: number;
}

export interface StepCost {
  step: PlanStep;
  items: ItemRequirement[];
  /** Gold, which is not an item and is never farmed from a node. */
  gold: number;
}

const RARITY_LABEL = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];

/**
 * Cost of every step in a plan.
 *
 * Level steps are expressed as raw XP rather than a book breakdown: books are
 * interchangeable currency, so any mix covering the total works and picking one
 * would invent a requirement the game does not impose.
 */
export function planCosts(unit: Unit, plan: EvolutionPlan, db: GameDatabase): StepCost[] {
  const definition = db.units[unit.id];
  const alliance = unit.grandAlliance ?? 'Unknown';

  return plan.steps.map((step) => {
    const items: ItemRequirement[] = [];
    let gold = 0;

    if (step.kind === 'rank') {
      // Reaching rank B consumes the upgrades of every rank from A up to B-1.
      const pooled = new Map<string, number>();
      for (let rank = step.from; rank < step.to; rank += 1) {
        for (const upgrade of definition?.ranks.find((r) => r.rank === rank)?.upgrades ?? []) {
          pooled.set(upgrade.upgradeId, (pooled.get(upgrade.upgradeId) ?? 0) + upgrade.amount);
        }
      }
      for (const [upgradeId, amount] of pooled) {
        items.push({
          key: `upgrade:${upgradeId}`,
          kind: 'upgrade',
          name: db.upgrades[upgradeId]?.name ?? upgradeId,
          ...(db.upgrades[upgradeId]?.rarity !== undefined
            ? { rarity: db.upgrades[upgradeId]!.rarity! }
            : {}),
          amount,
        });
      }
    }

    if (step.kind === 'level') {
      const from = db.xpLevels.find((l) => l.level === step.from)?.totalXp ?? 0;
      const to = db.xpLevels.find((l) => l.level === step.to)?.totalXp ?? 0;
      const xp = Math.max(0, to - from);
      if (xp > 0) {
        items.push({ key: 'xp', kind: 'xp', name: 'Experience', amount: xp });
      }
    }

    if (step.kind === 'ability') {
      // Level 0 is "locked", so the entry for level N is the cost of reaching N.
      for (let level = step.from + 1; level <= step.to; level += 1) {
        const cost = db.abilityUpgradeCosts.find((c) => c.level === level);
        if (!cost) continue;
        gold += cost.gold;
        const rarity = cost.badgeRarity ?? parseRarity(cost.badgeType.replace(/^abilityToken/i, ''));
        if (rarity === undefined) continue;
        const key = `badge:${alliance}:${rarity}`;
        const existing = items.find((i) => i.key === key);
        if (existing) existing.amount += cost.amount;
        else
          items.push({
            key,
            kind: 'badge',
            name: `${RARITY_LABEL[rarity]} ${alliance} Badges`,
            rarity,
            amount: cost.amount,
          });
      }
    }

    if (step.kind === 'promotion' || step.kind === 'ascension') {
      for (let index = step.from + 1; index <= step.to; index += 1) {
        const requirement = db.progressionRequirements.find((r) => r.progressionIndex === index);
        if (!requirement) continue;
        if (requirement.shards) {
          const mythic = requirement.shardType === 'mythic';
          const key = `shard:${unit.id}${mythic ? ':mythic' : ''}`;
          const existing = items.find((i) => i.key === key);
          if (existing) existing.amount += requirement.shards;
          else
            items.push({
              key,
              kind: 'shard',
              name: `${unit.name ?? unit.id} ${mythic ? 'Mythic ' : ''}Shards`,
              amount: requirement.shards,
            });
        }
        if (requirement.orbs && requirement.orbRarity !== undefined) {
          const key = `orb:${alliance}:${requirement.orbRarity}`;
          const existing = items.find((i) => i.key === key);
          if (existing) existing.amount += requirement.orbs;
          else
            items.push({
              key,
              kind: 'orb',
              name: `${RARITY_LABEL[requirement.orbRarity]} ${alliance} Orbs`,
              rarity: requirement.orbRarity,
              amount: requirement.orbs,
            });
        }
      }
    }

    return { step, items, gold };
  });
}

/* -------------------------------------------------------------------------- */
/* Holdings                                                                   */
/* -------------------------------------------------------------------------- */

/** How many of each requirement key the player currently holds. */
export function ownedByKey(player: PlayerResponse, db: GameDatabase): Map<string, number> {
  const owned = new Map<string, number>();
  const inventory = player.player.inventory;

  for (const upgrade of inventory.upgrades) {
    owned.set(`upgrade:${upgrade.id}`, (owned.get(`upgrade:${upgrade.id}`) ?? 0) + upgrade.amount);
  }

  // Books are interchangeable, so holdings are measured in the XP they carry.
  let xp = 0;
  for (const book of inventory.xpBooks) {
    xp += book.amount * (db.xpBooks.find((b) => b.id === book.id)?.xpIncrease ?? 0);
  }
  owned.set('xp', xp);

  for (const [alliance, badges] of Object.entries(inventory.abilityBadges)) {
    for (const badge of badges ?? []) {
      const rarity = parseRarity(badge.rarity);
      if (rarity === undefined) continue;
      owned.set(`badge:${alliance}:${rarity}`, badge.amount);
    }
  }

  for (const [alliance, orbs] of Object.entries(inventory.orbs)) {
    for (const orb of orbs ?? []) {
      const rarity = parseRarity(orb.rarity);
      if (rarity === undefined) continue;
      owned.set(`orb:${alliance}:${rarity}`, orb.amount);
    }
  }

  // A unit's own shards sit on the unit once unlocked, in the inventory before.
  for (const unit of player.player.units) {
    owned.set(`shard:${unit.id}`, unit.shards);
    owned.set(`shard:${unit.id}:mythic`, unit.mythicShards);
  }
  for (const shard of inventory.shards) {
    if (!owned.has(`shard:${shard.id}`)) owned.set(`shard:${shard.id}`, shard.amount);
  }
  for (const shard of inventory.mythicShards) {
    if (!owned.has(`shard:${shard.id}:mythic`)) {
      owned.set(`shard:${shard.id}:mythic`, shard.amount);
    }
  }

  return owned;
}

export interface AllocatedItem extends ItemRequirement {
  /** Held stock assigned to this step, never more than {@link ItemRequirement.amount}. */
  covered: number;
  /** `amount - covered`. */
  missing: number;
}

export interface AllocatedStep {
  step: PlanStep;
  items: AllocatedItem[];
  gold: number;
}

/**
 * Spread what the player holds across the steps that need it, in plan order.
 *
 * Earlier steps are filled first because they happen first: 15 of an item split
 * evenly over three steps with only 12 in hand reads 5/5, 5/5, 2/5 rather than
 * four of each. What is left over is what actually has to be farmed, and when.
 */
export function allocateHoldings(
  costs: StepCost[],
  owned: Map<string, number>,
): AllocatedStep[] {
  const remaining = new Map(owned);
  return costs.map(({ step, items, gold }) => ({
    step,
    gold,
    items: items.map((item) => {
      const available = remaining.get(item.key) ?? 0;
      const covered = Math.min(available, item.amount);
      remaining.set(item.key, available - covered);
      return { ...item, covered, missing: item.amount - covered };
    }),
  }));
}

export interface AggregatedItem extends ItemRequirement {
  /** Total held, not capped to the requirement. */
  owned: number;
  covered: number;
  missing: number;
  /** How many steps call for this item. */
  steps: number;
}

/** Roll every step's items into one list per item. */
export function aggregate(costs: StepCost[], owned: Map<string, number>): AggregatedItem[] {
  const pooled = new Map<string, AggregatedItem>();
  for (const { items } of costs) {
    for (const item of items) {
      const existing = pooled.get(item.key);
      if (existing) {
        existing.amount += item.amount;
        existing.steps += 1;
      } else {
        pooled.set(item.key, { ...item, owned: owned.get(item.key) ?? 0, covered: 0, missing: 0, steps: 1 });
      }
    }
  }
  for (const item of pooled.values()) {
    item.covered = Math.min(item.owned, item.amount);
    item.missing = item.amount - item.covered;
  }
  return [...pooled.values()].sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

export interface NodeStatus extends BattleRef {
  /** Present in the player's campaign progress, i.e. reachable. */
  unlocked: boolean;
  /** Runs left today. Meaningful only when unlocked. */
  attemptsLeft: number;
  attemptsUsed: number;
  campaignName: string;
}

export interface RecipeComponent {
  key: string;
  id: string;
  name: string;
  amount: number;
  rarity?: Rarity;
}

/**
 * How an item is obtained.
 *
 * Materials split cleanly: 195 of 558 upgrades drop from campaign nodes, and
 * the remaining 352 are crafted from those. Every recipe bottoms out in
 * farmable components, so a crafted item is never a dead end in itself — but it
 * is only obtainable if all of its components are.
 */
export type ItemSource =
  | { kind: 'farm'; nodes: BattleRef[] }
  | { kind: 'craft'; recipe: RecipeComponent[] }
  /** Not obtained from campaigns at all: XP, badges, orbs. */
  | { kind: 'other' }
  /** Known item with no published way to get it. */
  | { kind: 'none' };

/** Resolve where an item comes from. */
export function itemSource(
  item: Pick<ItemRequirement, 'kind' | 'key'>,
  db: GameDatabase,
): ItemSource {
  if (item.kind === 'shard') {
    const unitId = item.key.split(':')[1] as UnitId | undefined;
    return { kind: 'farm', nodes: unitId ? (db.shardSources[unitId] ?? []) : [] };
  }
  if (item.kind !== 'upgrade') return { kind: 'other' };

  const id = item.key.slice('upgrade:'.length);
  const upgrade = db.upgrades[id];
  if (!upgrade) return { kind: 'none' };
  if (upgrade.farmableAt.length > 0) return { kind: 'farm', nodes: upgrade.farmableAt };

  const recipe = Object.entries(upgrade.crafting)
    // A base material lists itself; that is not a recipe.
    .filter(([componentId]) => componentId !== id)
    .map(([componentId, amount]) => ({
      key: `upgrade:${componentId}`,
      id: componentId,
      name: db.upgrades[componentId]?.name ?? componentId,
      amount,
      ...(db.upgrades[componentId]?.rarity !== undefined
        ? { rarity: db.upgrades[componentId]!.rarity! }
        : {}),
    }));
  return recipe.length > 0 ? { kind: 'craft', recipe } : { kind: 'none' };
}

/** Nodes that drop an item, when it is farmed directly. */
export function itemSources(
  item: Pick<ItemRequirement, 'kind' | 'key'>,
  db: GameDatabase,
): BattleRef[] | undefined {
  const source = itemSource(item, db);
  return source.kind === 'farm' ? source.nodes : undefined;
}

export interface NodeStatus extends BattleRef {
  /** Present in the player's campaign progress, i.e. reachable. */
  unlocked: boolean;
  /** Runs left today. Meaningful only when unlocked. */
  attemptsLeft: number;
  attemptsUsed: number;
  campaignName: string;
}

/** Annotate nodes with whether the player can run them, and how often today. */
export function nodeStatuses(
  refs: readonly BattleRef[],
  player: PlayerResponse,
  db: GameDatabase,
): NodeStatus[] {
  const progress = unlockedNodes(player);
  // Sources can list the same node twice; collapse them so the list is honest.
  const unique = new Map<string, BattleRef>();
  for (const ref of refs) unique.set(`${ref.campaignId}#${ref.battleIndex}`, ref);

  return [...unique.values()]
    .map((ref) => {
      const hit = progress.get(`${ref.campaignId}#${ref.battleIndex}`);
      return {
        ...ref,
        unlocked: hit !== undefined,
        attemptsLeft: hit?.attemptsLeft ?? 0,
        attemptsUsed: hit?.attemptsUsed ?? 0,
        campaignName: db.campaigns[ref.campaignId]?.name ?? ref.campaignId,
      };
    })
    .sort(
      (a, b) =>
        Number(b.unlocked) - Number(a.unlocked) ||
        b.attemptsLeft - a.attemptsLeft ||
        a.campaignName.localeCompare(b.campaignName) ||
        a.nodeNumber - b.nodeNumber,
    );
}

function unlockedNodes(
  player: PlayerResponse,
): Map<string, { attemptsLeft: number; attemptsUsed: number }> {
  const progress = new Map<string, { attemptsLeft: number; attemptsUsed: number }>();
  for (const campaign of player.player.progress.campaigns) {
    for (const battle of campaign.battles) {
      progress.set(`${campaign.id}#${battle.battleIndex}`, {
        attemptsLeft: battle.attemptsLeft,
        attemptsUsed: battle.attemptsUsed,
      });
    }
  }
  return progress;
}

/**
 * True when nothing the player has unlocked can yield this item.
 *
 * A farmed item is blocked when none of its nodes is unlocked; a crafted one
 * when any component is blocked, since a recipe needs all of them. This is
 * deliberately not about today's attempts — a node with none left refreshes
 * tomorrow, whereas a locked one is a wall.
 */
export function isUnfarmable(
  item: { kind: RequirementKind; key: string; missing: number },
  db: GameDatabase,
  player: PlayerResponse,
): boolean {
  if (item.missing <= 0) return false;
  return isBlocked(item, db, unlockedNodes(player), new Map());
}

function isBlocked(
  item: Pick<ItemRequirement, 'kind' | 'key'>,
  db: GameDatabase,
  unlocked: Map<string, unknown>,
  memo: Map<string, boolean>,
): boolean {
  const seen = memo.get(item.key);
  if (seen !== undefined) return seen;
  // Guard against a recipe cycle before recursing.
  memo.set(item.key, false);

  const source = itemSource(item, db);
  let blocked: boolean;
  switch (source.kind) {
    case 'other':
      blocked = false;
      break;
    case 'none':
      blocked = true;
      break;
    case 'farm':
      blocked = !source.nodes.some((n) => unlocked.has(`${n.campaignId}#${n.battleIndex}`));
      break;
    case 'craft':
      blocked = source.recipe.some((c) =>
        isBlocked({ kind: 'upgrade', key: c.key }, db, unlocked, memo),
      );
      break;
  }
  memo.set(item.key, blocked);
  return blocked;
}

export { battleKey };
