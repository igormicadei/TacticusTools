/**
 * One running order across every plan, and what to farm with the energy in hand.
 *
 * A plan on its own says what a unit needs. Several plans together raise two
 * questions a single plan cannot answer: which unit to work on next, and who
 * gets the shared stock when both need the same material. This module answers
 * both, and then the narrower question of what a fixed amount of energy buys
 * today.
 */

import type { Rank, Rarity } from './enums.js';
import { rankName } from './enums.js';
import type { UnitId } from './ids.js';
import { battleKey } from './ids.js';
import type { EvolutionPlan, PlanStep } from './plan.js';
import {
  energyPerCopy,
  farmingCost,
  flattenNeeds,
  type FarmingCost,
  allocateHoldings,
  isUnfarmable,
  itemSource,
  nodeStatuses,
  ownedByKey,
  planCosts,
  type AllocatedItem,
  type ItemRequirement,
  type NodeStatus,
  type StepCost,
} from './requirements.js';
import type { GameDatabase } from './types.js';
import type { PlayerResponse, Unit } from '../types/player.js';

/* -------------------------------------------------------------------------- */
/* Effort                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What a material with no way to farm it counts as, against 1 for one you can
 * go and get.
 *
 * Badges and orbs earn it outright — no campaign node yields them, so they
 * arrive from chests and events on their own schedule. A farmed item earns it
 * only when none of its nodes is unlocked, which is a property of the player,
 * not of the item: a unit's shards may be a wall for one roster and a daily run
 * for another.
 */
export const UNREACHABLE_WEIGHT = 5;

/** Experience never discriminates between two steps, so it is not counted. */
const FREE_KINDS = new Set(['xp']);

function unlockedNodeKeys(player: PlayerResponse): Set<string> {
  const keys = new Set<string>();
  for (const campaign of player.player.progress.campaigns) {
    for (const battle of campaign.battles) keys.add(`${campaign.id}#${battle.battleIndex}`);
  }
  return keys;
}

/**
 * Effort per copy of an item, used only to order bundles.
 *
 * A crafted item is worth what its recipe is worth, recursively — that is the
 * work actually in front of you.
 */
