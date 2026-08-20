/**
 * Raw shapes for `gameInfo.json`, the published game configuration.
 *
 * These types describe the file *as served* — source spellings, source
 * nullability, source id conventions. Nothing here is normalized; that is
 * `../normalize.ts`'s job. Only the subset the database consumes is typed;
 * unconsumed sections are left as `unknown`.
 */

export const GAME_INFO_URL = 'https://www.tacticustable.com/gameInfo.json';

export interface RawGameInfoStatRow {
  rank: number | null;
  stars: number | null;
  rarity: number | null;
  health: number | null;
  damage: number | null;
  armor: number | null;
  abilityLevel?: number | null;
}

export interface RawGameInfoRankUpgrade {
  upgradeId: string;
  amount: number | null;
  statIncrease?: number | null;
  statType?: string | null;
  crafting?: unknown;
}

export interface RawGameInfoHeroRank {
  level: string;
  health: number | null;
  damage: number | null;
  armor: number | null;
  upgrades?: RawGameInfoRankUpgrade[] | null;
  basicUpgrades?: RawGameInfoRankUpgrade[] | null;
}

/** A unit's normal attack, as `gameInfo` describes it. */
export interface RawGameInfoWeapon {
  hits?: number | null;
  damageProfile?: string | null;
  /** Hexes; null for melee. */
  range?: number | null;
  /** Percent, e.g. 25 for a 25% pierce ratio. */
  piercingRatio?: number | null;
  pierceDescription?: string | null;
  traits?: string[] | null;
}

export interface RawGameInfoHero {
  id: string;
  /** The Tacticus API's unit id. The object key is a display slug instead. */
  gameId: string | null;
  name: string;
  longName?: string | null;
  factionId?: string | null;
  allianceId?: string | null;
  baseRarity?: string | null;
  movement?: number | null;
  itemSlots?: string[] | null;
  traits?: string[] | null;
  activeAbility?: string | null;
  passiveAbility?: string | null;
  mythicAbilities?: string[] | null;
  meleeWeapon?: RawGameInfoWeapon | null;
  rangeWeapon?: RawGameInfoWeapon | null;
  damageProfiles?: string[] | null;
  ranks?: RawGameInfoHeroRank[] | null;
}

export interface RawGameInfoUpgrade {
  name: string;
  rarity?: string | null;
  statType?: string | null;
  crafting?: Record<string, number> | null;
  baseUpgrades?: Record<string, number> | null;
  /** Standard-campaign nodes, in `campaign2_2_53` form. */
  battles?: string[] | null;
  /** Event-campaign nodes, in `eventExtremis1_1012_03B` form. */
  battlesCE?: string[] | null;
}

export interface RawGameInfoItemLevel {
  stats?: Record<string, number> | null;
  dustCost?: number | null;
  goldCost?: number | null;
  mythicDustCost?: number | null;
}

export interface RawGameInfoItem {
  gameId: string;
  name: string;
  itemType: string;
  rarity?: string | null;
  nextInSeries?: string | null;
  levels?: RawGameInfoItemLevel[] | null;
  allowedFactions?: string[] | null;
}

export interface RawGameInfoAbility {
  gameId: string;
  name: string;
  description?: string | null;
  /** Per-level values, indexed from ability level 1. Values arrive as strings. */
  variables?: Record<string, string[] | null> | null;
  /** Values that do not change with level, e.g. `nrOfHits`, `damageProfile`. */
  constants?: Record<string, string> | null;
  /** Which of `variables` gain +20% per rarity tier. */
  variablesAffectedByRarityBonus?: string[] | null;
  /** `Melee`, `Ranged` or `Normal` when the ability is itself an attack. */
  attackRangeType?: string | null;
}

/** A trait's display text. The markup is the game client's own. */
export interface RawGameInfoTrait {
  id: string;
  name: string;
  description?: string | null;
  simpleName?: string | null;
  hero?: boolean | null;
}

export interface RawGameInfoNpc {
  id: string;
  name: string;
  factionId?: string | null;
  allianceId?: string | null;
  movement?: number | null;
  traits?: string[] | null;
  stats?: RawGameInfoStatRow[] | null;
}

export interface RawGameInfoAbilityUpgradeCost {
  gold: number | null;
  badgeType: string;
  amount: number | null;
}

export interface RawGameInfoXpBook {
  id: string;
  rarity: string;
  xpIncrease: number;
  gold: number;
}

export interface RawGameInfo {
  id?: string;
  version?: string;
  heroes?: Record<string, RawGameInfoHero> | null;
  machinesOfWar?: Record<string, RawGameInfoHero> | null;
  upgrades?: Record<string, RawGameInfoUpgrade> | null;
  items?: Record<string, RawGameInfoItem> | null;
  abilities?: Record<string, RawGameInfoAbility> | null;
  traits?: Record<string, RawGameInfoTrait> | null;
  npcs?: Record<string, RawGameInfoNpc> | null;
  /** Cumulative XP thresholds; index `n` is the total for level `n + 2`. */
  xpLevels?: number[] | null;
  xpBooks?: RawGameInfoXpBook[] | null;
  abilityUpgradeCosts?: {
    abilityUpgradeCosts?: RawGameInfoAbilityUpgradeCost[] | null;
    abilityUpgradeCostsMow?: RawGameInfoAbilityUpgradeCost[] | null;
  } | null;
}

/** Fetch `gameInfo.json`. ~11 MB, so cache it — see `../loader.ts`. */
export async function fetchGameInfo(
  options: { url?: string; signal?: AbortSignal; fetch?: typeof globalThis.fetch } = {},
): Promise<RawGameInfo> {
  const impl = options.fetch ?? globalThis.fetch;
  const response = await impl(options.url ?? GAME_INFO_URL, {
    headers: { Accept: 'application/json' },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch gameInfo.json: HTTP ${response.status}`);
  }
  return (await response.json()) as RawGameInfo;
}
