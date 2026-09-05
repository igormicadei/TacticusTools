/**
 * Building a squad: filtering the roster, capping it to a rarity, moving
 * equipment around, and picking five for a node.
 *
 * Written as classes over the plain `GameDatabase` and `PlayerResponse` records
 * the rest of this library uses, so the pieces compose: a {@link RarityCeiling} is
 * useful on its own on a unit page, a {@link RosterQuery} is the same filter the
 * roster view wants, and {@link EquipmentPool} answers "what could this unit
 * wear" whether or not a team is involved.
 *
 * Everything that computes a stat goes through `computeUnitStats`, which is
 * checked against real character screens. Capping therefore does not reimplement
 * the stat formula: it produces a *capped unit* and hands that to the same
 * function, so the two can never drift.
 */

import {
  CampaignType,
  GRAND_ALLIANCE_NAMES,
  Rarity,
  rarityName,
  type GrandAlliance,
  type Rank,
} from './enums.js';
import { computeUnitStats, type ComputedUnitStats } from './stats.js';
import { unitCombat, type AttackProfile, type UnitCombat } from './combat.js';
import { levelToCompleteRank } from './plan.js';
import type { UnitId } from './ids.js';
import type {
  BattleDefinition,
  CampaignDefinition,
  GameDatabase,
  ItemDefinition,
  UnitDefinition,
} from './types.js';
import type { Item, PlayerResponse, Unit, UnitItem } from '../types/player.js';

/* -------------------------------------------------------------------------- */
/* Rarity caps                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The XP level a rarity cannot pass, for rarities the config does not list.
 *
 * `db.rarityCaps` stops at Legendary; the wiki gives 60 for Mythic as of v1.37
 * and flags that sources have disagreed (60 vs 65), so it is kept here as a
 * documented fallback rather than pretended to be config.
 */
const MYTHIC_LEVEL_CAP = 60;

/**
 * How far a rarity can be ranked, and why it is derived rather than looked up.
 *
 * No source publishes a rank-per-rarity table. The game does not need one: a
 * rank's second row of upgrades is gated on XP level, XP level is capped by
 * rarity, and so rank is capped transitively — which is exactly how the wiki
 * describes it ("rarity ... is tied indirectly to the number of stars and the
 * upgrade ranks you can have").
 *
 * Deriving it from the two tables we do have reproduces the caps the game's own
 * history names — Common to Iron I, Uncommon to Bronze I, Rare to Silver I,
 * Epic to Gold I, Legendary to Diamond III — and no unit in a real roster
 * exceeds it. `test/validate-teams.mjs` re-checks that against the live roster
 * rather than trusting this comment.
 */
function deriveRankCap(rarity: Rarity, db: GameDatabase): Rank {
  const levelCap = levelCapFor(rarity, db);
  let highest = 0;
  for (let rank = 0; ; rank += 1) {
    const gate = levelToCompleteRank(rank as Rank);
    if (gate === undefined) break;
    // Completing rank R is what unlocks R+1, so a reachable gate means the
    // unit can stand at the rank above it.
    if (gate <= levelCap) highest = rank + 1;
    else break;
  }
  return highest as Rank;
}

function levelCapFor(rarity: Rarity, db: GameDatabase): number {
  const row = db.rarityCaps.find((c) => c.rarity === rarity);
  if (row) return row.maxLevel;
  // Above the published table: Mythic, and any rarity a future patch adds.
  return Math.max(MYTHIC_LEVEL_CAP, ...db.rarityCaps.map((c) => c.maxLevel));
}

/** Highest progression index that still belongs to a rarity. */
function maxProgressionIndexFor(rarity: Rarity, db: GameDatabase): number {
  let highest = -1;
  for (const row of db.progressionRequirements) {
    if (row.rarity !== undefined && row.rarity <= rarity) {
      highest = Math.max(highest, row.progressionIndex);
    }
  }
  return highest;
}

/** A unit as a cap leaves it, beside what it was. */
export interface CapEffect {
  /** True when the cap changed anything at all. */
  capped: boolean;
  rarity: { from: Rarity | undefined; to: Rarity | undefined };
  rank: { from: Rank; to: Rank };
  xpLevel: { from: number; to: number };
  progressionIndex: { from: number; to: number };
  /** Equipment the cap swapped for a lower member of its own series. */
  items: { slotId: string; from: string; to: string }[];
}

/**
 * A rarity ceiling, as Tournament Arena, Guild War, Incursion, Survival and
 * Quest impose one.
 *
 * What a cap touches, from the wiki's Quest page — "characters are capped at the
 * respective rarity (this regards gear ranks, skill values, and item stats)" —
 * and Survival's "unit stats only scale down, not up":
 *
 * - **Rarity and stars.** Progression index falls to the last index of the
 *   capped rarity, which drops both the tier and the star multiplier with it.
 * - **Rank.** Falls to {@link deriveRankCap}'s ceiling for the rarity.
 * - **XP level**, and with it ability level, falls to `db.rarityCaps`.
 * - **Equipment.** An item above the cap is replaced by its own series' member
 *   at the capped rarity, at that member's top level — `nextInSeries` chains
 *   Standard-Issue → Battle-Hardened → Sanctified → Master-Crafted → Artificer
 *   Bolt Pistol, whose level counts are 3/5/7/9/11, exactly the ceilings the
 *   wiki publishes for each cap.
 *
 * A cap never raises anything: a Rare unit under an Epic cap is untouched.
 */
export class RarityCeiling {
  readonly rarity: Rarity;
  readonly levelCap: number;
  readonly rankCap: Rank;
  readonly progressionCap: number;

  constructor(rarity: Rarity, private readonly db: GameDatabase) {
    this.rarity = rarity;
    this.levelCap = levelCapFor(rarity, db);
    this.rankCap = deriveRankCap(rarity, db);
    this.progressionCap = maxProgressionIndexFor(rarity, db);
  }

  get name(): string {
    return rarityName(this.rarity);
  }

