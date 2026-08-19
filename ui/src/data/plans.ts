/**
 * Saved evolution plans, kept in `localStorage` alongside the roster.
 *
 * A plan stores only the unit and the target. The steps are recomputed from the
 * current roster on every view, so a plan stays honest as the unit progresses
 * rather than freezing a stale route.
 */

import type { EvolutionTarget } from '@lib/gamedata/plan.js';

const STORAGE_KEY = 'tacticus-tools:plans';

export interface StoredPlan {
  id: string;
  unitId: string;
  /** Optional label; the unit name is used when absent. Cleared by setting undefined. */
  name?: string | undefined;
  target: EvolutionTarget;
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
