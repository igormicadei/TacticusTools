/**
 * Every unit's plan, kept in `localStorage` alongside the roster.
 *
 * A unit has exactly one plan, and every unit has one by definition — a unit
 * nobody has touched simply has the default, empty target. Nothing is stored
 * for that case: `save()` deletes an entry that has gone back to default
 * rather than keeping a blank row, so what is in storage and what is worth
 * showing on the Plans list are the same set by construction.
 *
 * The steps are recomputed from the current roster on every view, so a plan
 * stays honest as the unit progresses rather than freezing a stale route.
 */

import type { EvolutionTarget, UnitState } from '@lib/gamedata/plan.js';
import type { ItemTarget } from '@lib/gamedata/itemPlan.js';
import type { StatPriority } from '@lib/gamedata/timeline.js';

const STORAGE_KEY = 'tacticus-tools:plans';

export interface StoredPlan {
  /** Always equal to `unitId` — a plan is keyed by the unit it belongs to. */
  id: string;
  unitId: string;
  /** Optional label; the unit name is used when absent. Cleared by setting undefined. */
  name?: string | undefined;
  target: EvolutionTarget;
  /**
   * The unit's state when the plan was made.
   *
   * Steps are recomputed from the live roster on every view, so without this
   * a step would simply vanish the moment it was finished. Anchoring the route
   * here keeps completed steps on the page, marked done. Plans saved before
   * this existed pick it up the first time they are opened, so they track
   * progress from that point rather than from their creation.
   */
  origin?: UnitState;
  /**
   * Which attribute to favour for this unit when spending energy.
   *
   * Health, damage and armour are not comparable — there is no published power
   * formula to convert between them — so the choice is the player's, per unit.
   */
  priority?: StatPriority | undefined;
  /**
   * Equipment goals for this unit: what to put in a slot, and at what level.
   *
   * Kept alongside the rank/rarity target rather than as a plan of its own,
   * since both are the same thing a player already thinks of as "this unit's
   * plan" — one screen, one edit, one place to look.
   */
  itemTargets?: ItemTarget[] | undefined;
  createdAt: number;
}

function readAll(): StoredPlan[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // `id` was once a random id of its own, from before a unit could have
    // only one plan. `unitId` was always the authority on whose plan this is,
    // so trusting it here — rather than whatever `id` happened to be saved
    // as — makes an entry from that era resolve correctly without a
    // migration step: the very next read already agrees with `save()`.
    return (parsed as StoredPlan[]).map((p) => ({ ...p, id: p.unitId }));
  } catch {
    // A corrupt entry reads as "no plans" rather than breaking the page.
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function writeAll(plans: StoredPlan[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

/** No target set and no equipment goal — the state every unit starts in. */
function isDefault(plan: Pick<StoredPlan, 'target' | 'itemTargets'>): boolean {
  return Object.keys(plan.target).length === 0 && (plan.itemTargets?.length ?? 0) === 0;
}

/** A fresh, unsaved plan for a unit nothing has been asked of yet. */
function defaultPlan(unitId: string): StoredPlan {
  return { id: unitId, unitId, target: {}, createdAt: 0 };
}

export const plansStore = {
  /** Every unit with an actual target set — a default plan is not listed. */
  list(): StoredPlan[] {
    return readAll()
      .filter((p) => !isDefault(p))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
  /** This unit's plan, defaulted when nothing is stored — every unit has one. */
  get(unitId: string): StoredPlan {
    return readAll().find((p) => p.unitId === unitId) ?? defaultPlan(unitId);
  },
  /**
   * The only write. Merges `patch` onto whatever is stored (or the default),
   * then stores the result — unless the result is back to default, in which
   * case the entry is removed rather than kept as an empty row.
   */
  save(unitId: string, patch: Partial<Omit<StoredPlan, 'id' | 'unitId'>>): StoredPlan {
    const all = readAll();
    const existing = all.find((p) => p.unitId === unitId);
    const merged: StoredPlan = {
      ...(existing ?? defaultPlan(unitId)),
      ...patch,
      id: unitId,
      unitId,
      createdAt: existing?.createdAt || Date.now(),
    };
    const rest = all.filter((p) => p.unitId !== unitId);
    writeAll(isDefault(merged) ? rest : [...rest, merged]);
    return merged;
  },
  /** Back to default: removes whatever is stored for this unit, if anything. */
  reset(unitId: string): void {
    writeAll(readAll().filter((p) => p.unitId !== unitId));
  },
};

const PRIORITY_KEY = 'tacticus-tools:plans-priority';

/**
 * The player's own farming-priority order — which plan's shared materials
 * get claimed first when the Farming Plan tab's "Custom order" is on.
 *
 * A plan id not in this list sorts after every id that is, in whatever order
 * the caller's own automatic heuristic already puts it — so nudging one
 * plan to the front never requires ranking the rest of the roster first.
 * `movePriority` grows the list lazily for exactly that reason: a plan only
 * gets an explicit entry the first time someone actually moves it.
 */
export function readPriorityOrder(): string[] {
  try {
    const raw = localStorage.getItem(PRIORITY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
    }
  } catch {
    /* Private mode, or a corrupt value — an empty order still works. */
  }
  return [];
}

/**
 * Move a plan one step up or down the priority order, against the full,
 * currently-visible order the caller passes (not just the stored one — a
 * plan never yet moved has no entry to swap, so the caller's own current
 * ordering, automatic-sort ids included, is what decides its neighbour).
 */
export function movePriority(
  planId: string,
  direction: 'up' | 'down',
  currentOrder: readonly string[],
): void {
  const index = currentOrder.indexOf(planId);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= currentOrder.length) return;
  const next = [...currentOrder];
  [next[index], next[swapWith]] = [next[swapWith]!, next[index]!];
  try {
    localStorage.setItem(PRIORITY_KEY, JSON.stringify(next));
  } catch {
    /* Private mode, or storage disabled — the move still applies for this render. */
  }
}

const VIEW_KEY = 'tacticus-tools:plans-view';

/**
 * The Plans list's own sort choice, read independently of that page.
 *
 * Used to order allocation on the shopping list: when two plans want the same
 * loose copy of an item, the one earlier in the Plans list's current order
 * claims it, so resorting that list is how a player reprioritises without a
 * second control to learn. Only `name` and `created` are honoured here —
 * `energy` and `steps` need a plan's resolved timeline to sort by, which is
 * more than an allocation order justifies computing twice, so both fall back
 * to `created`.
 */
export function readPlansSort(): 'created' | 'name' {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { sort?: string };
      if (parsed.sort === 'name') return 'name';
    }
  } catch {
    /* Private mode, or a corrupt value — the default still works. */
  }
  return 'created';
}
