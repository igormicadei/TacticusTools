/**
 * `GET /api/v1/player` — player roster, inventory and progress.
 */

import type {
  GrandAlliance,
  GrandAllianceMap,
  Rarity,
  Token,
  UnixSeconds,
} from './common.js';

/* -------------------------------------------------------------------------- */
/* Units                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * An active or passive ability of a character.
 */
export interface Ability {
  /** @example "MortisRound" */
  id: string;
  /** 0 = ability is locked. Range 0–50. */
  level: number;
}

export const UNIT_ITEM_SLOTS = ['Slot1', 'Slot2', 'Slot3'] as const;

export type UnitItemSlot = (typeof UNIT_ITEM_SLOTS)[number];

/**
 * An item equipped on a character.
 */
export interface UnitItem {
  slotId: UnitItemSlot;
  /** Range 1–11. */
  level: number;
  /** @example "I_Crit_R002" */
  id: string;
  name?: string;
  rarity?: Rarity;
}

/**
 * A character owned by the player.
 */
export interface Unit {
  /** @example "ultraEliminatorSgt" */
  id: string;
  name?: string;
  /** @example "Ultramarines" */
  faction?: string;
  grandAlliance?: GrandAlliance;
  /**
   * Star level, range 0–15.
   * 0 = Common, 3 = Uncommon, 6 = Rare, 9 = Epic, 12 = Legendary.
   */
  progressionIndex: number;
  /** Total XP gained for the character. */
  xp: number;
  /** XP level of the character, range 1–50. */
  xpLevel: number;
  /**
   * Rank, range 0–17.
   * 0 = Stone I, 3 = Iron I, 6 = Bronze I, 9 = Silver I, 12 = Gold I,
   * 15 = Diamond I, 17 = Diamond III.
   */
  rank: number;
  abilities: Ability[];
  /**
   * Applied rank-up upgrades, as indices into a 2x3 matrix:
   * 0 = top left, 1 = bottom left, 2 = top center, etc.
   */
  upgrades: number[];
  items: UnitItem[];
  /** Owned shards of the character. */
  shards: number;
  /** Owned mythic shards of the character. */
  mythicShards: number;
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A stackable inventory item.
 */
export interface Item {
  /** @example "I_Crit_U008" */
  id: string;
  name?: string;
  level?: number;
  amount: number;
}

/**
 * An upgrade material.
 */
export interface Upgrade {
  /** @example "upgDmgC008" */
  id: string;
  name?: string;
  amount: number;
}

/**
 * Character shards held in the inventory (regular or mythic).
 */
export interface Shard {
  /** @example "ultraEliminatorSgt" */
  id: string;
  name?: string;
  amount: number;
}

/**
 * XP book identifiers.
 *
 * The spec's enum lists `xpUncommon` twice and omits a common tier
 * (`["xpUncommon", "xpUncommon", "xpRare", "xpEpic", "xpLegendary"]`). The game
 * config confirms the duplicate is a slip for `xpCommon`, and that a sixth tier
 * `xpMythic` exists which the spec omits entirely. All six are listed here; the
 * type stays open so an undocumented id still ingests cleanly.
 */
export const XP_BOOK_IDS = [
  'xpCommon',
  'xpUncommon',
  'xpRare',
  'xpEpic',
  'xpLegendary',
  'xpMythic',
] as const;

export type XpBookId = (typeof XP_BOOK_IDS)[number] | (string & {});

export interface XpBook {
  id: XpBookId;
  rarity: Rarity;
  amount: number;
}

/**
 * Ability badges. Grouped by grand alliance in {@link Inventory.abilityBadges}.
 */
export interface AbilityBadge {
  /** @example "Epic Imperial Badges" */
  name?: string;
  rarity: Rarity;
  amount: number;
}

/**
 * Forge badges, used for item upgrades.
 */
export interface ForgeBadge {
  /** @example "Uncommon Forge Badges" */
  name: string;
  rarity: Rarity;
  amount: number;
}

/**
 * Grand-alliance components.
 */
export interface Component {
  /** @example "Xenos Components" */
  name: string;
  grandAlliance: GrandAlliance;
  amount: number;
}

/**
 * Ascension orbs. Grouped by grand alliance in {@link Inventory.orbs}.
 */
export interface Orb {
  rarity: Rarity;
  amount: number;
}

export interface RequisitionOrders {
  regular: number;
  blessed: number;
}

export interface Inventory {
  items: Item[];
  upgrades: Upgrade[];
  shards: Shard[];
  mythicShards: Shard[];
  xpBooks: XpBook[];
  /** Keyed by grand alliance. */
  abilityBadges: GrandAllianceMap<AbilityBadge[]>;
  components: Component[];
  forgeBadges: ForgeBadge[];
  /** Keyed by grand alliance. */
  orbs: GrandAllianceMap<Orb[]>;
  requisitionOrders?: RequisitionOrders;
  resetStones: number;
}

/* -------------------------------------------------------------------------- */
/* Campaign progress                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Campaign types.
 *
 * The spec's enum is `["Standard", "Mirror", "Elite", "EliteMirror"]`, but a
 * live response also returned `Extremis` (on an event campaign), so the enum is
 * demonstrably not exhaustive. `Extremis` is included here and the type stays
 * open via `(string & {})` so a new type does not break ingestion.
 */
export const CAMPAIGN_TYPES = [
  'Standard',
  'Mirror',
  'Elite',
  'EliteMirror',
  'Extremis',
] as const;

export type CampaignType = (typeof CAMPAIGN_TYPES)[number] | (string & {});

export interface CampaignLevel {
  /**
   * Index of the battle, range 0–75.
   * Note that index 75 is present but has no actual battle.
   */
  battleIndex: number;
  attemptsLeft: number;
  attemptsUsed: number;
}

export interface CampaignProgress {
  /**
   * Campaign id.
   *
   * Not unique across the array: a live response returned two entries with
   * id `eventCampaign6` differing only by {@link CampaignProgress.type}, so key
   * campaigns by `id` + `type` rather than by `id` alone.
   *
   * @example "campaign2"
   */
  id: string;
  /** Display name. Observed empty (`""`) for event campaigns. @example "Fall of Cadia" */
  name: string;
  type: CampaignType;
  battles: CampaignLevel[];
}

/* -------------------------------------------------------------------------- */
/* Legendary events                                                           */
/* -------------------------------------------------------------------------- */

export interface LEBattleObjective {
  objectiveType: string;
  objectiveTarget: string;
  score: number;
}

export interface LEBattleConfig {
  numEnemies: number;
  objectives: LEBattleObjective[];
  disallowedFactions: string[];
}

export interface LEBattleProgress {
  /** Indices of cleared objectives. Unique. */
  objectivesCleared: number[];
  highScore: number;
  encounterPoints: number;
}

export interface LELane {
  id: number;
  name: string;
  battleConfigs: LEBattleConfig[];
  progress: LEBattleProgress[];
}

/**
 * State of the currently running instance of a legendary event.
 */
export interface LECurrentEvent {
  /** The current run. */
  run?: number;
  tokens?: Token;
  /** Whether an ad was used for an extra token since the last server reset. */
  hasUsedAdForExtraTokenToday: boolean;
  extraCurrencyPerPayout: number;
}

/**
 * A legendary event (LE).
 */
export interface LegendaryEvent {
  /** Id of the character the event unlocks. @example "bloodDante" */
  id: string;
  lanes: LELane[];
  /** Points held for this event, used to accrue currency. */
  currentPoints?: number;
  /** Currency held for this event, used to open crates. */
  currentCurrency: number;
  /** Shards held for this event. */
  currentShards: number;
  currentClaimedChestIndex: number;
  currentEvent?: LECurrentEvent;
}

/* -------------------------------------------------------------------------- */
/* Game-mode progress                                                         */
/* -------------------------------------------------------------------------- */

export interface Arena {
  tokens?: Token;
}

export interface GuildRaidProgress {
  tokens?: Token;
  bombTokens?: Token;
}

export interface Onslaught {
  tokens?: Token;
}

export interface SalvageRun {
  tokens?: Token;
}

export interface Progress {
  campaigns: CampaignProgress[];
  arena?: Arena;
  guildRaid?: GuildRaidProgress;
  onslaught?: Onslaught;
  salvageRun?: SalvageRun;
  legendaryEvents: LegendaryEvent[];
}

/* -------------------------------------------------------------------------- */
/* Player + response envelope                                                 */
/* -------------------------------------------------------------------------- */

export interface PlayerDetails {
  /** @example "player123" */
  name: string;
  powerLevel: number;
}

export interface Player {
  details: PlayerDetails;
  units: Unit[];
  inventory: Inventory;
  progress: Progress;
}

/**
 * Scopes an API key can carry. Left open — the spec only documents `Player`
 * by example, while the endpoint descriptions also reference `Guild` and
 * `Guild Raid` without pinning their exact serialised form.
 */
export const API_SCOPES = ['Player', 'Guild', 'GuildRaid'] as const;

export type ApiScope = (typeof API_SCOPES)[number] | (string & {});

export interface PlayerMetaData {
  /** `gameConfigVersion` for the player. */
  configHash: string;
  /**
   * Unix seconds at which the API key expires.
   *
   * The spec says "empty if key never expires"; a live response sends an
   * explicit `null` rather than omitting the field, so both are modelled.
   */
  apiKeyExpiresOn?: UnixSeconds | null;
  /**
   * Unix seconds at which the player was last refreshed from the game server.
   * Player data is cached by the API, so this — not request time — is the age
   * of the payload.
   */
  lastUpdatedOn: UnixSeconds;
  /** Allowed scopes of the supplied API key. */
  scopes: ApiScope[];
}

/**
 * Body of `GET /api/v1/player`.
 */
export interface PlayerResponse {
  player: Player;
  metaData: PlayerMetaData;
}
