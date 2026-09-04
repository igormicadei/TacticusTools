/**
 * Saved teams, kept in `localStorage` alongside the roster and the plans.
 *
 * A team stores only ids and the two settings that change what it means — the
 * rarity cap and the battle it is meant for. Stats, caps and equipment are
 * recomputed from the live roster on every view, so a team stays honest as the
 * units behind it progress rather than freezing yesterday's numbers.
 */

import type { Rarity } from '@lib/gamedata/enums.js';

const STORAGE_KEY = 'tacticus-tools:teams';

export interface StoredTeam {
  id: string;
  name: string;
  memberIds: string[];
  /** Rarity the team is played at, when a mode caps it. */
  capRarity?: Rarity | undefined;
  /** `battleKey(ref)` of the node this team is built for. */
  battleKey?: string | undefined;
  createdAt: number;
}

function readAll(): StoredTeam[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredTeam[]) : [];
  } catch {
    // A corrupt entry reads as "no teams" rather than breaking the page.
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function writeAll(teams: StoredTeam[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
}

export const teamsStore = {
  list(): StoredTeam[] {
    return readAll().sort((a, b) => b.createdAt - a.createdAt);
  },
  get(id: string): StoredTeam | undefined {
    return readAll().find((team) => team.id === id);
  },
  create(team: Omit<StoredTeam, 'id' | 'createdAt'>): StoredTeam {
    const created: StoredTeam = {
      ...team,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };
    writeAll([...readAll(), created]);
    return created;
  },
  update(id: string, changes: Partial<Omit<StoredTeam, 'id' | 'createdAt'>>): void {
    writeAll(readAll().map((team) => (team.id === id ? { ...team, ...changes } : team)));
  },
  remove(id: string): void {
    writeAll(readAll().filter((team) => team.id !== id));
  },
};