  /**
   * The unit as this cap leaves it.
   *
   * Returns the same object when nothing changes, so callers can compare by
   * identity to know whether a cap bit.
   */
  apply(unit: Unit): Unit {
    const rank = Math.min(unit.rank, this.rankCap);
    const xpLevel = Math.min(unit.xpLevel, this.levelCap);
    const progressionIndex = Math.min(unit.progressionIndex, this.progressionCap);
    const items = unit.items.map((item) => this.capItem(item));
    const abilities = unit.abilities.map((ability) =>
      ability.level <= xpLevel ? ability : { ...ability, level: xpLevel },
    );

    const itemsMoved = items.some((item, i) => item !== unit.items[i]);
    const abilitiesMoved = abilities.some((a, i) => a !== unit.abilities[i]);
    if (
      rank === unit.rank &&
      xpLevel === unit.xpLevel &&
      progressionIndex === unit.progressionIndex &&
      !itemsMoved &&
      !abilitiesMoved
    ) {
      return unit;
    }

    return {
      ...unit,
      rank,
      xpLevel,
      progressionIndex,
      items,
      abilities,
      // A unit that has progressed past this rank completed every one of its
      // upgrade slots on the way through, so at the capped rank they are all
      // applied. Keeping only the indices it happens to have filled at its
      // *current* rank would report a Gold unit capped to Silver as though it
      // had never upgraded there, which is the "scale up" the game forbids in
      // reverse.
      upgrades:
        rank < unit.rank ? this.allUpgradeSlots(unit.id, rank) : unit.upgrades,
    };
  }

  /** What the cap did, for showing beside the capped figures. */
  describe(unit: Unit): CapEffect {
    const capped = this.apply(unit);
    const rarityOf = (index: number) =>
      this.db.progressionRequirements.find((r) => r.progressionIndex === index)?.rarity;
    return {
      capped: capped !== unit,
      rarity: { from: rarityOf(unit.progressionIndex), to: rarityOf(capped.progressionIndex) },
      rank: { from: unit.rank as Rank, to: capped.rank as Rank },
      xpLevel: { from: unit.xpLevel, to: capped.xpLevel },
      progressionIndex: { from: unit.progressionIndex, to: capped.progressionIndex },
      items: unit.items
        .map((item, i) => ({ item, replacement: capped.items[i] }))
        .filter(({ item, replacement }) => replacement && replacement.id !== item.id)
        .map(({ item, replacement }) => ({
          slotId: item.slotId,
          from: item.id,
          to: replacement!.id,
        })),
    };
  }

  /**
   * Walk an item down its own series to the capped rarity.
   *
   * 128 of the 167 items above Common chain all the way down; the rest have no
   * lower counterpart in the data, and are left at their own rarity with the
   * level clamped, which is the closest honest answer available.
   */
  private capItem(item: UnitItem): UnitItem {
    const definition = this.db.items[item.id];
    if (!definition) return item;

    let current: ItemDefinition = definition;
    while ((current.rarity ?? 0) > this.rarity) {
      const lower = this.previousInSeries(current.id);
      if (!lower) break;
      current = lower;
    }

    // At or below the cap the item keeps its level; above it, it functions at
    // the top of whatever member the chain reached.
    const level =
      current.id === item.id
        ? Math.min(item.level, current.levels.length)
        : current.levels.length;
    if (current.id === item.id && level === item.level) return item;
    return {
      ...item,
      id: current.id,
      level,
      ...(current.name ? { name: current.name } : {}),
      ...(current.rarity !== undefined ? { rarity: rarityName(current.rarity) } : {}),
    } as UnitItem;
  }

  #series: Map<string, ItemDefinition> | undefined;

  private previousInSeries(id: string): ItemDefinition | undefined {
    this.#series ??= new Map(
      Object.values(this.db.items)
        .filter((item) => item.nextInSeries)
        .map((item) => [item.nextInSeries!, item]),
    );
    return this.#series.get(id);
  }

  private allUpgradeSlots(unitId: UnitId, rank: number): number[] {
    const slots = this.db.units[unitId]?.ranks.find((r) => r.rank === rank)?.upgrades ?? [];
    return slots.map((_, index) => index);
  }
}

/* -------------------------------------------------------------------------- */
/* One candidate for a team                                                   */
/* -------------------------------------------------------------------------- */

/** The best pierce floor among a set of attacks. */
function bestEffective(attacks: readonly AttackProfile[]): number {
  let best = 0;
  for (const attack of attacks) best = Math.max(best, attack.effective?.mid ?? 0);
  return best;
}

/** How a roster row can be ordered. */
export type SortKey =
  | 'name'
  | 'health'
  | 'damage'
  | 'armour'
  /** Best pierce floor from any attack, normal or ability. */
  | 'effective'
  /** Best pierce floor from the melee and ranged weapons only. */
  | 'effectiveNormal'
  /** Best pierce floor from the abilities only. */
  | 'effectiveAbility'
  | 'rank'
  | 'rarity';

/** What a roster row can be narrowed by. Every field is optional and ANDed. */
export interface UnitFilter {
  query?: string;
  factions?: readonly string[];
  alliances?: readonly string[];
  rarities?: readonly Rarity[];
  minRank?: Rank;
  maxRank?: Rank;
  /** Damage profiles the unit can deal, from any attack it has. */
  damageTypes?: readonly string[];
  /** Trait ids the unit must have — all of them, not any. */
  traits?: readonly string[];
  /** Restrict to a battle's deployable set, when one applies. */
  battle?: BattleDefinition;
}

/**
 * One of the player's units, with its stats and attacks resolved lazily.
 *
 * Lazily because a roster of 128 units times a filter change is a lot of
 * `unitCombat` calls, and a filter usually rejects a unit long before its
 * attacks matter. Each instance is bound to one cap, so switching the cap makes
 * new instances rather than mutating these — which is what keeps a capped view
 * from leaking into an uncapped one.
 */
export class RosterUnit {
  readonly unit: Unit;
  readonly definition: UnitDefinition | undefined;
  readonly cap: RarityCeiling | undefined;
  /** The unit as the cap leaves it; the same object when no cap applies. */
  readonly effective: Unit;

  #stats: ComputedUnitStats | undefined | null = null;
  #combat: UnitCombat | undefined | null = null;

  constructor(unit: Unit, private readonly db: GameDatabase, cap?: RarityCeiling) {
    this.unit = unit;
    this.definition = db.units[unit.id];
    this.cap = cap;
    this.effective = cap ? cap.apply(unit) : unit;
  }

