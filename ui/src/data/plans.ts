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
    return Array.isArray(parsed) ? (parsed as StoredPlan[]) : [];
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
