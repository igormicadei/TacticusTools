/**
 * Raw shapes for the Tacticus Codex community backend.
 *
 * Only battle data and campaign drop rates are consumed: everything else Codex
 * serves is also in `gameInfo.json`, keyed by game ids rather than display
 * names, which normalizes more cleanly. Codex remains the only source of
 * per-node enemy compositions.
 *
 * This is a third-party service with no published API contract. Fetch sparingly
 * and cache — see `../loader.ts`.
 */

export const CODEX_API_BASE = 'https://api.tacticuscodex.com/api';

export interface RawCodexDetailedEnemy {
  name: string;
  count: number;
  /** `"Rank 2"`. */
  rank: string | null;
  /** Always `0` in current data; see `BattleEnemy.stars`. */
  stars: number | null;
  /** Always `"Unknown"` in current data. */
  rarity: string | null;
}

export interface RawCodexBattle {
  /** `campaign1_01`. */
  locationId: string;
  campaign: string;
  campaignType: string;
  nodeNumber: number;
  /** A single upgrade id, `"<unit> shards"`, or `""`. */
  reward: string;
  slots: number;
  expectedGold: number;
  enemiesTotal: number;
  enemiesAlliances?: string[] | null;
  enemiesFactions?: string[] | null;
  enemiesTypes?: string[] | null;
  detailedEnemyTypes?: RawCodexDetailedEnemy[] | null;
}

export interface RawCodexCampaignConfig {
  type: string;
  energyCost: number | null;
  dailyBattleCount: number | null;
  dropRate?: {
    common?: number | null;
    uncommon?: number | null;
    rare?: number | null;
    epic?: number | null;
    legendary?: number | null;
    shard?: number | null;
  } | null;
}

export interface RawCodexBattleData {
  battles?: RawCodexBattle[] | null;
}

export interface RawCodexCampaignConfigs {
  configs?: RawCodexCampaignConfig[] | null;
}

async function get<T>(
  path: string,
  options: { base?: string; signal?: AbortSignal; fetch?: typeof globalThis.fetch },
): Promise<T> {
  const impl = options.fetch ?? globalThis.fetch;
  const response = await impl(`${options.base ?? CODEX_API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Codex ${path}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const fetchCodexBattleData = (
  options: { base?: string; signal?: AbortSignal; fetch?: typeof globalThis.fetch } = {},
): Promise<RawCodexBattleData> => get('/battledata/all', options);

export const fetchCodexCampaignConfigs = (
  options: { base?: string; signal?: AbortSignal; fetch?: typeof globalThis.fetch } = {},
): Promise<RawCodexCampaignConfigs> => get('/campaignconfig/all', options);