  get id(): UnitId {
    return this.unit.id;
  }
  get name(): string {
    return this.unit.name ?? this.definition?.name ?? this.unit.id;
  }
  get factionId(): string {
    return this.unit.faction ?? this.definition?.factionId ?? 'Unknown';
  }
  /**
   * The alliance as a word.
   *
   * The player API sends `"Chaos"`; the game config sends the `GrandAlliance`
   * enum. Either can be missing, so both are normalised here rather than at
   * every call site.
   */
  get alliance(): string {
    if (this.unit.grandAlliance) return this.unit.grandAlliance;
    const fromConfig = this.definition?.grandAlliance;
    return fromConfig === undefined ? 'Unknown' : (GRAND_ALLIANCE_NAMES[fromConfig] ?? 'Unknown');
  }
  get traits(): readonly string[] {
    return this.definition?.traits ?? [];
  }
  /** True when a cap actually changed this unit. */
  get isCapped(): boolean {
    return this.effective !== this.unit;
  }

  get stats(): ComputedUnitStats | undefined {
    if (this.#stats === null) this.#stats = computeUnitStats(this.effective, this.db);
    return this.#stats;
  }

  get combat(): UnitCombat | undefined {
    if (this.#combat === null) {
      const stats = this.stats;
      this.#combat = stats
        ? unitCombat(
            this.effective,
            stats.damage,
            stats.rarity,
            this.db,
            stats.itemBonuses.critChance,
          )
        : undefined;
    }
    return this.#combat ?? undefined;
  }

  /** Every attack this unit has, normal and ability alike. */
  get attacks(): AttackProfile[] {
    const combat = this.combat;
    if (!combat) return [];
    return [
      ...(combat.melee ? [combat.melee] : []),
      ...(combat.ranged ? [combat.ranged] : []),
      ...combat.abilityAttacks,
    ];
  }

  get damageTypes(): string[] {
    return [...new Set(this.attacks.map((a) => a.damageProfile))];
  }

  /**
   * The unit's normal attack — its melee and ranged weapons.
   *
   * Kept apart from its abilities throughout, because they are not the same
   * kind of resource: a normal attack happens every turn, while an active
   * ability usually fires once a battle. A unit whose whole output is one big
   * ability is a different tactical proposition from one that grinds the same
   * damage out every round, and averaging the two hides exactly that.
   */
  get normalAttacks(): AttackProfile[] {
    return this.attacks.filter((attack) => attack.source !== 'ability');
  }

  get abilityAttacks(): AttackProfile[] {
    return this.attacks.filter((attack) => attack.source === 'ability');
  }

  /**
   * The largest damage the unit lands through any armour, across its attacks.
   *
   * The pierce floor rather than the headline: two units with the same damage
   * are not equal if one of them is throwing Psychic and the other Physical.
   */
  get effectiveDamage(): number {
    return Math.max(this.normalEffectiveDamage, this.abilityEffectiveDamage);
  }

  /** {@link effectiveDamage} from the melee and ranged weapons alone. */
  get normalEffectiveDamage(): number {
    return bestEffective(this.normalAttacks);
  }

  /** {@link effectiveDamage} from the abilities alone, usually a one-off. */
  get abilityEffectiveDamage(): number {
    return bestEffective(this.abilityAttacks);
  }

  /** Highest unarmoured total across the unit's attacks. */
  get burstDamage(): number {
    let best = 0;
    for (const attack of this.attacks) best = Math.max(best, attack.total.mid);
    return best;
  }

  /**
   * Damage per attack with crits folded in at their own odds.
   *
   * A crit adds the item's flat Crit Damage to the hit, so over many hits an
   * attack lands `hits x (perHit + chance x critDmg)`. This is what makes a
   * Crit item worth anything to an optimiser: it moves no headline stat, and
   * without this it would price as zero.
   */
  get expectedDamage(): number {
    const bonuses = this.stats?.itemBonuses ?? {};
    const chance = Math.min(100, bonuses.critChance ?? 0) / 100;
    const critDamage = bonuses.critDmg ?? 0;
    let best = 0;
    for (const attack of this.attacks) {
      // An ability that states it cannot crit gets none of this, however much
      // Crit the unit is carrying — otherwise a Crit item prices well for a
      // unit whose best attack can never use it.
      const crit = attack.canCrit === false ? 0 : chance * critDamage;
      best = Math.max(best, attack.hits * (attack.perHit.mid + crit));
    }
    return best;
  }

  /**
   * Health, plus what armour and Block save over {@link HITS_ABSORBED} hits.
   *
   * Both are per-hit reductions rather than a pool, so they only convert into
   * health against an assumed number of incoming hits — see the constant.
   */
  get effectiveHealth(): number {
    const stats = this.stats;
    if (!stats) return 0;
    const bonuses = stats.itemBonuses;
    const blocked = (Math.min(100, bonuses.blockChance ?? 0) / 100) * (bonuses.blockDmg ?? 0);
    return stats.health + HITS_ABSORBED * (stats.armour + blocked);
  }

  value(key: SortKey): number | string {
    switch (key) {
      case 'name':
        return this.name;
      case 'health':
        return this.stats?.health ?? 0;
      case 'damage':
        return this.stats?.damage ?? 0;
      case 'armour':
        return this.stats?.armour ?? 0;
      case 'effective':
        return this.effectiveDamage;
      case 'effectiveNormal':
        return this.normalEffectiveDamage;
      case 'effectiveAbility':
        return this.abilityEffectiveDamage;
      case 'rank':
        return this.effective.rank;
      case 'rarity':
        return this.stats?.rarity ?? 0;
    }
  }

  matches(filter: UnitFilter): boolean {
    if (filter.query) {
      const q = filter.query.trim().toLowerCase();
      if (
        q &&
        !this.name.toLowerCase().includes(q) &&
        !this.factionId.toLowerCase().includes(q) &&
        !this.id.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    if (filter.factions?.length && !filter.factions.includes(this.factionId)) return false;
    if (filter.alliances?.length && !filter.alliances.includes(this.alliance)) return false;
    if (filter.rarities?.length) {
      const rarity = this.stats?.rarity;
      if (rarity === undefined || !filter.rarities.includes(rarity)) return false;
    }
    if (filter.minRank !== undefined && this.effective.rank < filter.minRank) return false;
    if (filter.maxRank !== undefined && this.effective.rank > filter.maxRank) return false;
    if (filter.traits?.length && !filter.traits.every((t) => this.traits.includes(t))) {
      return false;
    }
    if (filter.damageTypes?.length) {
      const mine = new Set(this.damageTypes);
      if (!filter.damageTypes.some((type) => mine.has(type))) return false;
    }
    return true;
  }
}

/** A filter and an order, applied to a roster. */
export class RosterQuery {
  constructor(
    readonly filter: UnitFilter = {},
    readonly sort: SortKey = 'name',
    readonly descending = true,
  ) {}

  with(changes: Partial<{ filter: UnitFilter; sort: SortKey; descending: boolean }>): RosterQuery {
    return new RosterQuery(
      changes.filter ?? this.filter,
      changes.sort ?? this.sort,
      changes.descending ?? this.descending,
    );
  }

  run(units: readonly RosterUnit[]): RosterUnit[] {
    const matched = units.filter((unit) => unit.matches(this.filter));
    const direction = this.sort === 'name' ? 1 : this.descending ? -1 : 1;
    return matched.sort((a, b) => {
      const left = a.value(this.sort);
      const right = b.value(this.sort);
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left).localeCompare(String(right)) * (this.sort === 'name' ? 1 : direction);
      }
      return (left - right) * direction || a.name.localeCompare(b.name);
    });
  }
}

/** Build one {@link RosterUnit} per owned unit, under an optional cap. */
export function buildRosterUnits(
  player: PlayerResponse,
  db: GameDatabase,
  cap?: RarityCeiling,
): RosterUnit[] {
  return player.player.units.map((unit) => new RosterUnit(unit, db, cap));
}

/* -------------------------------------------------------------------------- */
/* Equipment                                                                  */
/* -------------------------------------------------------------------------- */

/** One copy of a piece of equipment that could be assigned to somebody. */
export interface PoolItem {
  id: string;
  name: string;
  level: number;
  rarity: Rarity | undefined;
  itemType: string;
  /** Copies available at this level. */
  count: number;
  /** Unit it is currently worn by, when it is not loose in the inventory. */
  wornBy?: UnitId;
  slotId?: string;
}

/** Where an optimiser may draw equipment from. */
export type PoolScope =
  /** Only what the team's own members already wear. */
  | 'team'
  /** The team's gear plus everything unequipped in the inventory. */
  | 'team+inventory'
  /** Every item the player owns, worn by anyone or not. */
  | 'all';

/** One proposed move of an item onto a unit's slot. */
export interface Assignment {
  unitId: UnitId;
  slotId: string;
  item: PoolItem;
  /** What the unit wears there now, when anything. */
  replaces?: { id: string; name: string; level: number };
  /**
   * The team-mate this copy comes off, and the slot it leaves bare.
   *
   * Absent when the copy was loose. Present, it is half the plan: a move that
   * strips somebody is only worth making if you know who, and which slot of
   * theirs is now waiting on a later line.
   */
  takenFrom?: { unitId: UnitId; slotId: string; loss: number };
  /**
   * Change in the objective, across the whole squad.
   *
   * Net, not the receiver's own gain: an item taken off a team-mate costs what
   * they lose by not wearing it, and a move that reads as +414 on one unit can
   * leave the squad worse off. Summed over the plan this is what the squad
   * actually gains.
   */
  gain: number;
}

/** What an equipment layout or a squad is being optimised for. */
export type Objective = 'health' | 'armour' | 'damage' | 'effective' | 'offence' | 'defence';

/**
 * Incoming hits a unit is assumed to take, for turning armour and Block into
 * effective health.
 *
 * Armour and Block are *per hit* — armour subtracts from each incoming hit,
 * Block reduces a proportion of them — so neither has any value at all without
 * a count of hits to spread over, and the ratio between raw health and armour
 * is entirely a function of that count. Ten is a stated assumption, not a
 * published figure; the ranking it produces is stable for any reasonable value,
 * only the absolute numbers move.
 */
export const HITS_ABSORBED = 10;

/**
 * The equipment a set of units could wear, and who should wear it.
 *
 * The player API reports equipment twice over: `inventory.items` is what is
 * loose, and each unit's `items` is what it has on. Both are drawn from here, so
 * "optimise using the team's own gear" and "using everything I own" differ only
 * in which copies the pool was built from.
 *
 * Slots are not interchangeable — a unit's Defense slot is fixed to Block or
 * Defensive by the unit, and only Rare and above may wear a Booster at all — so
 * a candidate is only ever offered for the slot its own `itemType` matches, and
 * only to a unit whose faction the item permits.
 */
export class EquipmentPool {
  private readonly items: PoolItem[];

