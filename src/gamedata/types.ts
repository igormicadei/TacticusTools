/**
 * The normalized game database.
 *
 * Assembled from one or more upstream sources and reshaped so that:
 * - every identifier follows the Tacticus API convention (see `./ids.ts`);
 * - every ordered or closed-domain property is an integer enum (see `./enums.ts`);
 * - every collection is keyed by id, so joins against a player payload are
 *   direct lookups rather than scans.
 */

import type {
  CampaignType,
  EquipmentSlot,
  GrandAlliance,
  Rank,
  Rarity,
} from './enums.js';
import type {
  AbilityId,
  BattleRef,
  CampaignId,
  ItemId,
  NpcId,
  UnitId,
  UpgradeId,
} from './ids.js';

/* -------------------------------------------------------------------------- */
/* Units                                                                      */
/* -------------------------------------------------------------------------- */

/** Combat stats at a single rank. */
export interface UnitRankStats {
  rank: Rank;
  health: number;
  damage: number;
  armour: number;
  /** Materials consumed to complete this rank. */
  upgrades: UnitRankUpgrade[];
}

export interface UnitRankUpgrade {
  upgradeId: UpgradeId;
  amount: number;
  /** Stat points granted when applied. */
  statIncrease?: number;
  statType?: string;
}

export interface UnitDefinition {
  id: UnitId;
  name: string;
  fullName?: string;
  factionId?: string;
  grandAlliance?: GrandAlliance;
  baseRarity?: Rarity;
  movement?: number;
  /** Equipment slot types, indexed by {@link EquipmentSlot}. */
  itemSlots: string[];
  traits: string[];
  activeAbilityId?: AbilityId;
  passiveAbilityId?: AbilityId;
  mythicAbilityIds: AbilityId[];
  /** Per-rank stats and rank-up materials, indexed by {@link Rank}. */
  ranks: UnitRankStats[];
  /** True when this unit is a Machine of War rather than a character. */
  isMachineOfWar: boolean;
}

/* -------------------------------------------------------------------------- */
/* Materials and items                                                        */
/* -------------------------------------------------------------------------- */

export interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  rarity?: Rarity;
  statType?: string;
  /** Crafting inputs, as `{ [upgradeId]: amount }`. Empty when not craftable. */
  crafting: Record<UpgradeId, number>;
  /** Flattened base materials, as `{ [upgradeId]: amount }`. */
  baseUpgrades: Record<UpgradeId, number>;
  /** Nodes that drop this material, normalized from every source spelling. */
  farmableAt: BattleRef[];
}

export interface ItemLevel {
  /** 1-based level, matching `UnitItem.level` in the player API. */
  level: number;
  stats: Record<string, number>;
  dustCost?: number;
  goldCost?: number;
  mythicDustCost?: number;
}

export interface ItemDefinition {
  id: ItemId;
  name: string;
  itemType: string;
  rarity?: Rarity;
  /** Next item in the same upgrade series, when one exists. */
  nextInSeries?: ItemId;
  levels: ItemLevel[];
  /** Factions permitted to equip this item. Empty means unrestricted. */
  allowedFactions: string[];
}

/* -------------------------------------------------------------------------- */
/* Abilities and progression                                                  */
/* -------------------------------------------------------------------------- */

export interface AbilityDefinition {
  id: AbilityId;
  name: string;
  /** Source description. May contain HTML markup from the game client. */
  description?: string;
}

/** Cost to raise an ability from `level` to `level + 1`. */
export interface AbilityUpgradeCost {
  /** The level being left behind; index 0 is the 1 -> 2 upgrade. */
  level: number;
  gold: number;
  badgeType: string;
  badgeRarity?: Rarity;
  amount: number;
}

/**
 * A row of the character XP table.
 *
 * Note the semantics of {@link XpLevel.totalXp}, which differ from the field of
 * the same name in Codex's `levelprogression`: here it is the XP at which the
 * level is *reached*, so it compares directly against `Unit.xp` from the player
 * API. Codex's field is the XP at which the level is *completed* — its value
 * for level `L` equals this type's value for level `L + 1`.
 *
 * Verified against 29 live units (`totalXp(L) <= unit.xp < totalXp(L + 1)` held
 * for every one) and against Codex's independent table, which agrees on
 * {@link XpLevel.xpToNextLevel} for all 59 shared levels.
 */
export interface XpLevel {
  level: number;
  /**
   * XP needed to go from this level to the next.
   * Equals `totalXp(level + 1) - totalXp(level)`.
   */
  xpToNextLevel: number;
  /**
   * Cumulative XP at which this level is reached. `0` for level 1.
   *
   * To find a unit's remaining XP: `totalXp(unit.xpLevel + 1) - unit.xp`.
   */
  totalXp: number;
}