function itemWeight(
  item: Pick<ItemRequirement, 'kind' | 'key'>,
  db: GameDatabase,
  unlocked: ReadonlySet<string>,
  seen: ReadonlySet<string> = new Set(),
): number {
  if (FREE_KINDS.has(item.kind)) return 0;
  if (seen.has(item.key)) return UNREACHABLE_WEIGHT;

  const source = itemSource(item, db);
  switch (source.kind) {
    case 'other':
    case 'none':
      return UNREACHABLE_WEIGHT;
    case 'farm':
      return source.nodes.some((n) => unlocked.has(`${n.campaignId}#${n.battleIndex}`))
        ? 1
        : UNREACHABLE_WEIGHT;
    case 'craft': {
      const nested = new Set(seen).add(item.key);
      return source.recipe.reduce(
        (total, component) =>
          total + component.amount * itemWeight({ kind: 'upgrade', key: component.key }, db, unlocked, nested),
        0,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Bundles                                                                    */
/* -------------------------------------------------------------------------- */

export interface TimelinePlan {
  id: string;
  unit: Unit;
  /** Already marked for progress, so finished steps are flagged. */
  plan: EvolutionPlan;
  name?: string | undefined;
}

/**
 * A run of steps ending at a rank, with whatever it depends on carried along.
 *
 * Rank is the axis worth levelling a roster on: it is the part you farm for,
 * and it is comparable between units in a way a mixed bag of ability levels and
 * ascensions is not. So the timeline is built from bundles that each end at a
 * rank-up, and an ascension or level-up standing in the way of one belongs to
 * it. That is what puts a unit needing an ascension behind units that can reach
 * the same rank without one — its bundle costs more, not because of a rule
 * about ascensions.
 */
export interface TimelineBundle {
  planId: string;
  unitId: UnitId;
  unitName: string;
  /** Rank this bundle reaches, absent for steps trailing the last rank-up. */
  targetRank?: Rank;
  /** Rank the bundle sorts on: its target, or the unit's own when it has none. */
  sortRank: number;
  label: string;
  steps: PlanStep[];
  items: AllocatedItem[];
  gold: number;
  /** Weighted effort, the tie-break within a rank. */
  effort: number;
  /** Copies still to find once the whole timeline has been allocated. */
  missing: number;
  /** Of those, how many have nowhere to come from. */
  unreachable: number;
}

export interface PlanSummary {
  /**
   * Copies of the *named* requirements still short.
   *
   * Kept, but not what a card should lead with: it is neither the number of
   * slots the game shows nor the number of drops to farm, so read on its own
   * it answers a question nobody asked. See {@link PlanSummary.cost}.
   */
  missing: number;
  unreachable: number;
  bundles: number;
  gold: number;
  /** Slots to fill, drops to farm, and what those cost in energy. */
  cost: FarmingCost;
}

export interface Timeline {
  bundles: TimelineBundle[];
  /** Per plan id, for the cards. */
  byPlan: Map<string, PlanSummary>;
}

/** Split a plan's outstanding steps into bundles that each end at a rank-up. */
function bundleSteps(costs: StepCost[]): { steps: PlanStep[]; costs: StepCost[]; targetRank?: Rank }[] {
  const bundles: { steps: PlanStep[]; costs: StepCost[]; targetRank?: Rank }[] = [];
  let steps: PlanStep[] = [];
  let group: StepCost[] = [];

  for (const cost of costs) {
    steps.push(cost.step);
    group.push(cost);
    if (cost.step.kind === 'rank') {
      bundles.push({ steps, costs: group, targetRank: cost.step.to as Rank });
      steps = [];
      group = [];
    }
  }
  // Ability and level targets beyond the last rank-up have no rank to sort on.
  if (steps.length > 0) bundles.push({ steps, costs: group });
  return bundles;
}

/**
 * Build one running order across every plan.
 *
 * Bundles are ordered by the rank they reach, then by effort, so the roster
 * comes up together and the cheapest way to each rank is taken first. Stock is
 * then spread across that order, which is the point: two plans scored on their
 * own both claim the same materials, and only an order can decide between them.
 *
 * The effort used to sort is measured against the player's whole inventory,
 * independent of the other plans — it has to be, since the order it produces is
 * what decides the real allocation. The counts reported back come from that
 * allocation, not from this estimate.
 */
export function buildTimeline(
  plans: readonly TimelinePlan[],
  player: PlayerResponse,
  db: GameDatabase,
): Timeline {
  const owned = ownedByKey(player, db);
  const unlocked = unlockedNodeKeys(player);

  interface Pending {
    plan: TimelinePlan;
    steps: PlanStep[];
    costs: StepCost[];
    targetRank?: Rank;
    sortRank: number;
    effort: number;
  }

  const pending: Pending[] = [];
  for (const entry of plans) {
    const outstanding = { ...entry.plan, steps: entry.plan.steps.filter((s) => !s.done) };
    if (outstanding.steps.length === 0) continue;
    const costs = planCosts(entry.unit, outstanding, db);

    for (const bundle of bundleSteps(costs)) {
      let effort = 0;
      for (const cost of bundle.costs) {
        for (const item of cost.items) {
          if (item.applied) continue;
          const short = Math.max(0, item.amount - (owned.get(item.key) ?? 0));
          effort += short * itemWeight(item, db, unlocked);
        }
      }
      pending.push({
        plan: entry,
        steps: bundle.steps,
        costs: bundle.costs,
        ...(bundle.targetRank !== undefined ? { targetRank: bundle.targetRank } : {}),
        sortRank: bundle.targetRank ?? entry.unit.rank,
        effort,
      });
    }
  }

  pending.sort(
    (a, b) =>
      a.sortRank - b.sortRank ||
      a.effort - b.effort ||
      (a.plan.unit.name ?? a.plan.unit.id).localeCompare(b.plan.unit.name ?? b.plan.unit.id),
  );

  // One shared pool, drawn in the order just fixed.
  const remaining = new Map(owned);
  const bundles: TimelineBundle[] = [];
  const byPlan = new Map<string, PlanSummary>();
  // Distinct materials cannot be summed across bundles — the same ore appears
  // in several — so the union is collected here and counted at the end.
  const materialsByPlan = new Map<string, Set<string>>();

  for (const entry of pending) {
    const allocated = allocateHoldings(entry.costs, remaining, db);
    for (const step of allocated) {
      for (const item of step.items) {
        if (item.applied) continue;
        // allocateHoldings works on a copy, so spend from the shared pool here.
        remaining.set(item.key, (remaining.get(item.key) ?? 0) - item.covered);
        for (const component of item.components ?? []) spendComponents(component, remaining);
      }
    }

    const items = allocated.flatMap((s) => s.items);
    const gold = entry.costs.reduce((n, c) => n + c.gold, 0);
    let missing = 0;
    let unreachable = 0;
    for (const item of items) {
      if (item.applied) continue;
      missing += item.missing;
      // Effort and reachability are different questions. Six ore for one lump
      // is six runs of work, not a wall; only a shortfall with no route at all
      // counts here, which is what isUnfarmable decides.
      if (isUnfarmable(item, db, player)) unreachable += item.missing;
    }

    const label =
      entry.targetRank !== undefined
        ? rankName(entry.targetRank)
        : (entry.steps[0]?.label ?? 'Finishing touches');

    bundles.push({
      planId: entry.plan.id,
      unitId: entry.plan.unit.id,
      unitName: entry.plan.unit.name ?? entry.plan.unit.id,
      ...(entry.targetRank !== undefined ? { targetRank: entry.targetRank } : {}),
      sortRank: entry.sortRank,
      label,
      steps: entry.steps,
      items,
      gold,
      effort: entry.effort,
      missing,
      unreachable,
    });

    // Costed per bundle and summed, not costed once over the whole plan: the
    // holdings pool is spent as the timeline walks it, so a later bundle's
    // shortfall already accounts for what an earlier one took.
    const cost = farmingCost(items, db, player);
    const summary = byPlan.get(entry.plan.id) ?? {
      missing: 0,
      unreachable: 0,
      bundles: 0,
      gold: 0,
      cost: { slots: 0, distinct: 0, copies: 0, energy: 0, unpriced: 0 },
    };
    summary.missing += missing;
    summary.unreachable += unreachable;
    summary.bundles += 1;
    summary.gold += gold;
    summary.cost.slots += cost.slots;
    summary.cost.copies += cost.copies;
    summary.cost.energy += cost.energy;
    summary.cost.unpriced += cost.unpriced;
    byPlan.set(entry.plan.id, summary);

    const seen = materialsByPlan.get(entry.plan.id) ?? new Set<string>();
    for (const need of flattenNeeds(items)) seen.add(need.key);
    materialsByPlan.set(entry.plan.id, seen);
  }

  for (const [planId, materials] of materialsByPlan) {
    const summary = byPlan.get(planId);
    if (summary) summary.cost.distinct = materials.size;
  }

  return { bundles, byPlan };
}

function spendComponents(
  component: { key: string; covered: number; components?: readonly { key: string; covered: number; components?: unknown }[] },
  remaining: Map<string, number>,
): void {
  remaining.set(component.key, (remaining.get(component.key) ?? 0) - component.covered);
  for (const child of component.components ?? []) {
    spendComponents(child as Parameters<typeof spendComponents>[0], remaining);
  }
}

/* -------------------------------------------------------------------------- */
/* Energy                                                                     */
/* -------------------------------------------------------------------------- */

export type StatPriority = 'health' | 'damage' | 'armour';

/** Maps a source `statType` onto the stat it raises. */
const STAT_OF: Record<string, StatPriority> = {
  hp: 'health',
  dmg: 'damage',
  fixedArmor: 'armour',
};

export interface EnergyCandidate {
  unitId: UnitId;
  unitName: string;
  itemKey: string;
  itemName: string;
  rarity?: Rarity;
  stat: StatPriority;
  /** Stat points gained when this upgrade is fitted. */
  gain: number;
  /** Copies still to find. */
  copies: number;
  /** Energy per copy at the cheapest node currently open. */
  energyPerCopy: number;
  /** `copies * energyPerCopy` — the whole slot, since a part-filled one gives nothing. */
  energy: number;
  /** Stat points per energy, the ordering key. */
  ratio: number;
  /** Where to run, cheapest per copy first. */
  nodes: NodeStatus[];
}

export interface EnergyPlan {
  picks: EnergyCandidate[];
  /** Ranked below the cut, or out of budget. */
  rest: EnergyCandidate[];
  energyUsed: number;
  energyBudget: number;
  gain: number;
}

/** Nodes for an item, cheapest per copy first, unlocked ones ahead of locked. */
function rankedNodes(
  item: Pick<ItemRequirement, 'kind' | 'key'> & { rarity?: Rarity },
  db: GameDatabase,
  player: PlayerResponse,
): NodeStatus[] {
  const source = itemSource(item, db);
  if (source.kind !== 'farm') return [];
  return nodeStatuses(source.nodes, player, db, {
    kind: item.kind,
    ...(item.rarity !== undefined ? { rarity: item.rarity } : {}),
  }).sort(
    (a, b) =>
      Number(b.unlocked) - Number(a.unlocked) ||
      (a.energyPerDrop ?? Infinity) - (b.energyPerDrop ?? Infinity),
  );
}

/**
 * What each unit could still fit at the rank it is on now.
 *
 * Only the current rank's slots can be filled, so only they can raise a stat
 * today — an upgrade for a rank two steps away buys nothing until you get
 * there. That is what makes this answerable: a fixed list of slots, each with a
 * known stat gain and a known energy price.
 */
export function energyCandidates(
  units: readonly Unit[],
  player: PlayerResponse,
  db: GameDatabase,
  options: { priority?: StatPriority; perUnit?: ReadonlyMap<UnitId, StatPriority> } = {},
): EnergyCandidate[] {
  const owned = ownedByKey(player, db);
  const remaining = new Map(owned);
  const candidates: EnergyCandidate[] = [];

  for (const unit of units) {
    const wanted = options.perUnit?.get(unit.id) ?? options.priority;
    const slots = db.units[unit.id]?.ranks.find((r) => r.rank === unit.rank)?.upgrades ?? [];
    const filled = new Set(unit.upgrades);

    slots.forEach((slot, index) => {
      if (filled.has(index)) return;
      const stat = slot.statType ? STAT_OF[slot.statType] : undefined;
      const gain = slot.statIncrease ?? 0;
      if (!stat || gain <= 0) return;
      if (wanted && stat !== wanted) return;

      const upgrade = db.upgrades[slot.upgradeId];
      const item = {
        kind: 'upgrade' as const,
        key: `upgrade:${slot.upgradeId}`,
        ...(upgrade?.rarity !== undefined ? { rarity: upgrade.rarity } : {}),
      };

      // Stock is spread across candidates as they are found, so two slots
      // wanting the same material do not both count it as theirs.
      const have = remaining.get(item.key) ?? 0;
      const used = Math.min(have, slot.amount);
      remaining.set(item.key, have - used);
      const copies = slot.amount - used;
      if (copies <= 0) return;

      const each = energyPerCopy(item, db, player);
      if (each === undefined) return;

      const energy = copies * each;
      candidates.push({
        unitId: unit.id,
        unitName: unit.name ?? unit.id,
        itemKey: item.key,
        itemName: upgrade?.name ?? slot.upgradeId,
        ...(upgrade?.rarity !== undefined ? { rarity: upgrade.rarity } : {}),
        stat,
        gain,
        copies,
        energyPerCopy: each,
        energy,
        ratio: gain / energy,
        nodes: rankedNodes(item, db, player),
      });
    });
  }

  return candidates.sort((a, b) => b.ratio - a.ratio || a.energy - b.energy);
}

/**
 * Pick what to farm with the energy in hand.
 *
 * A slot is all or nothing — three of four copies raises nothing — so this is a
 * 0/1 choice per slot, taken greedily by stat gained per energy. Greedy rather
 * than exact on purpose: the prices are expected values over published drop
 * rates, so a solver's extra precision would be false precision. What it does
 * guarantee is that nothing above the cut is skipped for something below it.
 */
export function planEnergy(
  candidates: readonly EnergyCandidate[],
  energyBudget: number,
): EnergyPlan {
  const picks: EnergyCandidate[] = [];
  const rest: EnergyCandidate[] = [];
  let energyUsed = 0;
  let gain = 0;

  for (const candidate of candidates) {
    if (energyUsed + candidate.energy <= energyBudget) {
      picks.push(candidate);
      energyUsed += candidate.energy;
      gain += candidate.gain;
    } else {
      rest.push(candidate);
    }
  }

  return { picks, rest, energyUsed, energyBudget, gain };
}

export { battleKey };
