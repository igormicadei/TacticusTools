/**
 * Where the server keeps what it is asked to remember.
 *
 * The web app keeps the roster, plans and teams in the browser's
 * `localStorage`, which a process outside the browser cannot read — so this is
 * a second store rather than a window onto that one. The files use the shapes
 * the app uses, so a roster fetched here is the same JSON the app imports and a
 * plan written here would load in it unchanged.
 *
 * Nothing is kept anywhere but the data directory, and the API key is not kept
 * at all: it is read from the environment on each call that needs it.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `~/.tacticus-tools` unless told otherwise. */
export const dataDir = (): string =>
  process.env.TACTICUS_TOOLS_DATA
    ? resolve(process.env.TACTICUS_TOOLS_DATA)
    : join(homedir(), '.tacticus-tools');

/**
 * The game database, from the snapshot the web app ships.
 *
 * Deliberately the file rather than `loadGameDatabase`, which goes to the
 * network: this server should answer the same numbers the app shows, offline,
 * and a database that drifted from the app's would make the two disagree about
 * the same roster.
 */
export const gameDataPath = (): string =>
  process.env.TACTICUS_GAMEDATA
    ? resolve(process.env.TACTICUS_GAMEDATA)
    : join(HERE, '..', '..', 'ui', 'public', 'gamedata.json');

export const PLAYER_FILE = 'player.json';
export const PLANS_FILE = 'plans.json';
export const TEAMS_FILE = 'teams.json';

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(dataDir(), file), 'utf8')) as T;
  } catch {
    // A missing file is "nothing stored yet"; a corrupt one is reported by the
    // caller that needed it rather than crashing the server on startup.
    return fallback;
  }
}

/** Written through a temporary file, so a crash mid-write cannot truncate it. */
async function writeJson(file: string, value: unknown): Promise<void> {
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  const target = join(dir, file);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, target);
}

export interface StoredPlan {
  id: string;
  unitId: string;
  target: Record<string, unknown>;
  origin?: unknown;
  priority?: string | undefined;
  createdAt: number;
}

export interface StoredTeam {
  id: string;
  name: string;
  memberIds: string[];
  capRarity?: number | undefined;
  battleKey?: string | undefined;
  createdAt: number;
}

export const store = {
  readPlayerText: async (): Promise<string | undefined> => {
    try {
      return await readFile(join(dataDir(), PLAYER_FILE), 'utf8');
    } catch {
      return undefined;
    }
  },
  writePlayerText: async (text: string): Promise<void> => {
    const dir = dataDir();
    await mkdir(dir, { recursive: true });
    const target = join(dir, PLAYER_FILE);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, text, 'utf8');
    await rename(temporary, target);
  },
  readPlans: (): Promise<StoredPlan[]> => readJson<StoredPlan[]>(PLANS_FILE, []),
  writePlans: (plans: StoredPlan[]): Promise<void> => writeJson(PLANS_FILE, plans),
  readTeams: (): Promise<StoredTeam[]> => readJson<StoredTeam[]>(TEAMS_FILE, []),
  writeTeams: (teams: StoredTeam[]): Promise<void> => writeJson(TEAMS_FILE, teams),
};

/** The key the API wants, from the environment. Never read from disk. */
export function apiKey(): string {
  const key = process.env.TACTICUS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'No API key. Set TACTICUS_API_KEY in the server\'s environment — it is read per call and never written to disk.',
    );
  }
  return key;
}

/** The relay that adds the CORS headers the API omits, when one is configured. */
export const relayUrl = (): string | undefined =>
  process.env.TACTICUS_RELAY_URL?.trim().replace(/\/+$/, '') || undefined;