  private constructor(items: PoolItem[], private readonly db: GameDatabase) {
    this.items = items;
  }

  static from(
    player: PlayerResponse,
    db: GameDatabase,
    scope: PoolScope,
    teamIds: readonly UnitId[] = [],
  ): EquipmentPool {
    const items: PoolItem[] = [];
    const team = new Set(teamIds);

    const describe = (id: string, level: number): Omit<PoolItem, 'count'> | undefined => {
      const definition = db.items[id];
      if (!definition) return undefined;
      return {
        id,
        name: definition.name,
        level,
        ...(definition.rarity !== undefined ? { rarity: definition.rarity } : { rarity: undefined }),
        itemType: definition.itemType,
      };
    };

    if (scope !== 'team') {
      for (const loose of player.player.inventory.items as Item[]) {
        const base = describe(loose.id, loose.level ?? 1);
        if (base) items.push({ ...base, count: loose.amount });
      }
    }
    for (const unit of player.player.units) {
      const mine = team.has(unit.id);
      if (scope === 'team' && !mine) continue;
      if (scope === 'team+inventory' && !mine) continue;
      for (const worn of unit.items) {
        const base = describe(worn.id, worn.level);
        if (base) items.push({ ...base, count: 1, wornBy: unit.id, slotId: worn.slotId });
      }
    }
    return new EquipmentPool(items, db);
  }

  get size(): number {
    return this.items.reduce((n, item) => n + item.count, 0);
  }

  /** Every copy the pool holds, for a caller doing its own bookkeeping. */
  get all(): readonly PoolItem[] {
    return this.items;
  }

