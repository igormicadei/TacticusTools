/**
 * `GET /api/v1/guildRaid` and `GET /api/v1/guildRaid/{season}` —
 * per-attempt guild raid log for a season.
 */

import type { ApiTimestamp, Rarity } from './common.js';

export const ENCOUNTER_TYPES = ['SideBoss', 'Boss'] as const;

export type EncounterType = (typeof ENCOUNTER_TYPES)[number];

export const DAMAGE_TYPES = ['Bomb', 'Battle'] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

/**
 * A hero as it appeared in a raid attempt.
 */
export interface PublicHeroDetail {
  /** @example "ultraEliminatorSgt" */
  unitId: string;
  power: number;
}

/**
 * A single guild raid attempt (one battle or one bomb).
 */
export interface Raid {
  /** Guild member who made the attempt. */
  userId: string;
  tier: number;
  set: number;
  encounterIndex: number;
  /** Boss HP left after the attempt. */
  remainingHp: number;
  maxHp: number;
  encounterType: EncounterType;
  /** @example "GuildBoss1Boss1TyranTervigonLeviathan" */
  unitId: string;
  /** @example "TervigonLeviathan" */
  type: string;
  rarity: Rarity;
  damageDealt: number;
  damageType: DamageType;
  /** When the battle/bomb started. See {@link ApiTimestamp}. */
  startedOn: ApiTimestamp;
  /** When the battle/bomb ended. Absent while still in progress. */
  completedOn?: ApiTimestamp;
  /** Empty for bomb attempts. */
  heroDetails: PublicHeroDetail[];
  machineOfWarDetails?: PublicHeroDetail;
  globalConfigHash: string;
}

/**
 * Body of `GET /api/v1/guildRaid` and `GET /api/v1/guildRaid/{season}`.
 */
export interface GuildRaidResponse {
  season: number;
  seasonConfigId: string;
  entries: Raid[];
}
