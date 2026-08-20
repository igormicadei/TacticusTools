/**
 * Saved evolution plans, kept in `localStorage` alongside the roster.
 *
 * A plan stores only the unit and the target. The steps are recomputed from the
 * current roster on every view, so a plan stays honest as the unit progresses
 * rather than freezing a stale route.
 */

import type { EvolutionTarget, UnitState } from '@lib/gamedata/plan.js';
import type { StatPriority } from '@lib/gamedata/timeline.js';

const STORAGE_KEY = 'tacticus-tools:plans';

export interface StoredPlan {
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

export const plansStore = {
  list(): StoredPlan[] {
    return readAll().sort((a, b) => b.createdAt - a.createdAt);
  },
  get(id: string): StoredPlan | undefined {
    return readAll().find((p) => p.id === id);
  },
  create(plan: Omit<StoredPlan, 'id' | 'createdAt'>): StoredPlan {
    const created: StoredPlan = {
      ...plan,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    writeAll([...readAll(), created]);
    return created;
  },
  update(id: string, patch: Partial<Omit<StoredPlan, 'id'>>): void {
    writeAll(readAll().map((p) => (p.id === id ? { ...p, ...patch } : p)));
  },
  remove(id: string): void {
    writeAll(readAll().filter((p) => p.id !== id));
  },
};
