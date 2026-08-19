/**
 * Builds the normalized {@link GameDatabase} from raw sources.
 *
 * Everything source-specific is resolved here:
 * - ids are converted to the Tacticus API convention;
 * - strings become integer enums;
 * - the two battle-location formats collapse to `{ campaignId, nodeNumber }`;
 * - per-campaign-type drop rates are projected onto individual nodes;
 * - Codex's placeholder `stars` / `rarity` are backfilled from NPC stat rows.
 */

import {
  Rarity,
  parseCampaignType,
  parseGrandAlliance,
  parseRank,
  parseRarity,
  type GrandAlliance,
} from './enums.js';
import {
  battleKey,
  canonicalNpcId,
  parseBattleRef,
  parseShardReward,
  type BattleRef,
  type UnitId,
  type UpgradeId,
} from './ids.js';
import { PROGRESSION_SHARD_CORRECTIONS } from './corrections.js';
import type {
  RawCodexBattleData,
  RawCodexCampaignConfigs,
  RawCodexLevelProgressions,
  RawCodexOrbPromotionRequirements,
  RawCodexUnitLevels,
} from './sources/codex.js';
import type {
  RawGameInfo,
  RawGameInfoHero,
  RawGameInfoStatRow,
} from './sources/gameinfo.js';
import type {
  AbilityDefinition,
  AbilityUpgradeCost,
  BattleDefinition,
  BattleEnemy,
  CampaignDefinition,
  DropRates,
  GameDatabase,
  ItemDefinition,
  NpcDefinition,
  NpcStatRow,
  UnitDefinition,
  UnitRankStats,
  ProgressionKind,
  ProgressionRequirement,
  RarityCap,
  UnitRankUpgrade,
  UpgradeDefinition,
  XpBookDefinition,
  XpLevel,
} from './types.js';

