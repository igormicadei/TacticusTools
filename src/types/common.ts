/**
 * Shared primitives used across every Tacticus API response.
 */

/**
 * Item / badge / orb rarity tiers.
 */
export const RARITIES = [
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Mythic',
] as const;

export type Rarity = (typeof RARITIES)[number];

/**
 * The three grand alliances. Also used as the key of the `abilityBadges`
 * and `orbs` maps on {@link Inventory}.
 */
export const GRAND_ALLIANCES = ['Imperial', 'Xenos', 'Chaos'] as const;

export type GrandAlliance = (typeof GRAND_ALLIANCES)[number];

/**
 * A record keyed by grand alliance.
 *
 * Typed as a `Partial` record because the API documents these as free-form
 * `additionalProperties` maps: there is no guarantee that every alliance is
 * present for a given player, and new keys can appear without a spec bump.
 */
export type GrandAllianceMap<T> = Partial<Record<GrandAlliance, T>> & {
  [key: string]: T | undefined;
};

/**
 * A regenerating token pool (arena attempts, guild raid tokens, ...).
 */
export interface Token {
  current: number;
  max: number;
  /** Seconds until the next token regenerates. Absent when the pool is full. */
  nextTokenInSeconds?: number;
  /** Seconds between token regenerations. */
  regenDelayInSeconds: number;
}

/**
 * A point in time reported by the API.
 *
 * The OpenAPI document is self-contradictory here: these fields are declared
 * as `type: string, format: date-time` while every description calls them a
 * "unix timestamp (in seconds)". The union accepts either representation so
 * ingestion never fails on the discrepancy; use {@link toDate} to normalise.
 */
export type ApiTimestamp = string | number;

/**
 * Unix timestamp in seconds, as declared by the spec for fields that are
 * unambiguously typed as integers (`lastUpdatedOn`, `apiKeyExpiresOn`).
 */
export type UnixSeconds = number;

/**
 * Normalise an {@link ApiTimestamp} into a `Date`.
 *
 * Numbers (and numeric strings) are treated as unix seconds; anything else is
 * handed to the `Date` constructor as an ISO-8601 string. Returns `undefined`
 * for absent or unparseable values rather than an `Invalid Date`.
 */
export function toDate(value: ApiTimestamp | null | undefined): Date | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value * 1000) : undefined;
  }

  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  if (/^-?\d+$/.test(trimmed)) {
    return new Date(Number(trimmed) * 1000);
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Convert a unix-seconds field into a `Date`.
 */
export function fromUnixSeconds(value: UnixSeconds | null | undefined): Date | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  return new Date(value * 1000);
}