  /** Everything in the pool a unit is allowed to put in a given slot. */
  candidatesFor(unit: RosterUnit, slotId: string): PoolItem[] {
    const definition = unit.definition;
    const slotIndex = Number(slotId.replace(/\D+/g, '')) - 1;
    const wanted = definition?.itemSlots[slotIndex];
    const rarity = unit.stats?.rarity ?? Rarity.Common;

    return this.items.filter((item) => {
      const spec = this.db.items[item.id];
      if (!spec) return false;
      // The unit's slot fixes the category; a Block unit cannot wear a
      // Defensive item in that slot however good it is.
      if (wanted && spec.itemType !== wanted) return false;
      // A unit may wear its own rarity or lower, never higher.
      if ((spec.rarity ?? 0) > rarity) return false;
      // Only Rare and above may wear a Booster at all, whatever the slot says.
      if (spec.itemType.startsWith('I_Booster') && rarity < Rarity.Rare) return false;
      if (spec.allowedFactions.length > 0 && !spec.allowedFactions.includes(unit.factionId)) {
        return false;
      }
      return true;
    });
  }
}

/**
 * Score a unit for an objective, so layouts and squads can be compared.
 *
 * Health and damage are not commensurable and no published formula converts
 * between them, so there is no single "best" — the caller picks what it is
 * optimising and gets a consistent ordering within that choice.
 *
 * The two composites exist because equipment would otherwise be invisible to
 * this function. Of the ten stats equipment grants, six are Crit and Block:
 * 626 item levels carry Crit Chance and Crit Damage against 215 carrying
 * Health, so an objective reading only the headline stats would rate almost
 * every Crit item as worthless and optimise nothing.
 */
export function score(unit: RosterUnit, objective: Objective): number {
  const stats = unit.stats;
  if (!stats) return 0;
  switch (objective) {
    case 'health':
      return stats.health;
    case 'armour':
      return stats.armour;
    case 'damage':
      return stats.damage;
    case 'effective':
      return unit.effectiveDamage;
    case 'offence':
      return unit.expectedDamage;
    case 'defence':
      return unit.effectiveHealth;
  }
}

/**
 * Fit the best equipment the pool allows onto a set of units.
 *
 * Greedy, and honestly so: every (unit, slot, item) pairing is priced by what it
 * would add, the best is taken, the copy is spent, and the pass repeats. That is
 * not provably optimal — a generalised assignment problem is not solved greedily
 * — but the interactions that would break it are weak here, since equipment
 * grants flat health and armour that do not scale with anything, and the pool is
 * small enough that a first-fit and an exact fit rarely differ. Where they do,
 * the result is still a valid layout, never an impossible one.
 */
export class ItemOptimiser {
  constructor(
    private readonly pool: EquipmentPool,
    private readonly db: GameDatabase,
    private readonly objective: Objective = 'defence',
  ) {}

  optimise(units: readonly RosterUnit[]): Assignment[] {
    const inSet = new Map(units.map((unit) => [unit.id, unit]));
    const slotsOf = (unit: RosterUnit): string[] =>
      (unit.definition?.itemSlots ?? []).map((_, index) => `Slot${index + 1}`);
    const at = (unitId: string, slotId: string): string => `${unitId}:${slotId}`;

    /*
     * Who is wearing what, right now, as the plan is built.
     *
     * The optimiser used to reason about the units' starting kit and a pool of
     * spare copies, which works only until it takes a copy off a team-mate: the
     * copy is one thing, and the hole it leaves is another, and the pool knew
     * nothing about the hole. So the state here is the *layout* — every slot of
     * every unit, moved as the plan moves it — and a move off a team-mate is a
     * move between two slots rather than a withdrawal from a stack.
     */
    const layout = new Map<string, UnitItem | undefined>();
    for (const unit of units) {
      for (const slotId of slotsOf(unit)) {
        layout.set(at(unit.id, slotId), unit.effective.items.find((i) => i.slotId === slotId));
      }
    }

    // Copies nobody in the squad is wearing: the inventory, and — under the
    // widest scope — whatever the rest of the roster has on. Those cost
    // nothing to take, since nothing here is optimising them.
    const loose: { item: PoolItem; left: number }[] = [];
    for (const entry of this.pool.all) {
      if (entry.wornBy !== undefined && inSet.has(entry.wornBy)) continue;
      loose.push({ item: entry, left: entry.count });
    }

    const cache = new Map<string, number>();
    const scoreOf = (unit: RosterUnit): number => {
      const hit = cache.get(unit.id);
      if (hit !== undefined) return hit;
      const value = this.scoreWearing(unit, slotsOf(unit).map((s) => layout.get(at(unit.id, s))));
      cache.set(unit.id, value);
      return value;
    };
    const scoreIf = (unit: RosterUnit, slotId: string, item: UnitItem | undefined): number =>
      this.scoreWearing(
        unit,
        slotsOf(unit).map((s) => (s === slotId ? item : layout.get(at(unit.id, s)))),
      );

    const assignments: Assignment[] = [];
    // Every accepted move raises the squad's total, which is bounded, so this
    // terminates on its own; the cap is a guard against a scoring quirk making
    // a cycle look profitable, not part of the reasoning.
    const cap = units.length * 6 * 4 + 16;

    for (let round = 0; round < cap; round += 1) {
      let best:
        | { assignment: Assignment; source: { kind: 'loose'; index: number } | { kind: 'worn'; donor: RosterUnit; slotId: string } }
        | undefined;

      for (const receiver of units) {
        for (const slotId of slotsOf(receiver)) {
          const current = layout.get(at(receiver.id, slotId));

          for (const candidate of this.pool.candidatesFor(receiver, slotId)) {
            if (current && current.id === candidate.id && current.level === candidate.level) continue;
            const wearing: UnitItem = {
              slotId,
              id: candidate.id,
              level: candidate.level,
            } as UnitItem;
            const gained = scoreIf(receiver, slotId, wearing) - scoreOf(receiver);

            // A spare copy first: stripping a team-mate is a cost, and there is
            // no reason to pay it while an identical copy is lying loose.
            const spare = loose.findIndex(
              (entry) =>
                entry.left > 0 &&
                entry.item.id === candidate.id &&
                entry.item.level === candidate.level,
            );
            if (spare >= 0) {
              if (gained > (best?.assignment.gain ?? 0)) {
                best = {
                  assignment: this.move(receiver, slotId, loose[spare]!.item, current, gained),
                  source: { kind: 'loose', index: spare },
                };
              }
              continue;
            }

            // Otherwise it has to come off somebody, and what they lose counts
            // against what the receiver gains. This is the whole point: a
            // headline gain of +414 on one unit is not a gain at all if it
            // guts another.
            const donor = this.wearerOf(candidate, units, layout, at, slotsOf, receiver);
            if (!donor) continue;
            const lost = scoreOf(donor.unit) - scoreIf(donor.unit, donor.slotId, undefined);
            const net = gained - lost;
            if (net > (best?.assignment.gain ?? 0)) {
              best = {
                assignment: {
                  ...this.move(receiver, slotId, candidate, current, net),
                  takenFrom: { unitId: donor.unit.id, slotId: donor.slotId, loss: lost },
                },
                source: { kind: 'worn', donor: donor.unit, slotId: donor.slotId },
              };
            }
          }
        }
      }

      if (!best) break;
      const { assignment, source } = best;
      const receiver = inSet.get(assignment.unitId)!;

      // What the receiver takes off is not destroyed — it goes back on the pile,
      // and a later round can put it on whoever the move left bare.
      const displaced = layout.get(at(assignment.unitId, assignment.slotId));
      if (displaced) {
        const spec = this.db.items[displaced.id];
        if (spec) {
          loose.push({
            item: {
              id: displaced.id,
              name: spec.name,
              level: displaced.level,
              rarity: spec.rarity,
              itemType: spec.itemType,
              count: 1,
            },
            left: 1,
          });
        }
      }

      if (source.kind === 'loose') {
        loose[source.index]!.left -= 1;
      } else {
        layout.set(at(source.donor.id, source.slotId), undefined);
        cache.delete(source.donor.id);
      }
      layout.set(at(assignment.unitId, assignment.slotId), {
        slotId: assignment.slotId,
        id: assignment.item.id,
        level: assignment.item.level,
      } as UnitItem);
      cache.delete(receiver.id);
      assignments.push(assignment);
    }

    return assignments;
  }

