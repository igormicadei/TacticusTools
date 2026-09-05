/**
 * What each plan step costs, where those items come from, and how the ones
 * already held cover the plan.
 */

import { CAMPAIGN_TYPE_NAMES, Rarity, parseRarity, type Rank } from './enums.js';
import type { BattleRef, UnitId } from './ids.js';
import { battleKey } from './ids.js';
import { levelToCompleteRank, type EvolutionPlan, type PlanStep } from './plan.js';
import type { GameDatabase } from './types.js';
import type { PlayerResponse, Unit } from '../types/player.js';

/* -------------------------------------------------------------------------- */
/* Requirements                                                               */
/* -------------------------------------------------------------------------- */

export type RequirementKind = 'upgrade' | 'xp' | 'badge' | 'shard' | 'orb';

/**
 * One upgrade slot a requirement fills.
 *
 * A rank has six of them and the same material often fills more than one, so a
 * requirement carries a list rather than a single position. Without this the
 * pooling below is lossy: "3x Fine Micro-Generator" says nothing about which
 * slots they go in, what those slots raise, or whether the unit is high enough
 * level to fit them.
 */
export interface SlotPlacement {
  rank: Rank;
  /** Which of the rank's six slots, matching the player's `upgrades` indices. */
  slotIndex: number;
  /** Copies this slot consumes. */
  amount: number;
  /** Already fitted, so spent rather than wanted. */
  applied: boolean;
  /** What the slot raises, and by how much. Absent where the table omits it. */
  statType?: string;
  statIncrease?: number;
  /**
   * Level that completes this rank, when one is published.
   *
   * A rank's second row of upgrades is level-gated per upgrade and only the
   * rank's highest threshold is published, so this is the ceiling rather than
   * this slot's own requirement — see `levelToCompleteRank`.
   */
  levelToComplete?: number;
}

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
  /**
   * The upgrade slots this fills, for rank steps. Absent for XP, badges,
   * shards and orbs, none of which go into a slot.
   */
  slots?: SlotPlacement[];
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
      const pooled = new Map<
        string,
        { amount: number; applied: number; slots: SlotPlacement[] }
      >();
      for (let rank = step.from; rank < step.to; rank += 1) {
        const slots = definition?.ranks.find((r) => r.rank === rank)?.upgrades ?? [];
        const filled = rank === unit.rank ? new Set(unit.upgrades) : new Set<number>();
        const gate = levelToCompleteRank(rank as Rank);
        slots.forEach((upgrade, index) => {
          const entry = pooled.get(upgrade.upgradeId) ?? { amount: 0, applied: 0, slots: [] };
          entry.amount += upgrade.amount;
          const isApplied = filled.has(index);
          if (isApplied) entry.applied += upgrade.amount;
          entry.slots.push({
            rank: rank as Rank,
            slotIndex: index,
            amount: upgrade.amount,
            applied: isApplied,
            ...(upgrade.statType !== undefined ? { statType: upgrade.statType } : {}),
            ...(upgrade.statIncrease !== undefined
              ? { statIncrease: upgrade.statIncrease }
              : {}),
            ...(gate !== undefined ? { levelToComplete: gate } : {}),
          });
          pooled.set(upgrade.upgradeId, entry);
        });
      }
      for (const [upgradeId, { amount, applied, slots }] of pooled) {
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
        const fitted = slots.filter((slot) => slot.applied);
        const open = slots.filter((slot) => !slot.applied);
        if (applied > 0) {
          items.push({ ...base, amount: applied, applied: true, slots: fitted });
        }
        if (amount - applied > 0) {
          items.push({ ...base, amount: amount - applied, slots: open });
        }
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
      // A row is the cost of *leaving* its level, not of reaching it: the game
      // asks 1250 gold and 3 Uncommon badges to take an ability from 14 to 15,
      // which is the row at level 14. Reading it as the cost of reaching 15
      // charged the next rung up — 1500 gold and 4 badges.
      for (let level = step.from; level < step.to; level += 1) {
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

/**
 * True when the shortfall of a crafted item can be forged from what is in hand.
 *
 * A crafted item has no farmable form, so "0 of 1" says nothing useful about
 * it: what matters is whether the recipe can be filled. An ingredient counts as
 * held either outright or because it is itself forgeable from what is held,
 * which is why this recurses.
 */
export function canForge(components: readonly AllocatedComponent[]): boolean {
  return components.every(
    (component) =>
      component.missing === 0 ||
      (component.components !== undefined && canForge(component.components)),
  );
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

/* -------------------------------------------------------------------------- */
/* The shopping list, with recipes resolved to what you actually farm          */
/* -------------------------------------------------------------------------- */

/** A base ingredient still to be found, and what it is ultimately for. */
export interface FlatNeed {
  key: string;
  kind: RequirementKind;
  name: string;
  rarity?: Rarity;
  /** Copies still missing, summed across every route that leads here. */
  amount: number;
  /**
   * The forging chain from the slot's own requirement down to this, outermost
   * first. Empty when the requirement is farmed directly.
   */
  via: string[];
  /** The upgrade slots this ultimately serves, for grouping. */
  slots: SlotPlacement[];
}

/**
 * Flatten a step's requirements to the things a player can actually go and get.
 *
 * A plan says "2x Anointed Auxiliary Core", which cannot be farmed — it is
 * forged, sometimes from parts that are themselves forged. What a player takes
 * to a campaign node is the leaves of that tree, and reading them off a
 * two-level recipe by eye is exactly the chore this removes.
 *
 * Only the shortfall is expanded, matching the allocation: parts already in
 * hand need no farming, and a composite already held is not broken down at all.
 * An item with no recipe is its own leaf, whether or not a node drops it —
 * something unfarmable still belongs on the list, because leaving it off would
 * silently shorten the plan.
 */
export function flattenNeeds(items: readonly AllocatedItem[]): FlatNeed[] {
  const pooled = new Map<string, FlatNeed>();

  const push = (
    part: { key: string; name: string; rarity?: Rarity | undefined },
    kind: RequirementKind,
    amount: number,
    via: string[],
    slots: SlotPlacement[],
  ) => {
    if (amount <= 0) return;
    const existing = pooled.get(part.key);
    if (existing) {
      existing.amount += amount;
      // The same leaf can be reached by two routes; keep the shorter to name
      // it by, and merge the slots it serves.
      if (via.length < existing.via.length) existing.via = via;
      for (const slot of slots) {
        if (!existing.slots.some((s) => s.rank === slot.rank && s.slotIndex === slot.slotIndex)) {
          existing.slots.push(slot);
        }
      }
      return;
    }
    pooled.set(part.key, {
      key: part.key,
      kind,
      name: part.name,
      ...(part.rarity !== undefined ? { rarity: part.rarity } : {}),
      amount,
      via,
      slots: [...slots],
    });
  };

  const walk = (
    component: AllocatedComponent,
    kind: RequirementKind,
    via: string[],
    slots: SlotPlacement[],
    // Guards a recipe that names itself, directly or through a loop. Without it
    // one bad row in the tables hangs the page rather than showing a wrong number.
    seen: ReadonlySet<string>,
  ) => {
    if (component.missing <= 0) return;
    if (!component.components?.length || seen.has(component.key)) {
      push(component, kind, component.missing, via, slots);
      return;
    }
    const deeper = new Set(seen).add(component.key);
    for (const child of component.components) {
      walk(child, kind, [...via, component.name], slots, deeper);
    }
  };

  for (const item of items) {
    // Applied materials are spent, not wanted; they never belong on a list of
    // things to go and get.
    if (item.applied || item.missing <= 0) continue;
    const slots = item.slots ?? [];
    if (!item.components?.length) {
      push(item, item.kind, item.missing, [], slots);
      continue;
    }
    for (const child of item.components) {
      walk(child, item.kind, [item.name], slots, new Set([item.key]));
    }
  }

  return [...pooled.values()].sort(
    (a, b) => b.amount - a.amount || a.name.localeCompare(b.name),
  );
}

/* -------------------------------------------------------------------------- */
/* What a plan costs in energy                                                */
/* -------------------------------------------------------------------------- */

/**
 * Energy per copy at the cheapest node the player can actually run.
 *
 * "Can actually run" is the whole point: a locked node's price is not a price
 * the player can pay, so an item farmable only behind locked content costs
 * nothing here and is reported as unpriced instead. A crafted item costs what
 * its ingredients cost, recursively, since there is no node that drops it.
 *
 * `undefined` means no route at all, which is a different thing from expensive
 * and is deliberately not collapsed into a large number — averaging it into a
 * total would quietly turn "you cannot get this" into "this costs a lot".
 */
export function energyPerCopy(
  item: Pick<ItemRequirement, 'kind' | 'key'> & { rarity?: Rarity },
  db: GameDatabase,
  player: PlayerResponse,
  seen: ReadonlySet<string> = new Set(),
): number | undefined {
  if (seen.has(item.key)) return undefined;
  const source = itemSource(item, db);

  if (source.kind === 'craft') {
    const nested = new Set(seen).add(item.key);
    let total = 0;
    for (const component of source.recipe) {
      const each = energyPerCopy(
        {
          kind: 'upgrade',
          key: component.key,
          ...(component.rarity !== undefined ? { rarity: component.rarity } : {}),
        },
        db,
        player,
        nested,
      );
      if (each === undefined) return undefined;
      total += each * component.amount;
    }
    return total;
  }
  if (source.kind !== 'farm') return undefined;

  const open = nodeStatuses(source.nodes, player, db, {
    kind: item.kind,
    ...(item.rarity !== undefined ? { rarity: item.rarity } : {}),
  }).filter((n) => n.unlocked && n.energyPerDrop !== undefined);
  if (open.length === 0) return undefined;
  return Math.min(...open.map((n) => n.energyPerDrop!));
}

/**
 * The raids one slot would cost, and whether today's attempts stretch that far.
 *
 * Energy is not the only thing that runs out. Every campaign node allows a
 * fixed number of runs a day, and a slot that needs six copies of something
 * that drops one run in four wants twenty-four raids the node may not have
 * left. A price in energy says nothing about that: it is an average over
 * unlimited runs, so it happily quotes a figure for work the day cannot hold.
 *
 * So this counts runs instead, against the attempts actually remaining. The
 * slot is flattened to the base materials a node actually drops, and each is
 * taken from its cheapest open node first with every run credited `dropRate`
 * copies — the same expected-value arithmetic the prices use, a forecast
 * rather than a promise.
 *
 * `undefined` means today cannot cover it: either nothing is open that drops
 * the item, or what is open has too few attempts left. That is deliberately
 * not a large number — "come back tomorrow" is a different answer from
 * "expensive", and the caller filters on the difference.
 *
 * Each call assumes it is the only thing you do today. On a page of
 * alternatives that is the right assumption — you are going to pick one — but
 * it does mean two slots drawing on the same node cannot both be believed at
 * once.
 */
export interface RaidPlan {
  /** Runs to make, summed over every node and every ingredient. */
  raids: number;
  /** What those runs cost. Above the expected-value price: a run is indivisible. */
  energy: number;
  /** Nodes the raids are spread across. */
  nodes: number;
}

export function raidsToday(
  item: Pick<ItemRequirement, 'kind' | 'key' | 'name'> & { rarity?: Rarity },
  copies: number,
  db: GameDatabase,
  player: PlayerResponse,
  /**
   * Stock, spent as the flattening descends into a recipe.
   *
   * `copies` is what you still need of `item` itself, already net of what you
   * hold of it; the caller has done that subtraction and doing it again here
   * would credit the same materials twice.
   */
  held: Map<string, number> = ownedByKey(player, db),
): RaidPlan | undefined {
  return raidsForTargets(farmTargets(item, copies, db, player, held));
}

/**
 * {@link raidsToday}, for a list already flattened.
 *
 * The two used to walk the recipe separately, once to price it and once to
 * count runs, which is one walk too many: they consumed the same stock and had
 * to be given separate ledgers to stop them charging it twice. One flattening
 * feeds both, and the run count is then only a question about nodes.
 *
 * Nodes are not contended between targets — a campaign node drops one reward —
 * so each target's attempts can be spent without regard to the others.
 */
export function raidsForTargets(targets: readonly FarmTarget[]): RaidPlan | undefined {
  const plan: RaidPlan = { raids: 0, energy: 0, nodes: 0 };
  for (const target of targets) {
    const open = target.nodes.filter(
      (node) => node.unlocked && node.attemptsLeft > 0 && node.dropRate && node.energyCost !== undefined,
    );
    let need = target.amount;
    for (const node of open) {
      if (need <= 1e-9) break;
      // Cheapest per copy first, then whatever the node has left. Runs are
      // whole: half a raid drops nothing.
      const runs = Math.min(node.attemptsLeft, Math.ceil(need / node.dropRate!));
      if (runs <= 0) continue;
      plan.raids += runs;
      plan.energy += runs * node.energyCost!;
      plan.nodes += 1;
      need -= runs * node.dropRate!;
    }
    if (need > 1e-9) return undefined;
  }
  return plan;
}

/**
 * One base material a slot comes down to, with where to get it and what it costs.
 *
 * {@link FlatNeed} says what to farm; this says where and for how much, which
 * is the other half of the same question and was previously only answered on
 * the plan screen.
 */
export interface FarmTarget extends FlatNeed {
  /** Energy per copy at the cheapest node open now, absent when there is none. */
  energyPerCopy?: number;
  /** Total for this material — `amount * energyPerCopy`. */
  energy?: number;
  /** Where to run for it, unlocked and cheapest per copy first. */
  nodes: NodeStatus[];
}

/**
 * What filling one slot actually sends you out to farm.
 *
 * A slot asks for a material, and the material is often forged from parts that
 * are themselves forged; what a player takes to a campaign node is the leaves
 * of that tree. This is {@link flattenNeeds} pointed at a single requirement
 * rather than a whole step, with each leaf priced and given its nodes.
 *
 * `copies` is the shortfall of `item` itself, already net of what is held of
 * it — the caller has done that subtraction, and this consumes stock only as
 * it descends into a recipe, exactly as {@link raidsToday} does.
 */
export function farmTargets(
  item: Pick<ItemRequirement, 'kind' | 'key' | 'name'> & { rarity?: Rarity },
  copies: number,
  db: GameDatabase,
  player: PlayerResponse,
  held: Map<string, number> = ownedByKey(player, db),
): FarmTarget[] {
  if (copies <= 0) return [];
  const components = allocateComponents(item, copies, db, held, new Set());
  const top: AllocatedItem = {
    ...item,
    amount: copies,
    covered: 0,
    missing: copies,
    ...(components ? { components } : {}),
  };

  return flattenNeeds([top]).map((need) => {
    const each = energyPerCopy(need, db, player);
    const sources = itemSources(need, db) ?? [];
    return {
      ...need,
      ...(each !== undefined ? { energyPerCopy: each, energy: each * need.amount } : {}),
      nodes: nodeStatuses(sources, player, db, {
        kind: need.kind,
        ...(need.rarity !== undefined ? { rarity: need.rarity } : {}),
      }).sort(
        (a, b) =>
          Number(b.unlocked) - Number(a.unlocked) ||
          (a.energyPerDrop ?? Infinity) - (b.energyPerDrop ?? Infinity),
      ),
    };
  });
}

/** What is left to do, counted three ways because they answer different questions. */
export interface FarmingCost {
  /**
   * Upgrade slots still to fill.
   *
   * The unit of work the game itself shows. A plan's remaining effort is more
   * honestly a number of slots than a number of items: six materials that fill
   * one slot are one thing to do, not six.
   */
  slots: number;
  /** Distinct base materials still to find. Experience is not one of them. */
  distinct: number;
  /** Copies of those, summed — the number of drops to farm. */
  copies: number;
  /**
   * Energy those copies cost at the cheapest node currently open.
   *
   * A floor, not a forecast: drop rates are averages, so this is what the
   * farming costs if every run drops at the published rate.
   *
   * Exact, not rounded. Rounding here would be rounding in the middle of an
   * arithmetic the reader can see: a caller that costs six slots separately and
   * shows a total above them would print six figures that do not add up to it.
   * Round once, where it is displayed.
   */
  energy: number;
  /** Copies with no route at all, which are excluded from {@link energy}. */
  unpriced: number;
}

/**
 * Cost a set of allocated requirements in slots, drops and energy.
 *
 * Built on {@link flattenNeeds} rather than on the requirements directly,
 * because "how much is left" asked at a campaign screen means base materials:
 * a plan that wants two Anointed Auxiliary Cores wants no such drop from any
 * node, it wants the twelve things they are forged from.
 */
export function farmingCost(
  items: readonly AllocatedItem[],
  db: GameDatabase,
  player: PlayerResponse,
): FarmingCost {
  let slots = 0;
  for (const item of items) {
    if (item.applied) continue;
    slots += item.slots?.length ?? 0;
  }

  // Experience is measured in points, not in things picked up, so counting it
  // here would put five figures of "drops to farm" on a card and drown the
  // number that means something. Levels are their own step in the plan and are
  // shown as XP there.
  const needs = flattenNeeds(items).filter((need) => need.kind !== 'xp');
  let copies = 0;
  let energy = 0;
  let unpriced = 0;
  for (const need of needs) {
    copies += need.amount;
    const each = energyPerCopy(
      { kind: need.kind, key: need.key, ...(need.rarity !== undefined ? { rarity: need.rarity } : {}) },
      db,
      player,
    );
    if (each === undefined) unpriced += need.amount;
    else energy += each * need.amount;
  }

  return { slots, distinct: needs.length, copies, energy, unpriced };
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
        // A total spans several ranks, so it fills slots in each of them.
        if (item.slots?.length) existing.slots = [...(existing.slots ?? []), ...item.slots];
      } else {
        pooled.set(poolKey, {
          ...item,
          ...(item.slots ? { slots: [...item.slots] } : {}),
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
  /** Energy one run costs. A run is indivisible — see {@link energyPerDrop}. */
  energyCost?: number;
  /** Runs allowed per day. */
  dailyBattleCount?: number;
  /** Chance of the item dropping per run, for the rarity asked about. */
  dropRate?: number;
  /**
   * `energyCost / dropRate` — energy per copy on average.
   *
   * Deliberately separate from {@link energyCost}: an Elite node is cheaper per
   * copy than a Standard one at every rarity, but costs 10 energy a run against
   * 6, so with 8 energy in hand the cheaper node is the one you cannot afford.
   * Both numbers are needed to choose.
   */
  energyPerDrop?: number;
}

/**
 * Drop-rate key for a rarity, as the published table names them.
 *
 * Indexed by {@link Rarity}, and deliberately one short: the table has no
 * Mythic column, so a Mythic item reports no rate rather than borrowing one.
 */
const DROP_RATE_KEYS: readonly ('common' | 'uncommon' | 'rare' | 'epic' | 'legendary')[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
];

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

/**
 * Campaign names that more than one campaign answers to.
 *
 * Each of the six event campaigns runs a Standard and an Extremis track under
 * one name, so "Adeptus Mechanicus node 3" alone names two different battles.
 */
function ambiguousCampaignNames(db: GameDatabase): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const { name } of Object.values(db.campaigns)) {
    if (name === undefined) continue;
    if (seen.has(name)) shared.add(name);
    seen.add(name);
  }
  return shared;
}

/** Annotate nodes with whether the player can run them, and how often today. */
export function nodeStatuses(
  refs: readonly BattleRef[],
  player: PlayerResponse,
  db: GameDatabase,
  /**
   * What is being farmed here, so the node can report the rate that applies.
   * Shards use the shard rate; an upgrade uses its rarity's.
   */
  looking?: { kind: RequirementKind; rarity?: Rarity },
): NodeStatus[] {
  const progress = unlockedNodes(player);
  const ambiguous = ambiguousCampaignNames(db);
  // Sources can list the same node twice; collapse them so the list is honest.
  const unique = new Map<string, BattleRef>();
  for (const ref of refs) unique.set(`${ref.campaignId}#${ref.battleIndex}`, ref);

  return [...unique.values()]
    .map((ref) => {
      const hit = progress.get(`${ref.campaignId}#${ref.battleIndex}`);
      const campaign = db.campaigns[ref.campaignId];
      // Only the ambiguous ones take the suffix: several campaigns already
      // carry their type in the name, and "Indomitus Mirror Mirror" helps
      // nobody.
      const track =
        campaign?.type !== undefined ? CAMPAIGN_TYPE_NAMES[campaign.type] : undefined;
      const campaignName =
        campaign?.name === undefined
          ? ref.campaignId
          : ambiguous.has(campaign.name) && track !== undefined
            ? `${campaign.name} ${track}`
            : campaign.name;
      const battle = campaign?.battles[battleKey(ref)];
      const rateKey =
        looking?.kind === 'shard'
          ? 'shard'
          : looking?.rarity !== undefined
            ? DROP_RATE_KEYS[looking.rarity]
            : undefined;
      const dropRate = rateKey ? battle?.dropRates?.[rateKey] : undefined;
      const energyCost = campaign?.energyCost;

      return {
        ...ref,
        unlocked: hit !== undefined,
        attemptsLeft: hit?.attemptsLeft ?? 0,
        attemptsUsed: hit?.attemptsUsed ?? 0,
        campaignName,
        ...(energyCost !== undefined ? { energyCost } : {}),
        ...(campaign?.dailyBattleCount !== undefined
          ? { dailyBattleCount: campaign.dailyBattleCount }
          : {}),
        ...(dropRate !== undefined ? { dropRate } : {}),
        ...(energyCost !== undefined && dropRate
          ? { energyPerDrop: energyCost / dropRate }
          : {}),
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
