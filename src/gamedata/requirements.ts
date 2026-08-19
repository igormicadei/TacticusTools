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
  /**
   * Already fitted to the unit at its current rank.
   *
   * The player API reports which of a rank's upgrade slots are filled. Those
   * materials are spent — they cannot be recovered or used elsewhere — so they
   * count as done rather than as something to find, and they never draw on
   * inventory.
   */
  applied?: boolean;
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
      // At the unit's *current* rank some slots are already filled; those
      // materials are spent and are reported as done rather than as needs.
      const pooled = new Map<string, { amount: number; applied: number }>();
      for (let rank = step.from; rank < step.to; rank += 1) {
        const slots = definition?.ranks.find((r) => r.rank === rank)?.upgrades ?? [];
        const filled = rank === unit.rank ? new Set(unit.upgrades) : new Set<number>();
        slots.forEach((upgrade, index) => {
          const entry = pooled.get(upgrade.upgradeId) ?? { amount: 0, applied: 0 };
          entry.amount += upgrade.amount;
          if (filled.has(index)) entry.applied += upgrade.amount;
          pooled.set(upgrade.upgradeId, entry);
        });
      }
      for (const [upgradeId, { amount, applied }] of pooled) {
        const base = {
          key: `upgrade:${upgradeId}`,
          kind: 'upgrade' as const,
          name: db.upgrades[upgradeId]?.name ?? upgradeId,
          ...(db.upgrades[upgradeId]?.rarity !== undefined
            ? { rarity: db.upgrades[upgradeId]!.rarity! }
            : {}),
        };
        // A material can be both fitted once and still needed again for a later
        // slot, so the two are emitted separately rather than netted off.
        if (applied > 0) items.push({ ...base, amount: applied, applied: true });
        if (amount - applied > 0) items.push({ ...base, amount: amount - applied });
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
  /**
   * What the shortfall costs to craft, when this item is crafted rather than
   * farmed. Only the `missing` part is expanded: what is already in hand does
   * not need making.
   */
  components?: AllocatedComponent[];
}

