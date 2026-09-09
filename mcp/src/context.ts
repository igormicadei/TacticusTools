/**
 * The three things nearly every tool needs, loaded once and reused.
 *
 * The database is 4 MB of JSON and building roster units computes stats for
 * every one of them; doing that per tool call would make a conversation of
 * twenty questions twenty times slower than it needs to be. The player file is
 * re-read whenever it changes on disk, so a refresh in one call is visible to
 * the next without restarting the server.
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  RosterUnit,
  buildRosterUnits,
  ownedByKey,
  type GameDatabase,
} from '../../dist/gamedata/index.js';
import type { PlayerResponse } from '../../dist/types/player.js';

import { PLAYER_FILE, dataDir, gameDataPath, store } from './store.js';

let database: GameDatabase | undefined;

export async function db(): Promise<GameDatabase> {
  if (!database) {
    const path = gameDataPath();
    try {
      database = JSON.parse(await readFile(path, 'utf8')) as GameDatabase;
    } catch (error) {
      throw new Error(
        `Could not read the game database at ${path}. Point TACTICUS_GAMEDATA at a gamedata.json, ` +
          `or run "npm run build && npm run gamedata:snapshot" in the repository. (${String(error)})`,
      );
    }
  }
  return database;
}

interface Loaded {
  player: PlayerResponse;
  roster: RosterUnit[];
  owned: Map<string, number>;
}

let loaded: Loaded | undefined;
let loadedFrom: number | undefined;

/** The stored roster, rebuilt when the file on disk has changed since last time. */
export async function player(): Promise<Loaded> {
  let modified: number | undefined;
  try {
    modified = (await stat(join(dataDir(), PLAYER_FILE))).mtimeMs;
  } catch {
    modified = undefined;
  }
  if (loaded && modified === loadedFrom) return loaded;

  const text = await store.readPlayerText();
  if (text === undefined) {
    throw new Error(
      `No roster stored yet. Call refresh_roster to fetch one, or put an API response at ${join(dataDir(), PLAYER_FILE)}.`,
    );
  }
  let response: PlayerResponse;
  try {
    response = JSON.parse(text) as PlayerResponse;
  } catch {
    throw new Error(`The stored roster at ${join(dataDir(), PLAYER_FILE)} is not valid JSON.`);
  }
  if (!response?.player?.units) {
    throw new Error('The stored roster has no player.units — it is not an API player response.');
  }

  const database = await db();
  loaded = {
    player: response,
    roster: buildRosterUnits(response, database),
    owned: ownedByKey(response, database),
  };
  loadedFrom = modified;
  return loaded;
}

/** Drop the cached roster, so the next read picks up a file written just now. */
export function forgetPlayer(): void {
  loaded = undefined;
  loadedFrom = undefined;
}

/** Resolve a unit by id or by name, since a person naming one will use the name. */
export function findUnit(roster: readonly RosterUnit[], idOrName: string): RosterUnit {
  const wanted = idOrName.trim().toLowerCase();
  const found =
    roster.find((unit) => unit.id.toLowerCase() === wanted) ??
    roster.find((unit) => unit.name.toLowerCase() === wanted);
  if (!found) {
    throw new Error(
      `No unit "${idOrName}" on this roster. Use list_roster to see the ids and names available.`,
    );
  }
  return found;
}
