/**
 * Numeric enums for the normalized game database.
 *
 * Every ordered or closed-domain property is stored as an integer, never as a
 * source string: sources spell the same concept several ways (`"Stone I"`,
 * `"STONE I"`, `"Rank 2"`, `"legendaryD3"`), and integers are what the Tacticus
 * API itself uses for `unit.rank` and `unit.progressionIndex`. Each enum ships
 * with a display-name table and a tolerant parser so joins are exact and
 * presentation stays a separate concern.
 */

/* -------------------------------------------------------------------------- */
/* Rarity                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Rarity tier. Matches the ordinal used by `gameInfo` npc stat rows
 * (`rarity: 0..5`).
 */
export const Rarity = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Epic: 3,
  Legendary: 4,
  Mythic: 5,
} as const;

export type Rarity = (typeof Rarity)[keyof typeof Rarity];

export const RARITY_NAMES = [
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Mythic',
] as const;

/* -------------------------------------------------------------------------- */
/* Rank                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Unit rank, 0–19.
 *
 * The order is taken from `gameInfo` `heroes[x].ranks`, which is authoritative
 * and agrees with the Tacticus API's documented anchors (0 = Stone I,
 * 3 = Iron I, 6 = Bronze I, 9 = Silver I, 12 = Gold I, 15 = Diamond I,
 * 17 = Diamond III). Ranks 18–19 postdate the API docs; Codex calls them
 * "Adamantine I" and "Rank 20", `gameInfo` calls them Mythic I/II — the
 * `gameInfo` naming is used here and both spellings parse.
 */
export const Rank = {
  StoneI: 0,
  StoneII: 1,
  StoneIII: 2,
  IronI: 3,
  IronII: 4,
  IronIII: 5,
  BronzeI: 6,
  BronzeII: 7,
  BronzeIII: 8,
  SilverI: 9,
  SilverII: 10,
  SilverIII: 11,
  GoldI: 12,
  GoldII: 13,
  GoldIII: 14,
  DiamondI: 15,
  DiamondII: 16,
  DiamondIII: 17,
  MythicI: 18,
  MythicII: 19,
} as const;

export type Rank = (typeof Rank)[keyof typeof Rank];

export const RANK_NAMES = [
  'Stone I',
  'Stone II',
  'Stone III',
  'Iron I',
  'Iron II',
  'Iron III',
  'Bronze I',
  'Bronze II',
  'Bronze III',
  'Silver I',
  'Silver II',
  'Silver III',
  'Gold I',
  'Gold II',
  'Gold III',
  'Diamond I',
  'Diamond II',
  'Diamond III',
  'Mythic I',
  'Mythic II',
] as const;

/* -------------------------------------------------------------------------- */
/* Grand alliance                                                             */
/* -------------------------------------------------------------------------- */

export const GrandAlliance = {
  Imperial: 0,
  Xenos: 1,
  Chaos: 2,
} as const;

export type GrandAlliance = (typeof GrandAlliance)[keyof typeof GrandAlliance];

export const GRAND_ALLIANCE_NAMES = ['Imperial', 'Xenos', 'Chaos'] as const;

/* -------------------------------------------------------------------------- */
/* Campaign type                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Campaign type. `Extremis` is absent from the API's OpenAPI enum but is
 * returned by the live API and present in both data sources.
 */
export const CampaignType = {
  Standard: 0,
  Mirror: 1,
  Elite: 2,
  EliteMirror: 3,
  Extremis: 4,
  Onslaught: 5,
  SalvageRun: 6,
} as const;

export type CampaignType = (typeof CampaignType)[keyof typeof CampaignType];

export const CAMPAIGN_TYPE_NAMES = [
  'Standard',
  'Mirror',
  'Elite',
  'EliteMirror',
  'Extremis',
  'Onslaught',
  'SalvageRun',
] as const;

/* -------------------------------------------------------------------------- */
/* Equipment slot                                                             */
/* -------------------------------------------------------------------------- */

/** Equipment slot index. The API spells these `Slot1`–`Slot3` (1-based). */
export const EquipmentSlot = {
  Slot1: 0,
  Slot2: 1,
  Slot3: 2,
} as const;