export interface XpBookDefinition {
  id: string;
  rarity: Rarity;
  xpIncrease: number;
  gold: number;
}

/**
 * Which shard currency a star promotion consumes. The player API tracks the two
 * separately as `Unit.shards` and `Unit.mythicShards`.
 */
export type ShardType = 'regular' | 'mythic';

/** What a progression step does. */
export type ProgressionKind =
  /** Adds a star. Grants +10% to base stats. */
  | 'promotion'
  /** Raises rarity. Grants +20% to ability stats and lifts the level and rank caps. */
  | 'ascension';

/** Where a shard cost came from. */
export type ShardSource =
  /** Codex's `unitlevel` table. */
  | 'unitLevel'
  /** The game's own progression panel, via `./corrections.ts`. */
  | 'gameUi';

/**
 * Shards and orbs required to reach one star level, i.e. to go from
 * `progressionIndex - 1` to `progressionIndex`.
 *
 * Merged from two Codex tables that disagree in places:
 * - `orbpromotionrequirement` is authoritative for orbs. It is self-consistent
 *   and covers every promotion threshold.
 * - `unitlevel` is the only source of shard counts. Its orb column is ignored
 *   entirely: it agrees with the orb table at nine indices, is zero on several
 *   rows that do require orbs, and at index 5 reports a requirement the orb
 *   table places at index 6 — so consulting it can only introduce phantom
 *   costs. Indices where the two disagree set
 *   {@link ProgressionRequirement.orbsDisputed}.
 *
 * Costs are per step, not cumulative: reaching index 15 from 13 needs
 * `shards(14) + shards(15)`.
 */