/** One line of a recipe, with the player's stock spread over it like any item. */
export interface AllocatedComponent {
  key: string;
  id: string;
  name: string;
  rarity?: Rarity;
  /** Total needed to craft the parent's shortfall. */
  amount: number;
  covered: number;
  missing: number;
  /** Set when this component is itself crafted. */
  components?: AllocatedComponent[];
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
 *
 * Recipe components are drawn from the same pool, right after the step that
 * needs them, so a component that is also a direct requirement of a later step
 * is not counted twice.
 */
export function allocateHoldings(
  costs: StepCost[],
  owned: Map<string, number>,
  db?: GameDatabase,
): AllocatedStep[] {
  const remaining = new Map(owned);
  return costs.map(({ step, items, gold }) => ({
    step,
    gold,
    items: items.map((item) => {
      // Materials already fitted to the unit are spent, not stock: they are
      // covered by definition and must not eat into the inventory, which is
      // still free for other steps.
      if (item.applied) return { ...item, covered: item.amount, missing: 0 };

      const available = remaining.get(item.key) ?? 0;
      const covered = Math.min(available, item.amount);
      remaining.set(item.key, available - covered);
      const missing = item.amount - covered;
      const components = db ? allocateComponents(item, missing, db, remaining, new Set()) : undefined;
      return { ...item, covered, missing, ...(components ? { components } : {}) };
    }),
  }));
}

/** Recipe cost of `craftCount` copies of `item`, with holdings applied. */
function allocateComponents(
  item: Pick<ItemRequirement, 'kind' | 'key'>,
  craftCount: number,
  db: GameDatabase,
  remaining: Map<string, number>,
  seen: ReadonlySet<string>,
): AllocatedComponent[] | undefined {
  if (craftCount <= 0 || seen.has(item.key)) return undefined;
  const source = itemSource(item, db);
  if (source.kind !== 'craft') return undefined;

  const nested = new Set(seen).add(item.key);
  return source.recipe.map((component) => {
    const amount = component.amount * craftCount;
    const available = remaining.get(component.key) ?? 0;
    const covered = Math.min(available, amount);
    remaining.set(component.key, available - covered);
    const missing = amount - covered;
    const children = allocateComponents(
      { kind: 'upgrade', key: component.key },
      missing,
      db,
      remaining,
      nested,
    );
    return { ...component, amount, covered, missing, ...(children ? { components: children } : {}) };
  });
}

export interface AggregatedItem extends ItemRequirement {
  /** Total held, not capped to the requirement. */
  owned: number;
  covered: number;
  missing: number;
  /** How many steps call for this item. */
  steps: number;
  components?: AllocatedComponent[];
}

/** Roll every step's items into one list per item. */
export function aggregate(
  costs: StepCost[],
  owned: Map<string, number>,
  db?: GameDatabase,
): AggregatedItem[] {
  const pooled = new Map<string, AggregatedItem>();
  for (const { items } of costs) {
    for (const item of items) {
      // Fitted materials are a separate line from the same item still to find:
      // one is done, the other is a need, and merging them would hide both.
      const poolKey = item.applied ? `${item.key}#applied` : item.key;
      const existing = pooled.get(poolKey);
      if (existing) {
        existing.amount += item.amount;
        existing.steps += 1;
      } else {
        pooled.set(poolKey, {
          ...item,
          owned: item.applied ? 0 : (owned.get(item.key) ?? 0),
          covered: 0,
          missing: 0,
          steps: 1,
        });
      }
    }
  }

  const remaining = new Map(owned);
  for (const item of pooled.values()) {
    if (item.applied) {
      item.covered = item.amount;
      item.missing = 0;
      continue;
    }
    const available = remaining.get(item.key) ?? 0;
    item.covered = Math.min(available, item.amount);
    remaining.set(item.key, available - item.covered);
    item.missing = item.amount - item.covered;
  }
  // Components are drawn only once the whole plan's direct needs are known, so
  // a material that is both a requirement and an ingredient is spent on the
  // requirement first.
  if (db) {
    for (const item of pooled.values()) {
      const components = allocateComponents(item, item.missing, db, remaining, new Set());
      if (components) item.components = components;
    }
  }

  return [...pooled.values()].sort(
    (a, b) => b.missing - a.missing || a.name.localeCompare(b.name),
  );
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
 * True when the player cannot reach the part of this item they still lack.
 *
 * Only the shortfall matters: an item with no unlocked source is not a problem
 * if enough of it is already in hand. A farmed item is blocked when none of its
 * nodes is unlocked; a crafted one when any component's own shortfall is
 * blocked, since a recipe needs all of them. This is deliberately not about
 * today's attempts — a node with none left refreshes tomorrow, whereas a locked
 * one is a wall.
 */
export function isUnfarmable(
  item: {
    kind: RequirementKind;
    key: string;
    missing: number;
    components?: readonly AllocatedComponent[] | undefined;
  },
  db: GameDatabase,
  player: PlayerResponse,
): boolean {
  if (item.missing <= 0) return false;
  return isBlocked(item, db, unlockedNodes(player), new Map());
}

/**
 * True when there is no reachable source for this item at all, whatever the
 * player currently holds.
 *
 * {@link isUnfarmable} asks whether the *shortfall* can be reached, so an item
 * fully covered by stock is not flagged. This asks the other question: once
 * that stock is spent, can any more be had? A material with none — no unlocked
 * node, or a recipe that bottoms out in one — is worth spending carefully even
 * while the cupboard is full.
 */
export function isUnobtainable(
  item: Pick<ItemRequirement, 'kind' | 'key'>,
  db: GameDatabase,
  player: PlayerResponse,
): boolean {
  return isBlocked(
    { kind: item.kind, key: item.key },
    db,
    unlockedNodes(player),
    new Map(),
  );
}

function isBlocked(
  item: {
    kind: RequirementKind;
    key: string;
    missing?: number;
    components?: readonly AllocatedComponent[] | undefined;
  },
  db: GameDatabase,
  unlocked: Map<string, unknown>,
  memo: Map<string, boolean>,
): boolean {
  // Nothing left to find is never blocked, whatever the item is.
  if (item.missing !== undefined && item.missing <= 0) return false;

  const source = itemSource(item, db);
  if (source.kind === 'craft' && item.components) {
    // The allocated recipe already accounts for what the player holds, so walk
    // it instead of the raw recipe: a component fully in stock is not a wall.
    return item.components.some((component) =>
      isBlocked({ kind: 'upgrade', ...component }, db, unlocked, memo),
    );
  }

  const seen = memo.get(item.key);
  if (seen !== undefined) return seen;
  // Guard against a recipe cycle before recursing.
  memo.set(item.key, false);

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