  /** The team-mate wearing this copy, if any is — read from the live layout. */
  private wearerOf(
    candidate: PoolItem,
    units: readonly RosterUnit[],
    layout: ReadonlyMap<string, UnitItem | undefined>,
    at: (unitId: string, slotId: string) => string,
    slotsOf: (unit: RosterUnit) => string[],
    receiver: RosterUnit,
  ): { unit: RosterUnit; slotId: string } | undefined {
    for (const unit of units) {
      // Shuffling a unit's own two slots is left alone: both ends move at once,
      // and pricing it one slot at a time would misreport it.
      if (unit.id === receiver.id) continue;
      for (const slotId of slotsOf(unit)) {
        const worn = layout.get(at(unit.id, slotId));
        if (worn && worn.id === candidate.id && worn.level === candidate.level) {
          return { unit, slotId };
        }
      }
    }
    return undefined;
  }

  private move(
    receiver: RosterUnit,
    slotId: string,
    item: PoolItem,
    current: UnitItem | undefined,
    gain: number,
  ): Assignment {
    return {
      unitId: receiver.id,
      slotId,
      item,
      ...(current
        ? {
            replaces: {
              id: current.id,
              name: this.db.items[current.id]?.name ?? current.id,
              level: current.level,
            },
          }
        : {}),
      gain,
    };
  }