export type EquipmentSlot = (typeof EquipmentSlot)[keyof typeof EquipmentSlot];

export const EQUIPMENT_SLOT_NAMES = ['Slot1', 'Slot2', 'Slot3'] as const;

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

/** Strip case, spaces, underscores and hyphens for tolerant matching. */
function fold(value: string): string {
  return value.replace(/[\s_-]+/g, '').toLowerCase();
}

function buildLookup(names: readonly string[], extra: Record<string, number> = {}) {
  const map = new Map<string, number>();
  names.forEach((name, index) => map.set(fold(name), index));
  for (const [alias, index] of Object.entries(extra)) map.set(fold(alias), index);
  return map;
}

const RARITY_LOOKUP = buildLookup(RARITY_NAMES, {
  // Codex `unitstat` tier keys that carry a rarity plus a rank qualifier.
  legendaryD3: Rarity.Legendary,
  mythicSkull: Rarity.Mythic,
});

const RANK_LOOKUP = buildLookup(RANK_NAMES, {
  // Codex spellings for the two ranks added after the API docs were written.
  'Adamantine I': Rank.MythicI,
  'Rank 20': Rank.MythicII,
});

const GRAND_ALLIANCE_LOOKUP = buildLookup(GRAND_ALLIANCE_NAMES);
const CAMPAIGN_TYPE_LOOKUP = buildLookup(CAMPAIGN_TYPE_NAMES);
const EQUIPMENT_SLOT_LOOKUP = buildLookup(EQUIPMENT_SLOT_NAMES);

function parser<T extends number>(
  lookup: Map<string, number>,
  label: string,
): {
  (value: string | number | null | undefined): T | undefined;
  strict(value: string | number | null | undefined): T;
} {
  const parse = (value: string | number | null | undefined): T | undefined => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') {
      return Number.isInteger(value) && value >= 0 && value < lookup.size
        ? (value as T)
        : undefined;
    }
    const hit = lookup.get(fold(value));
    return hit === undefined ? undefined : (hit as T);
  };
  parse.strict = (value: string | number | null | undefined): T => {
    const parsed = parse(value);
    if (parsed === undefined) {
      throw new TypeError(`Unrecognised ${label}: ${JSON.stringify(value)}`);
    }
    return parsed;
  };
  return parse;
}

/** Parse any source spelling of a rarity into its ordinal. */
export const parseRarity = parser<Rarity>(RARITY_LOOKUP, 'rarity');

/**
 * Parse any source spelling of a rank into its ordinal.
 *
 * Accepts display names (`"Stone I"`, `"STONE I"`), Codex's late-rank spellings,
 * and the `"Rank N"` form used by Codex battle data — where `N` is already the
 * ordinal, so `"Rank 2"` is rank 2, not the third named rank.
 */
export const parseRank = (value: string | number | null | undefined): Rank | undefined => {
  if (typeof value === 'string') {
    const numeric = /^rank\s*(\d+)$/i.exec(value.trim());
    if (numeric?.[1] !== undefined) {
      const n = Number(numeric[1]);
      // "Rank 20" is Codex's name for the last rank, not an out-of-range index.
      if (n === 20) return Rank.MythicII;
      return n >= 0 && n < RANK_NAMES.length ? (n as Rank) : undefined;
    }
  }
  return parseRankName(value);
};

const parseRankName = parser<Rank>(RANK_LOOKUP, 'rank');

export const parseGrandAlliance = parser<GrandAlliance>(
  GRAND_ALLIANCE_LOOKUP,
  'grand alliance',
);
export const parseCampaignType = parser<CampaignType>(CAMPAIGN_TYPE_LOOKUP, 'campaign type');
export const parseEquipmentSlot = parser<EquipmentSlot>(EQUIPMENT_SLOT_LOOKUP, 'equipment slot');

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

const name = (names: readonly string[]) => (value: number): string =>
  names[value] ?? `Unknown(${value})`;

export const rarityName = name(RARITY_NAMES);
export const rankName = name(RANK_NAMES);
export const grandAllianceName = name(GRAND_ALLIANCE_NAMES);
export const campaignTypeName = name(CAMPAIGN_TYPE_NAMES);
export const equipmentSlotName = name(EQUIPMENT_SLOT_NAMES);