export interface ProgressionRequirement {
  /** Progression step, matching `Unit.progressionIndex` in the player API. */
  progressionIndex: number;
  /** Rarity tier reached at this step. */
  rarity?: Rarity;
  /**
   * Whether this step adds a star or raises rarity.
   *
   * Derived, not published: a step is an ascension when its rarity differs from
   * the previous step's. That puts ascensions at indices 3, 6, 9, 12 and 16,
   * which matches the rarity anchors the API documents for `progressionIndex`
   * (0 = Common, 3 = Uncommon, 6 = Rare, 9 = Epic, 12 = Legendary).
   */
  kind?: ProgressionKind;
  /**
   * Star count after this step.
   *
   * Also derived. An ascension does not add a star — the game's progression
   * panel shows Common ending at 2 stars, then an ascension, then Uncommon's
   * first promotion granting the 3rd — so this runs behind
   * {@link ProgressionRequirement.progressionIndex}, topping out at 14. That
   * ceiling matches the highest `stars` value in the game config's NPC stat
   * tables, which is the only independent check available.
   */
  starLevel?: number;
  /** Shards consumed. Absent when no source publishes a value. */
  shards?: number;
  /** Which shard currency {@link ProgressionRequirement.shards} refers to. */
  shardType?: ShardType;
  /** Where {@link ProgressionRequirement.shards} came from. */
  shardsSource?: ShardSource;
  /** Orbs consumed. Absent when this level needs none. */
  orbs?: number;
  orbRarity?: Rarity;
  /**
   * True when `unitlevel`'s orb column disagreed with the orb table at this
   * level. The orb table's value is always the one used.
   */
  orbsDisputed?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Campaigns and battles                                                      */
/* -------------------------------------------------------------------------- */

/** Per-rarity drop chance for a node. */
export interface DropRates {
  common: number;
  uncommon: number;
  rare: number;
  epic: number;
  legendary: number;
  shard: number;
}

/**
 * Where a node's drop rates came from.
 *
 * No source publishes true per-node rates today, so nodes inherit their
 * campaign type's rates. The field is stored per node regardless, so a future
 * per-node source can be dropped in by replacing the values and switching this
 * marker — no consumer changes.
 */
export type DropRateProvenance = 'campaignType' | 'node';

export interface BattleEnemy {
  npcId: NpcId;
  /** The id exactly as the source spelled it, before alias resolution. */
  sourceNpcId: string;
  count: number;
  rank?: Rank;
  /**
   * Star level of the enemy.
   *
   * Codex battle data always reports `0` here; where the NPC's stat table has a
   * row for this rank, the real value is filled in from it and
   * {@link BattleEnemy.statsResolved} is true.
   */
  stars: number;
  /** Rarity of the enemy. Same provenance caveat as {@link BattleEnemy.stars}. */
  rarity?: Rarity;
  /** Stats at this rank, when the NPC's stat table covers it. */
  health?: number;
  damage?: number;
  armour?: number;
  /** True when the fields above were resolved from NPC stats rather than copied. */
  statsResolved: boolean;
}

export interface BattleDefinition extends BattleRef {
  /** Stable key, `battleKey(ref)`. */
  key: string;
  campaignType?: CampaignType;
  /** Team slots available to the player, 1–5. */
  slots?: number;
  expectedGold?: number;
  enemiesTotal?: number;
  enemies: BattleEnemy[];
  enemyFactions: string[];
  enemyAlliances: GrandAlliance[];
  /** Material dropped by this node, when it drops one. */
  rewardUpgradeId?: UpgradeId;
  /** Unit whose shards this node drops, when it drops shards. */
  rewardShardUnitId?: UnitId;
  /** Reward string exactly as the source gave it, when it resolved to neither. */
  rewardRaw?: string;
  dropRates?: DropRates;
  dropRateProvenance?: DropRateProvenance;
}

export interface CampaignDefinition {
  id: CampaignId;
  name?: string;
  type?: CampaignType;
  energyCost?: number;
  dailyBattleCount?: number;
  /** Nodes keyed by {@link battleKey}. */
  battles: Record<string, BattleDefinition>;
}

/* -------------------------------------------------------------------------- */
/* NPCs                                                                       */
/* -------------------------------------------------------------------------- */

export interface NpcStatRow {
  rank: Rank;
  stars: number;
  rarity?: Rarity;
  health?: number;
  damage?: number;
  armour?: number;
  abilityLevel?: number;
}

export interface NpcDefinition {
  id: NpcId;
  name: string;
  factionId?: string;
  grandAlliance?: GrandAlliance;
  movement?: number;
  traits: string[];
  /** Stats by rank. Sparse: many NPCs define only a few ranks. */
  stats: NpcStatRow[];
}

/* -------------------------------------------------------------------------- */
/* Database                                                                   */
/* -------------------------------------------------------------------------- */

/** Level and rank ceilings that apply while a unit sits at a given rarity. */
export interface RarityCap {
  rarity: Rarity;
  /** Highest `Unit.xpLevel` reachable before ascending. */
  maxLevel: number;
}

export interface GameDatabaseSources {
  /** `gameInfo.json` config version, e.g. `1.41.101.1`. */
  gameInfoVersion?: string;
  gameInfoId?: string;
  /**
   * Which Codex sections were merged in. Each is fetched independently and
   * failures are non-fatal, so these are reported separately rather than as one
   * flag — a build can have progression data but no battle data, or vice versa.
   */
  codex: {
    /** Per-node enemy compositions and rewards. */
    battleData: boolean;
    /** Campaign-type drop rates. */
    campaignConfigs: boolean;
    /** Shard costs per star level. */
    unitLevels: boolean;
    /** Orb costs per star level. */
    orbPromotions: boolean;
    /** Rarity level caps. */
    levelProgression: boolean;
  };
}

/** Counters describing how cleanly the sources merged. */
export interface GameDatabaseStats {
  units: number;
  upgrades: number;
  items: number;
  abilities: number;
  npcs: number;
  campaigns: number;
  battles: number;
  /** Battle enemy entries whose stats resolved against an NPC stat row. */
  enemiesResolved: number;
  enemiesTotal: number;
  /** Source NPC ids that matched no NPC, even after aliasing. */
  unresolvedNpcIds: string[];
  /** Battle references that pointed at an unknown node. */
  unresolvedBattleRefs: string[];
  /** Star levels with no published shard cost. */
  progressionGaps: number[];
  /** Star levels where the two orb sources disagreed. */
  progressionConflicts: number[];
}

/**
 * Shape version of {@link GameDatabase}.
 *
 * Bump this whenever the normalized shape changes — a new field, a renamed one,
 * different semantics for an existing one. The loader discards any cache whose
 * stored version differs, so an older cache is refetched rather than served
 * with fields the current code expects but the file never had.
 */
export const GAME_DATABASE_SCHEMA_VERSION = 5;

export interface GameDatabase {
  /** Value of {@link GAME_DATABASE_SCHEMA_VERSION} when this was assembled. */
  schemaVersion: number;
  sources: GameDatabaseSources;
  /** Unix milliseconds when this database was assembled. */
  fetchedAt: number;
  units: Record<UnitId, UnitDefinition>;
  upgrades: Record<UpgradeId, UpgradeDefinition>;
  items: Record<ItemId, ItemDefinition>;
  abilities: Record<AbilityId, AbilityDefinition>;
  npcs: Record<NpcId, NpcDefinition>;
  campaigns: Record<CampaignId, CampaignDefinition>;
  xpLevels: XpLevel[];
  xpBooks: XpBookDefinition[];
  abilityUpgradeCosts: AbilityUpgradeCost[];
  progressionRequirements: ProgressionRequirement[];
  /**
   * Level ceiling per rarity. A unit cannot exceed its rarity's `maxLevel`
   * without ascending, so this bounds "XP to next level".
   */
  rarityCaps: RarityCap[];
  stats: GameDatabaseStats;
}