  /** A unit's score wearing exactly this kit, everything else held still. */
  private scoreWearing(unit: RosterUnit, items: readonly (UnitItem | undefined)[]): number {
    const worn = items.filter((item): item is UnitItem => item !== undefined);
    return score(new RosterUnit({ ...unit.effective, items: worn }, this.db), this.objective);
  }
}

/* -------------------------------------------------------------------------- */
/* Battles                                                                    */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Who a campaign lets you deploy                                             */
/* -------------------------------------------------------------------------- */

/**
 * The three axes the game's own campaign screen is arranged on.
 *
 * The data models a campaign as one flat `CampaignType`, which conflates two
 * independent choices — whose side you are on, and how hard the board is — and
 * then names each combination separately: "Fall of Cadia Mirror Elite" is one
 * campaign, not a coordinate. Pulled apart here so a picker can offer the same
 * three lists the game does instead of one list of twenty-eight.
 */
export type BattleLevel = 'Standard' | 'Elite' | 'Extremis';

/** `Mirror` and `EliteMirror` are the two sides played from the enemy's end. */
const MIRROR_TYPES: ReadonlySet<number> = new Set([CampaignType.Mirror, CampaignType.EliteMirror]);

/** The opposite side of the same board: standard against mirror, at each level. */
const OPPOSITE_SIDE: Readonly<Record<number, number>> = {
  [CampaignType.Standard]: CampaignType.Mirror,
  [CampaignType.Mirror]: CampaignType.Standard,
  [CampaignType.Elite]: CampaignType.EliteMirror,
  [CampaignType.EliteMirror]: CampaignType.Elite,
};

/**
 * Faction names the roster and the campaign tables spell differently.
 *
 * The battle tables name the faction as the setting does; the roster names it
 * as the game's own ids do. One pair disagrees, and it is the same faction —
 * the Adepta Sororitas are the Sisterhood.
 */
const FACTION_ALIASES: Readonly<Record<string, string>> = { adeptasororitas: 'sisterhood' };

/**
 * The battle tables write "Black Legion", the roster writes "BlackLegion".
 * Same faction, and neither spelling is more correct than the other.
 */
export const sameFaction = (a: string, b: string): boolean => foldFaction(a) === foldFaction(b);

/** Case, spacing and punctuation are not part of a faction's identity here. */
const foldFaction = (name: string): string => {
  const folded = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return FACTION_ALIASES[folded] ?? folded;
};

/** A campaign's name with the words that describe the side and level removed. */
export function campaignFamily(name: string): string {
  return name.replace(/\s+(Mirror|Elite|Extremis)\b/gi, '').trim();
}

export function battleLevelOf(type: CampaignType | undefined): BattleLevel {
  if (type === CampaignType.Elite || type === CampaignType.EliteMirror) return 'Elite';
  if (type === CampaignType.Extremis) return 'Extremis';
  return 'Standard';
}

export const isMirrorType = (type: CampaignType | undefined): boolean =>
  type !== undefined && MIRROR_TYPES.has(type);

/** The side a campaign is fought from: its own faction, and that faction's alliance. */
export interface CampaignSide {
  /** The faction the campaign stars — Orks for Octarius, Black Legion for Cadia. */
  faction: string;
  alliance: GrandAlliance;
}

/**
 * The side each campaign is fought from, by campaign id.
 *
 * Campaigns are faction campaigns: Indomitus is the Ultramarines' war, its
 * Mirror the Necrons'. Neither data source publishes that — no table anywhere
 * says who a node *permits* — so it is derived, from the one place the answer
 * is written down implicitly: the enemies of the opposite side. Whoever you
 * fight in Indomitus Mirror is whoever you play in Indomitus, and that is
 * Ultramarines on every node of it.
 *
 * Both halves are kept because the game uses both, and which one applies is a
 * property of the node rather than of the campaign — see {@link BattleBrief.allows}.
 *
 * Deliberately partial. Only a campaign with an opposite side is derived at
 * all: an event campaign has none, and its name is no substitute — the Dark
 * Angels event fights Dark Angels, so reading the name as the side you play
 * gets it backwards. Those are left unrestricted, as is any campaign whose
 * opponent is not clear enough to name.
 *
 * Left out rather than guessed at because the cost of the two mistakes is not
 * symmetric: a missing restriction shows a squad the game will refuse, which
 * the player sees the moment they try it, while an invented one hides units
 * they could have brought and says nothing at all.
 */
export function campaignSides(db: GameDatabase): Map<string, CampaignSide> {
  const allianceOfFaction = new Map<string, GrandAlliance>();
  for (const unit of Object.values(db.units)) {
    if (unit.factionId === undefined || unit.grandAlliance === undefined) continue;
    allianceOfFaction.set(foldFaction(unit.factionId), unit.grandAlliance);
  }

  const families = new Map<string, Map<number, CampaignDefinition>>();
  for (const campaign of Object.values(db.campaigns)) {
    const family = campaignFamily(campaign.name ?? campaign.id);
    const byType = families.get(family) ?? new Map<number, CampaignDefinition>();
    byType.set(campaign.type ?? CampaignType.Standard, campaign);
    families.set(family, byType);
  }

  const allowed = new Map<string, CampaignSide>();
  for (const byType of families.values()) {
    for (const [type, campaign] of byType) {
      const opposite = byType.get(OPPOSITE_SIDE[type] ?? -1);
      if (opposite === undefined) continue;
      const faction = mostFoughtFaction(opposite);
      if (faction === undefined) continue;
      const alliance = allianceOfFaction.get(foldFaction(faction));
      if (alliance !== undefined) allowed.set(campaign.id, { faction, alliance });
    }
  }
  return allowed;
}

/**
 * Slots at which a node stops being the campaign's own characters alone.
 *
 * A campaign node fixes a small cast — the three who open the campaign, from
 * its own faction — and hands back whatever slots are left over for anyone of
 * the same Grand Alliance. So a three-slot board is those three and nobody
 * else, while a five-slot board takes two guests. The trio itself is not
 * published anywhere, so the faction they belong to is as close as this gets;
 * it is far closer than the alliance, which on Octarius Elite would offer
 * Necrons for a board that only takes Orks.
 */
export const GUEST_SLOTS_FROM = 4;

/**
 * The faction a campaign is fought against on most of its nodes.
 *
 * A majority rather than a union: a three-way war like Octarius puts a third
 * party on boards of both sides, and pooling every faction that appears would
 * take the one constant — who you are actually fighting — and bury it. The
 * threshold rejects a campaign with no clear opponent instead of guessing at
 * one.
 */
function mostFoughtFaction(campaign: CampaignDefinition): string | undefined {
  const battles = Object.values(campaign.battles);
  if (battles.length === 0) return undefined;
  const seen = new Map<string, number>();
  for (const battle of battles) {
    for (const faction of new Set(battle.enemyFactions ?? [])) {
      seen.set(faction, (seen.get(faction) ?? 0) + 1);
    }
  }
  const [top] = [...seen].sort((a, b) => b[1] - a[1]);
  return top && top[1] / battles.length >= 0.5 ? top[0] : undefined;
}

/**
 * What a campaign node asks of a squad.
 *
 * The node data carries the team size, the enemy roster with each enemy's rank,
 * stars and resolved stats, and which factions and alliances they belong to. It
 * names no required or forbidden units — no table anywhere does — but the game
 * does impose one rule the data can be made to admit: a campaign is fought by a
 * single Grand Alliance, and {@link allowedAlliance} carries it when it can be
 * worked out. Everything else here about who to bring is a recommendation
 * derived from the enemies rather than a rule read out of the data.
 */
export class BattleBrief {
  constructor(
    readonly battle: BattleDefinition,
    readonly campaignName: string,
    /** The side this campaign is fought from — see {@link campaignSides}. */
    readonly side?: CampaignSide,
  ) {}

  /** The alliance this campaign is fought by, when it could be derived. */
  get allowedAlliance(): GrandAlliance | undefined {
    return this.side?.alliance;
  }

  /**
   * The faction this node takes, when it takes only one.
   *
   * Set on the small boards, where the campaign's own cast fills every slot.
   */
  get requiredFaction(): string | undefined {
    return this.slots < GUEST_SLOTS_FROM ? this.side?.faction : undefined;
  }

  /** The campaign without the words for its side and level: "Fall of Cadia". */
  get family(): string {
    return campaignFamily(this.campaignName);
  }

  /** Played from the enemy's end of the same board. */
  get mirror(): boolean {
    return isMirrorType(this.battle.campaignType);
  }

  get level(): BattleLevel {
    return battleLevelOf(this.battle.campaignType);
  }

  /** The alliance as the page spells it, or nothing when unrestricted. */
  get allowedAllianceName(): string | undefined {
    return this.allowedAlliance === undefined
      ? undefined
      : GRAND_ALLIANCE_NAMES[this.allowedAlliance];
  }

  /**
   * Whether the game would let this unit onto the board.
   *
   * Open where the restriction is unknown, on both counts: a campaign whose
   * side could not be derived permits everyone, and so does a unit whose own
   * alliance the roster never gave. Refusing on missing data would hide units
   * for want of a field rather than for a rule.
   */
  allows(unit: RosterUnit): boolean {
    if (this.side === undefined) return true;
    const faction = this.requiredFaction;
    if (faction !== undefined) {
      return unit.factionId === 'Unknown' || sameFaction(unit.factionId, faction);
    }
    const required = this.allowedAllianceName;
    if (required === undefined) return true;
    return unit.alliance === 'Unknown' || unit.alliance === required;
  }

  /** Units the player may deploy, 1 to 5. */
  get slots(): number {
    return this.battle.slots ?? 5;
  }

  get enemyFactions(): readonly string[] {
    return this.battle.enemyFactions ?? [];
  }

  /**
   * The board in aggregate.
   *
   * Read from `enemySummary` rather than from the roster, because the UI
   * snapshot drops the roster to stay small and carries only the summary. One
   * source means the browser and Node see the same numbers.
   */
  get summary() {
    return this.battle.enemySummary;
  }

  get enemyCount(): number {
    return this.summary?.count ?? this.battle.enemiesTotal ?? 0;
  }

  /** Total health across every enemy on the board. */
  get enemyHealth(): number {
    return this.summary?.health ?? 0;
  }

