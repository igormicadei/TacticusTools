/**
 * `GET /api/v1/guild` — guild roster and metadata.
 */

import type { ApiTimestamp } from './common.js';

export const GUILD_ROLES = ['MEMBER', 'OFFICER', 'CO_LEADER', 'LEADER'] as const;

export type GuildRole = (typeof GUILD_ROLES)[number];

export interface GuildMember {
  /** @example "a6977954-4da1-4218-b939-accdef523bc4" */
  userId: string;
  role: GuildRole;
  level: number;
  /**
   * When the player was last active in the guild.
   * See {@link ApiTimestamp} for the string/number ambiguity in the spec.
   */
  lastActivityOn?: ApiTimestamp;
}

export interface Guild {
  /** @example "e2b03cf8-93c0-4d01-ba66-abcdef62d65c" */
  guildId: string;
  /** @example "ABCDE" */
  guildTag: string;
  name: string;
  level: number;
  members: GuildMember[];
  /**
   * Guild raid seasons that can be queried at
   * `GET /api/v1/guildRaid/{season}`.
   */
  guildRaidSeasons: number[];
}

/**
 * Body of `GET /api/v1/guild`.
 */
export interface GuildResponse {
  guild: Guild;
}
