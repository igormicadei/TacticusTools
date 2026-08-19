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

/** A row of Codex's `unitlevel` table: shards per star level. */
export interface RawCodexUnitLevel {
  /** Rarity tier name at this star level, e.g. `"UnCommon"`. */
  level: string;
  /**
   * Star level. Despite the name this is the API's `progressionIndex`, not
   * `Unit.rank` — shards and orbs drive ascension, while rank-up consumes
   * upgrade materials from `heroes[x].ranks`.
   */
  rank: number;
  shards: number;
  /**
   * Orb count. Unreliable: zero on several rows that do require orbs, and the
   * accompanying `orbType` names the tier being promoted *into* rather than the
   * tier at this row. {@link RawCodexOrbPromotionRequirement} is preferred.
   */
  orbs: number;
  orbType: string;
}

/** A row of Codex's `orbpromotionrequirement` table: orbs per star level. */
export interface RawCodexOrbPromotionRequirement {
  /** Star level, i.e. the API's `progressionIndex`. */
  level: number;
  orbType: string;
  qty: number;
}

/** A row of Codex's `levelprogression` table. */
export interface RawCodexLevelProgression {
  level: number;
  xpToNextLevel: number;
  totalXp: number;
  totalLegendaryTomes?: number | null;
  /**
   * Free-text annotation. A handful of rows carry the rarity level ceilings,
   * e.g. `"Max Common Level"`, which is the only published source for them.
   */
  notes?: string | null;
}

export interface RawCodexLevelProgressions {
  levels?: RawCodexLevelProgression[] | null;
}

export interface RawCodexUnitLevels {
  unitLevels?: RawCodexUnitLevel[] | null;
}

export interface RawCodexOrbPromotionRequirements {
  requirements?: RawCodexOrbPromotionRequirement[] | null;
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

export const fetchCodexUnitLevels = (
  options: { base?: string; signal?: AbortSignal; fetch?: typeof globalThis.fetch } = {},
): Promise<RawCodexUnitLevels> => get('/unitlevel/all', options);

export const fetchCodexOrbPromotionRequirements = (
  options: { base?: string; signal?: AbortSignal; fetch?: typeof globalThis.fetch } = {},
): Promise<RawCodexOrbPromotionRequirements> => get('/orbpromotionrequirement/all', options);

export const fetchCodexLevelProgression = (
  options: { base?: string; signal?: AbortSignal; fetch?: typeof globalThis.fetch } = {},
): Promise<RawCodexLevelProgressions> => get('/levelprogression/all', options);