  /** Armour the squad has to chew through, weighted by how many carry it. */
  get meanEnemyArmour(): number {
    return this.summary?.armour ?? 0;
  }

  /**
   * Damage a squad actually lands on this board, per unit.
   *
   * Armour is applied the way the game applies it — each hit lands for
   * `max(damage - armour, damage x pierce)` — so a Psychic attacker keeps its
   * whole output against armoured enemies while a Physical one does not. This
   * is why "effective attack" is worth sorting by and raw damage is not.
   */
  damageAgainst(unit: RosterUnit): number {
    return Math.max(this.normalDamageAgainst(unit), this.abilityDamageAgainst(unit));
  }

  /** {@link damageAgainst} from the melee and ranged weapons alone. */
  normalDamageAgainst(unit: RosterUnit): number {
    return this.through(unit.normalAttacks);
  }

  /**
   * {@link damageAgainst} from the abilities alone.
   *
   * Reported apart because an active ability is usually one shot a battle,
   * so it decides an opening rather than a grind — a unit that only out-damages
   * another through its ability is a different pick.
   */
  abilityDamageAgainst(unit: RosterUnit): number {
    return this.through(unit.abilityAttacks);
  }

  private through(attacks: readonly AttackProfile[]): number {
    const armour = this.meanEnemyArmour;
    let best = 0;
    for (const attack of attacks) {
      const perHit = Math.max(
        attack.perHit.mid - armour,
        attack.perHit.mid * (attack.pierceRatio ?? 0),
      );
      best = Math.max(best, Math.max(0, perHit) * attack.hits);
    }
    return best;
  }

  /** Every node in the database, as briefs, for a picker. */
  static all(db: GameDatabase): BattleBrief[] {
    // Derived once for the whole database: the answer for a node is a property
    // of its campaign, and working it out per node would redo the same scan of
    // every board seven hundred times over.
    const sides = campaignSides(db);
    const briefs: BattleBrief[] = [];
    for (const campaign of Object.values(db.campaigns)) {
      const side = sides.get(campaign.id);
      for (const battle of Object.values(campaign.battles)) {
        briefs.push(new BattleBrief(battle, campaign.name ?? campaign.id, side));
      }
    }
    return briefs;
  }
}

/** A squad picked for a battle, with the reasoning kept. */
export interface Recommendation {
  unit: RosterUnit;
  /** Damage this unit lands on that board, after the enemies' armour. */
  damage: number;
  /** Effective health, the same composite {@link score} uses. */
  toughness: number;
  reason: string;
}

/**
 * Pick a squad for a node.
 *
 * Weighted so that neither half of a squad is picked alone: a board is cleared
 * by dealing its total health in damage before it deals yours, so units are
 * ranked on damage *against this board* plus a share of their own toughness.
 * The weighting is a judgement, not a published formula, and the numbers behind
 * each pick are returned so the choice can be argued with rather than trusted.
 */
export class TeamOptimiser {
  constructor(
    private readonly brief: BattleBrief,
    private readonly objective: Objective = 'effective',
  ) {}

  recommend(units: readonly RosterUnit[], slots = this.brief.slots): Recommendation[] {
    const scored = units
      // A squad the game will not let you deploy is not a recommendation. The
      // filter comes first so the normalisation below is measured against the
      // units actually in contention, not against a Necron the node refuses.
      .filter((unit) => this.brief.allows(unit))
      .map((unit) => {
        const damage = this.brief.damageAgainst(unit);
        const toughness = score(unit, 'defence');
        return { unit, damage, toughness };
      })
      .filter((row) => row.damage > 0 || row.toughness > 0);

    if (scored.length === 0) return [];

    // Normalised so the two halves are comparable at all: they are measured in
    // different units, and the ratio between their raw magnitudes is an
    // accident of the game's number scale rather than a statement about value.
    const topDamage = Math.max(...scored.map((r) => r.damage), 1);
    const topToughness = Math.max(...scored.map((r) => r.toughness), 1);
    const weight = this.objective === 'defence' ? 0.6 : 0.35;

    return scored
      .map((row) => ({
        ...row,
        rank: (row.damage / topDamage) * (1 - weight) + (row.toughness / topToughness) * weight,
      }))
      .sort((a, b) => b.rank - a.rank || a.unit.name.localeCompare(b.unit.name))
      .slice(0, slots)
      .map(({ unit, damage, toughness }) => ({
        unit,
        damage,
        toughness,
        reason:
          damage >= topDamage * 0.75
            ? 'lands the most through their armour'
            : toughness >= topToughness * 0.75
              ? 'survives the board longest'
              : 'best balance of the two',
      }));
  }
}

/* -------------------------------------------------------------------------- */
/* A saved team                                                               */
/* -------------------------------------------------------------------------- */

export interface TeamTotals {
  health: number;
  damage: number;
  armour: number;
  /** Sum of each member's best pierce floor, from any attack. */
  effective: number;
  /** The same, from the melee and ranged weapons only. */
  effectiveNormal: number;
  /** The same, from the abilities only — mostly one-offs, not a per-turn rate. */
  effectiveAbility: number;
}

/** A named squad, its cap, and the battle it is meant for. */
export class Team {
  constructor(
    readonly id: string,
    public name: string,
    public memberIds: UnitId[],
    public capRarity?: Rarity,
    public battleKey?: string,
  ) {}

  get size(): number {
    return this.memberIds.length;
  }

  has(unitId: UnitId): boolean {
    return this.memberIds.includes(unitId);
  }

  /** Resolve the members against a roster, dropping any no longer owned. */
  members(roster: readonly RosterUnit[]): RosterUnit[] {
    const byId = new Map(roster.map((unit) => [unit.id, unit]));
    return this.memberIds.map((id) => byId.get(id)).filter((u): u is RosterUnit => u !== undefined);
  }

  totals(roster: readonly RosterUnit[]): TeamTotals {
    const totals: TeamTotals = {
      health: 0,
      damage: 0,
      armour: 0,
      effective: 0,
      effectiveNormal: 0,
      effectiveAbility: 0,
    };
    for (const member of this.members(roster)) {
      totals.health += member.stats?.health ?? 0;
      totals.damage += member.stats?.damage ?? 0;
      totals.armour += member.stats?.armour ?? 0;
      totals.effective += member.effectiveDamage;
      totals.effectiveNormal += member.normalEffectiveDamage;
      totals.effectiveAbility += member.abilityEffectiveDamage;
    }
    return totals;
  }
}
