/**
 * Loads and caches the normalized game database.
 *
 * `gameInfo.json` is ~11 MB and Codex is a volunteer-run community service, so
 * the default behaviour is cache-first: read a local snapshot if one exists,
 * and only go to the network when it is missing or stale. Callers that need a
 * refresh ask for one explicitly.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { normalize } from './normalize.js';
import {
  fetchCodexBattleData,
  fetchCodexCampaignConfigs,
  type RawCodexBattleData,
  type RawCodexCampaignConfigs,
} from './sources/codex.js';
import { fetchGameInfo, type RawGameInfo } from './sources/gameinfo.js';
import type { GameDatabase } from './types.js';

export interface LoadOptions {
  /**
   * Path to the cached database JSON. Defaults to `.cache/gamedata.json`.
   * Pass `null` to disable caching entirely.
   */
  cachePath?: string | null;
  /**
   * Maximum age of a usable cache entry, in milliseconds.
   * Defaults to 7 days. `0` forces a refresh.
   */
  maxAgeMs?: number;
  /** Skip the cache and refetch. */
  refresh?: boolean;
  /**
   * Include Codex battle data (per-node enemy compositions and drop rates).
   * Defaults to `true`; set `false` to build from `gameInfo.json` alone.
   */
  includeBattleData?: boolean;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_CACHE_PATH = '.cache/gamedata.json';
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function readCache(path: string, maxAgeMs: number): Promise<GameDatabase | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }

  let parsed: GameDatabase;
  try {
    parsed = JSON.parse(raw) as GameDatabase;
  } catch {
    // A truncated or corrupt cache should refetch, not throw.
    return undefined;
  }

  if (typeof parsed.fetchedAt !== 'number') return undefined;
  if (maxAgeMs > 0 && Date.now() - parsed.fetchedAt > maxAgeMs) return undefined;
  return parsed;
}

async function writeCache(path: string, database: GameDatabase): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(database), 'utf8');
}

/**
 * Load the normalized game database, from cache when possible.
 *
 * Codex is optional and non-fatal: if its endpoints fail, the database is still
 * returned from `gameInfo.json` alone, with `sources.codexBattleData` false and
 * no `campaigns`. That keeps unit, item, upgrade and progression data available
 * even when the community backend is down.
 */
export async function loadGameDatabase(options: LoadOptions = {}): Promise<GameDatabase> {
  const cachePath = options.cachePath === null ? null : (options.cachePath ?? DEFAULT_CACHE_PATH);
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  if (cachePath && !options.refresh) {
    const cached = await readCache(cachePath, maxAgeMs);
    if (cached) return cached;
  }

  const fetchOptions = {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };

  const gameInfo: RawGameInfo = await fetchGameInfo(fetchOptions);

  let codexBattleData: RawCodexBattleData | undefined;
  let codexCampaignConfigs: RawCodexCampaignConfigs | undefined;
  if (options.includeBattleData !== false) {
    [codexBattleData, codexCampaignConfigs] = await Promise.all([
      fetchCodexBattleData(fetchOptions).catch(() => undefined),
      fetchCodexCampaignConfigs(fetchOptions).catch(() => undefined),
    ]);
  }

  const database = normalize({ gameInfo, codexBattleData, codexCampaignConfigs });
  if (cachePath) await writeCache(cachePath, database);
  return database;
}

/**
 * Build a database from already-fetched raw payloads.
 *
 * Useful for tests and for offline pipelines that manage their own downloads.
 */
export { normalize as buildGameDatabase };