const nn = (value: number | null | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const str = (value: string | null | undefined): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * Result of {@link compact}: keys that could hold `undefined` become genuinely
 * optional, which is what `exactOptionalPropertyTypes` requires at the
 * assignment site.
 */
type Compacted<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Delete `undefined` values in place and re-type the result as optional. */
function compact<T extends object>(value: T): Compacted<T> {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value as unknown as Compacted<T>;
}

/* -------------------------------------------------------------------------- */
/* Units                                                                      */
/* -------------------------------------------------------------------------- */

function normalizeRankUpgrades(
  rows: RawGameInfoHero['ranks'] extends (infer R)[] | null | undefined ? R : never,
): UnitRankUpgrade[] {
  const source = rows?.upgrades ?? rows?.basicUpgrades ?? [];
  const merged = new Map<UpgradeId, UnitRankUpgrade>();
  for (const entry of source) {
    if (!entry?.upgradeId) continue;
    const existing = merged.get(entry.upgradeId);
    const amount = nn(entry.amount) ?? 1;
    if (existing) {
      existing.amount += amount;
      continue;
    }
    merged.set(
      entry.upgradeId,
      compact({
        upgradeId: entry.upgradeId,
        amount,
        statIncrease: nn(entry.statIncrease),
        statType: str(entry.statType),
      }),
    );
  }
  return [...merged.values()];
}

function normalizeUnit(hero: RawGameInfoHero, isMachineOfWar: boolean): UnitDefinition | undefined {
  const id = str(hero.gameId);
  if (!id) return undefined;

  const ranks: UnitRankStats[] = [];
  for (const raw of hero.ranks ?? []) {
    const rank = parseRank(raw.level);
    if (rank === undefined) continue;
    ranks.push(
      compact({
        rank,
        health: nn(raw.health) ?? 0,
        damage: nn(raw.damage) ?? 0,
        armour: nn(raw.armor) ?? 0,
        upgrades: normalizeRankUpgrades(raw),
      }),
    );
  }
  ranks.sort((a, b) => a.rank - b.rank);

  return compact({
    id,
    name: hero.name,
    fullName: str(hero.longName),
    factionId: str(hero.factionId),
    grandAlliance: parseGrandAlliance(hero.allianceId ?? undefined),
    baseRarity: parseRarity(hero.baseRarity ?? undefined),
    movement: nn(hero.movement),
    itemSlots: hero.itemSlots ?? [],
    traits: hero.traits ?? [],
    activeAbilityId: str(hero.activeAbility),
    passiveAbilityId: str(hero.passiveAbility),
    mythicAbilityIds: hero.mythicAbilities ?? [],
    ranks,
    isMachineOfWar,
  });
}

/* -------------------------------------------------------------------------- */
/* NPCs                                                                       */
/* -------------------------------------------------------------------------- */

function normalizeStatRow(raw: RawGameInfoStatRow): NpcStatRow | undefined {
  const rank = parseRank(raw.rank);
  if (rank === undefined) return undefined;
  return compact({
    rank,
    stars: nn(raw.stars) ?? 0,
    rarity: parseRarity(raw.rarity ?? undefined),
    health: nn(raw.health),
    damage: nn(raw.damage),
    armour: nn(raw.armor),
    abilityLevel: nn(raw.abilityLevel),
  });
}

/* -------------------------------------------------------------------------- */
/* Battles                                                                    */
/* -------------------------------------------------------------------------- */

function normalizeDropRates(raw: RawCodexCampaignConfigs['configs']): Map<number, DropRates> {
  const byType = new Map<number, DropRates>();
  for (const config of raw ?? []) {
    const type = parseCampaignType(config.type);
    if (type === undefined) continue;
    const d = config.dropRate;
    byType.set(type, {
      common: nn(d?.common) ?? 0,
      uncommon: nn(d?.uncommon) ?? 0,
      rare: nn(d?.rare) ?? 0,
      epic: nn(d?.epic) ?? 0,
      legendary: nn(d?.legendary) ?? 0,
      shard: nn(d?.shard) ?? 0,
    });
  }
  return byType;
}

/* -------------------------------------------------------------------------- */
/* Star progression                                                           */
/* -------------------------------------------------------------------------- */

interface ProgressionResult {
  requirements: ProgressionRequirement[];
  gaps: number[];
  conflicts: number[];
}

/**
 * Merge the two Codex progression tables into one per-star-level table.
 *
 * See {@link ProgressionRequirement} for why orbs come from one source and
 * shards from the other. Levels present in either source produce a row, so a
 * level the shard table skips still appears — with `shards` absent and its
 * index reported in {@link GameDatabaseStats.progressionGaps}. Indices where
 * `unitlevel`'s orb column contradicts the orb table are reported in
 * {@link GameDatabaseStats.progressionConflicts}; the orb table always wins.
 */
function normalizeProgression(
  unitLevels: RawCodexUnitLevels | undefined,
  orbPromotions: RawCodexOrbPromotionRequirements | undefined,
): ProgressionResult {
  const shardRows = new Map<number, { shards: number; rarity: Rarity | undefined; orbs: number }>();
  for (const row of unitLevels?.unitLevels ?? []) {
    const index = nn(row.rank);
    if (index === undefined) continue;
    // Duplicated rows exist and repeat the same values; first wins.
    if (shardRows.has(index)) continue;
    shardRows.set(index, {
      shards: nn(row.shards) ?? 0,
      rarity: parseRarity(row.level),
      orbs: nn(row.orbs) ?? 0,
    });
  }

  const orbRows = new Map<number, { orbs: number; rarity: Rarity | undefined }>();
  for (const row of orbPromotions?.requirements ?? []) {
    const index = nn(row.level);
    if (index === undefined) continue;
    orbRows.set(index, { orbs: nn(row.qty) ?? 0, rarity: parseRarity(row.orbType) });
  }

  const corrections = new Map(
    PROGRESSION_SHARD_CORRECTIONS.map((c) => [c.progressionIndex, c.shards]),
  );

  const indices = [
    ...new Set([...shardRows.keys(), ...orbRows.keys(), ...corrections.keys()]),
  ].sort((a, b) => a - b);
  const requirements: ProgressionRequirement[] = [];
  const gaps: number[] = [];
  const conflicts: number[] = [];

  // An ascension is a step whose rarity differs from the step before it; a star
  // is added by every other step. Tracked across the loop since both depend on
  // the previous row.
  let previousRarity: Rarity | undefined;
  let starLevel = 0;

  for (const progressionIndex of indices) {
    const shardRow = shardRows.get(progressionIndex);
    const orbRow = orbRows.get(progressionIndex);

    if (!shardRow && !corrections.has(progressionIndex)) gaps.push(progressionIndex);

    // Orbs come exclusively from the orb table. `unitlevel`'s orb column agrees
    // with it at nine indices and never supplies a requirement the orb table
    // lacks -- except at index 5, where it reports a requirement the dedicated
    // table places at index 6. Falling back to it therefore only ever adds a
    // phantom cost, so it is recorded as a disagreement and otherwise ignored.
    const disputed =
      shardRow !== undefined && shardRow.orbs !== (orbRow?.orbs ?? 0);
    if (disputed) conflicts.push(progressionIndex);

    const orbs = orbRow?.orbs;
    const rarity = shardRow?.rarity ?? inferProgressionRarity(progressionIndex, shardRows);

    const kind: ProgressionKind | undefined =
      previousRarity === undefined || rarity === undefined
        ? progressionIndex === 0
          ? 'promotion'
          : undefined
        : rarity === previousRarity
          ? 'promotion'
          : 'ascension';
    if (progressionIndex > 0 && kind === 'promotion') starLevel += 1;
    previousRarity = rarity ?? previousRarity;

    // A correction supplies the value where the source is silent or wrong.
    const corrected = corrections.get(progressionIndex);
    const shards = corrected ?? shardRow?.shards;

    requirements.push(
      compact({
        progressionIndex,
        rarity,
        kind,
        starLevel,
        shards,
        shardType:
          shards === undefined
            ? undefined
            : rarity === Rarity.Mythic
              ? ('mythic' as const)
              : ('regular' as const),
        shardsSource:
          shards === undefined
            ? undefined
            : corrected !== undefined
              ? ('gameUi' as const)
              : ('unitLevel' as const),
        orbs,
        orbRarity: orbRow?.rarity,
        orbsDisputed: disputed ? true : undefined,
      }),
    );
  }

  return { requirements, gaps, conflicts };
}

/**
 * Rarity for a star level the shard table omits, taken from its neighbours.
 * Star levels run in contiguous rarity bands, so a missing row sits in the same
 * band as the next level that is present.
 */
function inferProgressionRarity(
  index: number,
  rows: Map<number, { rarity: Rarity | undefined }>,
): Rarity | undefined {
  for (let probe = index + 1; probe <= index + 3; probe += 1) {
    const rarity = rows.get(probe)?.rarity;
    if (rarity !== undefined) return rarity;
  }
  return undefined;
}

/**
 * Extract the level ceiling for each rarity.
 *
 * Codex publishes these only as free-text annotations on its `levelprogression`
 * rows (`"Max Common Level"`), so the parse is deliberately narrow and simply
 * yields nothing when the wording changes. The values it finds for Common (8)
 * and Uncommon (17) match the game's own progression panel.
 */
function normalizeRarityCaps(source: RawCodexLevelProgressions | undefined): RarityCap[] {
  const caps: RarityCap[] = [];
  for (const row of source?.levels ?? []) {
    const matched = /^max\s+(\w+)\s+level$/i.exec((row.notes ?? '').trim());
    if (!matched?.[1]) continue;
    const rarity = parseRarity(matched[1]);
    const maxLevel = nn(row.level);
    if (rarity === undefined || maxLevel === undefined) continue;
    caps.push({ rarity, maxLevel });
  }
  return caps.sort((a, b) => a.rarity - b.rarity);
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export interface NormalizeInput {
  gameInfo: RawGameInfo;
  codexBattleData?: RawCodexBattleData | undefined;
  codexCampaignConfigs?: RawCodexCampaignConfigs | undefined;
  codexUnitLevels?: RawCodexUnitLevels | undefined;
  codexOrbPromotions?: RawCodexOrbPromotionRequirements | undefined;
  codexLevelProgression?: RawCodexLevelProgressions | undefined;
}

export function normalize(input: NormalizeInput): GameDatabase {
  const { gameInfo } = input;

  /* ---- units ---------------------------------------------------------- */
  const units: Record<UnitId, UnitDefinition> = {};
  for (const hero of Object.values(gameInfo.heroes ?? {})) {
    const unit = normalizeUnit(hero, false);
    if (unit) units[unit.id] = unit;
  }
  for (const mow of Object.values(gameInfo.machinesOfWar ?? {})) {
    const unit = normalizeUnit(mow, true);
    if (unit) units[unit.id] = unit;
  }

  /** Display name -> unit id, for sources that reference units by name. */
  const unitIdByName = new Map<string, UnitId>();
  for (const unit of Object.values(units)) {
    unitIdByName.set(unit.name.toLowerCase(), unit.id);
    if (unit.fullName) unitIdByName.set(unit.fullName.toLowerCase(), unit.id);
  }

  /* ---- npcs ----------------------------------------------------------- */
  const npcs: Record<string, NpcDefinition> = {};
  for (const [key, raw] of Object.entries(gameInfo.npcs ?? {})) {
    const stats = (raw.stats ?? [])
      .map(normalizeStatRow)
      .filter((row): row is NpcStatRow => row !== undefined)
      .sort((a, b) => a.rank - b.rank);
    npcs[key] = compact({
      id: str(raw.id) ?? key,
      name: raw.name,
      factionId: str(raw.factionId),
      grandAlliance: parseGrandAlliance(raw.allianceId ?? undefined),
      movement: nn(raw.movement),
      traits: raw.traits ?? [],
      stats,
    });
  }

  /* ---- upgrades ------------------------------------------------------- */
  const upgrades: Record<UpgradeId, UpgradeDefinition> = {};
  const unresolvedBattleRefs = new Set<string>();
  for (const [id, raw] of Object.entries(gameInfo.upgrades ?? {})) {
    const farmableAt: BattleRef[] = [];
    for (const location of [...(raw.battles ?? []), ...(raw.battlesCE ?? [])]) {
      const ref = parseBattleRef(location);
      if (ref) farmableAt.push(ref);
      else unresolvedBattleRefs.add(location);
    }
    upgrades[id] = compact({
      id,
      name: raw.name,
      rarity: parseRarity(raw.rarity ?? undefined),
      statType: str(raw.statType),
      crafting: raw.crafting ?? {},
      baseUpgrades: raw.baseUpgrades ?? {},
      farmableAt,
    });
  }

  /* ---- items ---------------------------------------------------------- */
  const items: Record<string, ItemDefinition> = {};
  for (const [key, raw] of Object.entries(gameInfo.items ?? {})) {
    items[key] = compact({
      id: str(raw.gameId) ?? key,
      name: raw.name,
      itemType: raw.itemType,
      rarity: parseRarity(raw.rarity ?? undefined),
      nextInSeries: str(raw.nextInSeries),
      levels: (raw.levels ?? []).map((level, index) =>
        compact({
          level: index + 1,
          stats: level.stats ?? {},
          dustCost: nn(level.dustCost),
          goldCost: nn(level.goldCost),
          mythicDustCost: nn(level.mythicDustCost),
        }),
      ),
      allowedFactions: raw.allowedFactions ?? [],
    });
  }

  /* ---- abilities ------------------------------------------------------ */
  const abilities: Record<string, AbilityDefinition> = {};
  for (const [key, raw] of Object.entries(gameInfo.abilities ?? {})) {
    abilities[key] = compact({
      id: str(raw.gameId) ?? key,
      name: raw.name,
      description: str(raw.description),
    });
  }

  /* ---- progression ---------------------------------------------------- */
  const xpLevels: XpLevel[] = [];
  const rawXp = gameInfo.xpLevels ?? [];
  for (let index = 0; index < rawXp.length; index += 1) {
    const total = rawXp[index] ?? 0;
    const previous = index === 0 ? 0 : (rawXp[index - 1] ?? 0);
    xpLevels.push({ level: index + 1, xpToNextLevel: total - previous, totalXp: previous });
  }

  const xpBooks: XpBookDefinition[] = (gameInfo.xpBooks ?? []).map((book) =>
    compact({
      id: book.id,
      rarity: parseRarity(book.rarity) ?? 0,
      xpIncrease: book.xpIncrease,
      gold: book.gold,
    }),
  );

  const abilityUpgradeCosts: AbilityUpgradeCost[] = (
    gameInfo.abilityUpgradeCosts?.abilityUpgradeCosts ?? []
  ).map((cost, index) =>
    compact({
      level: index + 1,
      gold: nn(cost.gold) ?? 0,
      badgeType: cost.badgeType,
      badgeRarity: parseRarity(cost.badgeType.replace(/^abilityToken/i, '')),
      amount: nn(cost.amount) ?? 0,
    }),
  );

  /* ---- star progression ------------------------------------------------ */
  const progression = normalizeProgression(input.codexUnitLevels, input.codexOrbPromotions);
  const rarityCaps = normalizeRarityCaps(input.codexLevelProgression);

  /* ---- campaigns and battles ------------------------------------------ */
  const dropRatesByType = normalizeDropRates(input.codexCampaignConfigs?.configs);
  const campaigns: Record<string, CampaignDefinition> = {};
  const unresolvedNpcIds = new Set<string>();
  let enemiesResolved = 0;
  let enemiesTotal = 0;
  let battleCount = 0;

  for (const raw of input.codexBattleData?.battles ?? []) {
    const ref = parseBattleRef(raw.locationId);
    if (!ref) {
      unresolvedBattleRefs.add(raw.locationId);
      continue;
    }
    const campaignType = parseCampaignType(raw.campaignType);

    const enemies: BattleEnemy[] = [];
    for (const enemy of raw.detailedEnemyTypes ?? []) {
      if (!enemy?.name) continue;
      enemiesTotal += 1;
      const npcId = canonicalNpcId(enemy.name);
      const npc = npcs[npcId];
      if (!npc) unresolvedNpcIds.add(enemy.name);

      const rank = parseRank(enemy.rank);
      const row = npc?.stats.find((candidate) => candidate.rank === rank);
      if (row) enemiesResolved += 1;

      enemies.push(
        compact({
          npcId,
          sourceNpcId: enemy.name,
          count: enemy.count,
          rank,
          // Codex always sends 0 / "Unknown" here. Prefer the NPC stat row when
          // it covers this rank; otherwise keep the source value as a placeholder.
          stars: row?.stars ?? nn(enemy.stars) ?? 0,
          rarity: row?.rarity ?? parseRarity(enemy.rarity ?? undefined),
          health: row?.health,
          damage: row?.damage,
          armour: row?.armour,
          statsResolved: row !== undefined,
        }),
      );
    }

    const reward = str(raw.reward);
    const shardName = reward ? parseShardReward(reward) : undefined;
    const shardUnitId = shardName ? unitIdByName.get(shardName.toLowerCase()) : undefined;
    const rewardUpgradeId = reward && upgrades[reward] ? reward : undefined;

    const dropRates = campaignType === undefined ? undefined : dropRatesByType.get(campaignType);

    const battle: BattleDefinition = compact({
      ...ref,
      key: battleKey(ref),
      campaignType,
      slots: nn(raw.slots),
      expectedGold: nn(raw.expectedGold),
      enemiesTotal: nn(raw.enemiesTotal),
      enemies,
      enemyFactions: raw.enemiesFactions ?? [],
      enemyAlliances: (raw.enemiesAlliances ?? [])
        .map((alliance) => parseGrandAlliance(alliance))
        .filter((alliance): alliance is GrandAlliance => alliance !== undefined),
      rewardUpgradeId,
      rewardShardUnitId: shardUnitId,
      rewardRaw: reward && !rewardUpgradeId && !shardUnitId ? reward : undefined,
      dropRates,
      // No source publishes per-node rates yet; these are the campaign type's.
      dropRateProvenance: dropRates ? ('campaignType' as const) : undefined,
    });

    const campaign = (campaigns[ref.campaignId] ??= {
      id: ref.campaignId,
      battles: {},
    });
    if (campaign.name === undefined) {
      const campaignName = str(raw.campaign);
      if (campaignName !== undefined) campaign.name = campaignName;
    }
    if (campaign.type === undefined && campaignType !== undefined) {
      campaign.type = campaignType;
    }
    campaign.battles[battle.key] = battle;
    battleCount += 1;
  }

  return {
    sources: compact({
      gameInfoVersion: str(gameInfo.version),
      gameInfoId: str(gameInfo.id),
      codexBattleData: Boolean(input.codexBattleData),
    }),
    fetchedAt: Date.now(),
    units,
    upgrades,
    items,
    abilities,
    npcs,
    campaigns,
    xpLevels,
    xpBooks,
    abilityUpgradeCosts,
    progressionRequirements: progression.requirements,
    rarityCaps,
    stats: {
      units: Object.keys(units).length,
      upgrades: Object.keys(upgrades).length,
      items: Object.keys(items).length,
      abilities: Object.keys(abilities).length,
      npcs: Object.keys(npcs).length,
      campaigns: Object.keys(campaigns).length,
      battles: battleCount,
      enemiesResolved,
      enemiesTotal,
      unresolvedNpcIds: [...unresolvedNpcIds].sort(),
      unresolvedBattleRefs: [...unresolvedBattleRefs].sort(),
      progressionGaps: progression.gaps,
      progressionConflicts: progression.conflicts,
    },
  };
}

