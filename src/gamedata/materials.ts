/**
 * Reads the rank-up tables backwards: from a material to everywhere it is spent.
 *
 * The game shows a badge on an item meaning "this ranks somebody up" without
 * saying who, and the tables are only written the other way round — each unit
 * lists the materials each of its ranks consumes. Inverting that is the whole
 * job here.
 *
 * Two complications make it more than a map lookup. A material is often not
 * required directly but forged into something that is, sometimes through
 * several layers, so a use has to carry the chain that leads to it and the
 * amount multiplied along that chain. And the same material can reach one rank
 * by more than one route, which stays as separate uses rather than being summed
 * — the routes are what the player has to act on.
 */

import { parseRarity, type Rank, type Rarity } from './enums.js';
import type { AbilitySlot } from './combat.js';
import { itemSource } from './requirements.js';
import type { UnitId } from './ids.js';
import type { GameDatabase, UnitDefinition } from './types.js';
import type { PlayerResponse, Unit } from '../types/player.js';

/** One step of a forging chain: the material that is made from the next one. */
export interface ChainLink {
  id: string;
  name: string;
}

/** One place a material is spent, and how it gets there. */
export interface MaterialUse {
  unitId: UnitId;
  unitName: string;
  factionId: string;
  /** The rank whose upgrade slots consume it. */
  rank: Rank;
  /**
   * The forging chain from the rank's own requirement down to this material,
   * outermost first. Empty when the rank requires this material directly.
   */
  chain: ChainLink[];
  /** Copies of *this* material the rank consumes through this chain. */
  amount: number;
  /**
   * Which of the rank's six upgrade slots this serves.
   *
   * The player's `upgrades` array is a list of these indices, so this is what
   * turns "this rank wants the material" into "this slot is still empty".
   */
  slotIndex: number;
  /**
   * The stat the slot raises, and by how much, straight from the rank table.
   *
   * Optional because the table is: a slot occasionally publishes neither, and
   * inventing a zero there would read as "upgrades nothing" rather than "not
   * published".
   */
  statType?: string;
  statIncrease?: number;
}

/** Every node of a material's forging tree, with amounts multiplied through. */
interface FlatComponent {
  id: string;
  chain: ChainLink[];
  amount: number;
}

/**
 * Expand one material's recipe into every material below it.
 *
 * Memoised per database, because a rank slot is expanded once per unit that has
 * it and the trees are shared: 352 of 558 materials are crafted, and the common
 * components sit under a great many of them.
 */
function flatten(
  id: string,
  db: GameDatabase,
  memo: Map<string, FlatComponent[]>,
  seen: ReadonlySet<string> = new Set(),
): FlatComponent[] {
  const cached = memo.get(id);
  if (cached) return cached;
  // A recipe cycle would recurse forever. None is known, but the data is
  // scraped, so the guard stays.
  if (seen.has(id)) return [];

  const source = itemSource({ kind: 'upgrade', key: `upgrade:${id}` }, db);
  if (source.kind !== 'craft') {
    memo.set(id, []);
    return [];
  }

  const guard = new Set(seen).add(id);
  const out: FlatComponent[] = [];
  for (const component of source.recipe) {
    const link: ChainLink = { id: component.id, name: component.name };
    out.push({ id: component.id, chain: [], amount: component.amount });
    for (const deeper of flatten(component.id, db, memo, guard)) {
      out.push({
        id: deeper.id,
        chain: [link, ...deeper.chain],
        amount: deeper.amount * component.amount,
      });
    }
  }
  // Only a cycle-free expansion is cacheable: one cut short by `seen` is
  // correct for this path and wrong for any other.
  if (guard.size === seen.size + 1 && seen.size === 0) memo.set(id, out);
  return out;
}

/**
 * Index every material by the ranks that spend it.
 *
 * Built for the whole roster at once rather than per material: answering "where
 * does this go" for one material still means expanding every rank slot in the
 * game, so doing it once and keeping the result costs the same walk and serves
 * every later question.
 */
export function indexMaterialUses(db: GameDatabase): Map<string, MaterialUse[]> {
  const index = new Map<string, MaterialUse[]>();
  const memo = new Map<string, FlatComponent[]>();

  const add = (id: string, use: MaterialUse) => {
    const list = index.get(id);
    if (list) list.push(use);
    else index.set(id, [use]);
  };

  for (const definition of Object.values(db.units)) {
    const unit = {
      unitId: definition.id,
      unitName: definition.name ?? definition.id,
      factionId: definition.factionId ?? 'Unknown',
    };
    for (const rankStats of definition.ranks) {
      const slots = rankStats.upgrades ?? [];
      for (const [slotIndex, slot] of slots.entries()) {
        const base = {
          ...unit,
          rank: rankStats.rank,
          slotIndex,
          ...(slot.statType !== undefined ? { statType: slot.statType } : {}),
          ...(slot.statIncrease !== undefined ? { statIncrease: slot.statIncrease } : {}),
        };
        add(slot.upgradeId, { ...base, chain: [], amount: slot.amount });

        const top: ChainLink = {
          id: slot.upgradeId,
          name: db.upgrades[slot.upgradeId]?.name ?? slot.upgradeId,
        };
        for (const component of flatten(slot.upgradeId, db, memo)) {
          add(component.id, {
            ...base,
            chain: [top, ...component.chain],
            amount: component.amount * slot.amount,
          });
        }
      }
    }
  }

  return index;
}

/** A material with the player's holding and where it can go. */
export interface MaterialEntry {
  id: string;
  name: string;
  rarity?: Rarity;
  owned: number;
  /** True when a campaign node drops it; false when it has to be forged. */
  farmable: boolean;
  uses: MaterialUse[];
  /** Distinct units that spend it, at any rank. */
  unitCount: number;
  /** Ranks that spend it directly, ignoring recipes. */
  directRanks: Rank[];
}

/**
 * Every material, joined to the player's inventory and its uses.
 *
 * Materials with no use at all are still listed: the game hands out things the
 * rank tables never ask for, and silently dropping them would leave a player
 * wondering where their stock went.
 */
export function materialCatalogue(player: PlayerResponse, db: GameDatabase): MaterialEntry[] {
  const index = indexMaterialUses(db);
  const held = new Map<string, number>();
  for (const item of player.player.inventory.upgrades) {
    held.set(item.id, (held.get(item.id) ?? 0) + item.amount);
  }

  return Object.values(db.upgrades).map((upgrade) => {
    const uses = index.get(upgrade.id) ?? [];
    const directRanks = [
      ...new Set(uses.filter((u) => u.chain.length === 0).map((u) => u.rank)),
    ].sort((a, b) => a - b);
    return {
      id: upgrade.id,
      name: upgrade.name ?? upgrade.id,
      ...(upgrade.rarity !== undefined ? { rarity: upgrade.rarity } : {}),
      owned: held.get(upgrade.id) ?? 0,
      farmable: upgrade.farmableAt.length > 0,
      uses,
      unitCount: new Set(uses.map((u) => u.unitId)).size,
      directRanks,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Which of those uses the player can act on today                            */
/* -------------------------------------------------------------------------- */

/**
 * What a given use means for the player right now.
 *
 * - `now` — the unit is standing at that rank and the slot is still empty, so
 *   the material goes in today.
 * - `applied` — that slot is already filled; the material went in already.
 * - `later` — the rank is ahead of the unit. Worth keeping, not worth farming.
 * - `passed` — the rank is behind the unit and can never be revisited.
 * - `unowned` — the unit is not in the roster at all.
 */
export type UseStatus = 'now' | 'applied' | 'later' | 'passed' | 'unowned';

/** A use, with what it means for this player. */
export interface AvailableUse extends MaterialUse {
  status: UseStatus;
  /**
   * True when the unit has not yet reached the level that completes this rank.
   *
   * A rank's upgrades sit in two rows and the second row is level-gated per
   * upgrade — but only the rank's highest threshold is published anywhere, so
   * which of the remaining slots are open cannot be known. This flags the
   * doubt rather than resolving it: some of what reads as `now` may still be
   * waiting on levels.
   */
  levelGated: boolean;
  /** The level that completes the rank, when one is published. */
  levelToComplete?: number;
}

/**
 * Answers "can I use this today?" for a roster, once.
 *
 * The question is asked for every use of every material — tens of thousands of
 * times on the Upgrades page — so the roster is indexed once here rather than
 * scanned per row. Kept separate from {@link materialCatalogue} because the
 * plan pages need the same answer about materials they reached by a different
 * route.
 */
export class UpgradeAvailability {
  private readonly units: ReadonlyMap<string, { rank: Rank; filled: ReadonlySet<number>; xpLevel: number }>;

  constructor(
    player: PlayerResponse,
    /**
     * The level that completes a rank, injected rather than imported so this
     * module keeps no dependency on the planner. Pass
     * `levelToCompleteRank` from `plan.ts`.
     */
    private readonly levelToComplete: (rank: Rank) => number | undefined = () => undefined,
  ) {
    const units = new Map<string, { rank: Rank; filled: ReadonlySet<number>; xpLevel: number }>();
    for (const unit of player.player.units) {
      units.set(unit.id, {
        rank: unit.rank as Rank,
        filled: new Set(unit.upgrades ?? []),
        xpLevel: unit.xpLevel,
      });
    }
    this.units = units;
  }

  /** What this one use means today. */
  statusOf(use: MaterialUse): UseStatus {
    const unit = this.units.get(use.unitId);
    if (!unit) return 'unowned';
    if (use.rank > unit.rank) return 'later';
    if (use.rank < unit.rank) return 'passed';
    return unit.filled.has(use.slotIndex) ? 'applied' : 'now';
  }

  /** The same use, annotated. */
  annotate(use: MaterialUse): AvailableUse {
    const status = this.statusOf(use);
    const unit = this.units.get(use.unitId);
    const gate = this.levelToComplete(use.rank);
    const levelGated =
      status === 'now' && gate !== undefined && unit !== undefined && unit.xpLevel < gate;
    return {
      ...use,
      status,
      levelGated,
      ...(gate !== undefined ? { levelToComplete: gate } : {}),
    };
  }

  /** Every use of a material, annotated, with the ones to act on first. */
  annotateAll(uses: readonly MaterialUse[]): AvailableUse[] {
    return uses.map((use) => this.annotate(use)).sort(byUrgency);
  }

  /** How many of these the player could spend today. */
  countNow(uses: readonly MaterialUse[]): number {
    let n = 0;
    for (const use of uses) if (this.statusOf(use) === 'now') n += 1;
    return n;
  }
}

/** Rank order within a status, so a list reads as a queue rather than a set. */
const STATUS_ORDER: Record<UseStatus, number> = {
  now: 0,
  later: 1,
  applied: 2,
  passed: 3,
  unowned: 4,
};

function byUrgency(a: AvailableUse, b: AvailableUse): number {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    a.rank - b.rank ||
    a.unitName.localeCompare(b.unitName) ||
    a.chain.length - b.chain.length
  );
}

/* -------------------------------------------------------------------------- */
/* What a unit's next rank costs                                              */
/* -------------------------------------------------------------------------- */

/** One material a rank consumes, with what forging it would take. */
export interface RankMaterial {
  id: string;
  name: string;
  rarity?: Rarity;
  /** Copies the rank asks for. */
  amount: number;
  /** Already fitted into a slot at this rank, and therefore spent. */
  applied: number;
  owned: number;
  farmable: boolean;
  /** The forging tree below it, amounts multiplied through. */
  components: RankComponent[];
}

export interface RankComponent {
  id: string;
  name: string;
  rarity?: Rarity;
  chain: ChainLink[];
  amount: number;
  owned: number;
  farmable: boolean;
}

export interface NextRank {
  unitId: UnitId;
  unitName: string;
  factionId: string;
  from: Rank;
  to: Rank;
  materials: RankMaterial[];
  /** Copies still to find across every material, primary and component alike. */
  missing: number;
}

/**
 * What one more rank costs this unit, primary materials and recipes together.
 *
 * The slots the unit has already filled at its current rank are reported rather
 * than dropped: those materials are spent and cannot be moved, and a list that
 * silently omitted them would read as if the rank were cheaper than it was.
 */
export function nextRankCost(
  unit: Unit,
  player: PlayerResponse,
  db: GameDatabase,
): NextRank | undefined {
  const definition: UnitDefinition | undefined = db.units[unit.id];
  const slots = definition?.ranks.find((r) => r.rank === unit.rank)?.upgrades ?? [];
  if (slots.length === 0) return undefined;

  const held = new Map<string, number>();
  for (const item of player.player.inventory.upgrades) {
    held.set(item.id, (held.get(item.id) ?? 0) + item.amount);
  }
  const memo = new Map<string, FlatComponent[]>();
  const filled = new Set(unit.upgrades);

  const pooled = new Map<string, { amount: number; applied: number }>();
  slots.forEach((slot, index) => {
    const entry = pooled.get(slot.upgradeId) ?? { amount: 0, applied: 0 };
    entry.amount += slot.amount;
    if (filled.has(index)) entry.applied += slot.amount;
    pooled.set(slot.upgradeId, entry);
  });

  let missing = 0;
  const materials: RankMaterial[] = [];
  for (const [id, { amount, applied }] of pooled) {
    const upgrade = db.upgrades[id];
    const owned = held.get(id) ?? 0;
    const short = Math.max(0, amount - applied - owned);
    missing += short;

    const components: RankComponent[] = [];
    // Only the shortfall needs forging: what is in hand does not need making.
    if (short > 0) {
      for (const component of flatten(id, db, memo)) {
        const componentOwned = held.get(component.id) ?? 0;
        const needed = component.amount * short;
        components.push({
          id: component.id,
          name: db.upgrades[component.id]?.name ?? component.id,
          ...(db.upgrades[component.id]?.rarity !== undefined
            ? { rarity: db.upgrades[component.id]!.rarity! }
            : {}),
          chain: component.chain,
          amount: needed,
          owned: componentOwned,
          farmable: (db.upgrades[component.id]?.farmableAt.length ?? 0) > 0,
        });
      }
    }

    materials.push({
      id,
      name: upgrade?.name ?? id,
      ...(upgrade?.rarity !== undefined ? { rarity: upgrade.rarity } : {}),
      amount,
      applied,
      owned,
      farmable: (upgrade?.farmableAt.length ?? 0) > 0,
      components,
    });
  }

  materials.sort((a, b) => a.name.localeCompare(b.name));
  return {
    unitId: unit.id,
    unitName: unit.name ?? definition?.name ?? unit.id,
    factionId: unit.faction ?? definition?.factionId ?? 'Unknown',
    from: unit.rank as Rank,
    to: (unit.rank + 1) as Rank,
    materials,
    missing,
  };
}

/** Every owned unit's next rank, cheapest first. */
export function nextRankCosts(player: PlayerResponse, db: GameDatabase): NextRank[] {
  return player.player.units
    .map((unit) => nextRankCost(unit, player, db))
    .filter((r): r is NextRank => r !== undefined)
    .sort((a, b) => a.missing - b.missing || a.unitName.localeCompare(b.unitName));
}

/* -------------------------------------------------------------------------- */
/* Ability badges                                                             */
/* -------------------------------------------------------------------------- */

/** One ability a badge of a given rarity can be spent on. */
export interface BadgeUse {
  unitId: UnitId;
  unitName: string;
  abilityId: string;
  abilityName: string;
  slot: AbilitySlot;
  /** The ability's level now. */
  level: number;
  /** Levels this badge rarity can carry it through, and what each costs. */
  steps: { from: number; to: number; badges: number; gold: number }[];
  /** Badges to take the next level, or undefined when it is already maxed. */
  next?: number;
  /** Badges to spend this rarity out entirely, across every level it covers. */
  total: number;
}

/** The player's holding of one alliance-and-rarity badge, and where it goes. */
export interface BadgeEntry {
  key: string;
  alliance: string;
  rarity: Rarity;
  name: string;
  owned: number;
  uses: BadgeUse[];
  /** Badges the next level of every listed ability would take together. */
  nextTotal: number;
  /** Badges every level this rarity covers would take, across the roster. */
  grandTotal: number;
}

const SLOT_OF = (definition: UnitDefinition | undefined, abilityId: string): AbilitySlot =>
  abilityId === definition?.activeAbilityId
    ? 'active'
    : definition?.mythicAbilityIds.includes(abilityId)
      ? 'mythic'
      : 'passive';

/**
 * Ability badges held, and every ability each could be spent on.
 *
 * Badges are shared across a whole grand alliance rather than owned by a unit,
 * which is exactly why the game cannot tell you where one goes: the answer is
 * every ability of every unit on that side. The list is narrowed to abilities
 * whose remaining levels actually cost this rarity, which is what makes it
 * short enough to read.
 */
export function badgeCatalogue(player: PlayerResponse, db: GameDatabase): BadgeEntry[] {
  const maxLevel = Math.max(...db.abilityUpgradeCosts.map((c) => c.level)) + 1;

  const entries = new Map<string, BadgeEntry>();
  for (const [alliance, badges] of Object.entries(player.player.inventory.abilityBadges)) {
    for (const badge of badges ?? []) {
      // The inventory spells rarity as a word; every table here keys on the enum.
      const rarity = parseRarity(badge.rarity);
      if (rarity === undefined) continue;
      entries.set(`badge:${alliance}:${rarity}`, {
        key: `badge:${alliance}:${rarity}`,
        alliance,
        rarity,
        name: badge.name ?? String(badge.rarity),
        owned: badge.amount,
        uses: [],
        nextTotal: 0,
        grandTotal: 0,
      });
    }
  }

  for (const unit of player.player.units) {
    const alliance = unit.grandAlliance ?? 'Unknown';
    const definition = db.units[unit.id];
    for (const ability of unit.abilities) {
      // Rows are grouped by the rarity they charge, so one ability contributes
      // to as many badge entries as its remaining levels span.
      const byRarity = new Map<Rarity, BadgeUse['steps']>();
      for (let level = ability.level; level < maxLevel; level += 1) {
        const cost = db.abilityUpgradeCosts.find((c) => c.level === level);
        if (!cost) continue;
        // Same fallback the planner uses: most rows name the rarity outright,
        // the rest carry it inside `badgeType` as `abilityTokenUncommon`.
        const rarity =
          cost.badgeRarity ?? parseRarity(cost.badgeType.replace(/^abilityToken/i, ''));
        if (rarity === undefined) continue;
        const steps = byRarity.get(rarity) ?? [];
        steps.push({ from: level, to: level + 1, badges: cost.amount, gold: cost.gold });
        byRarity.set(rarity, steps);
      }

      for (const [rarity, steps] of byRarity) {
        const entry = entries.get(`badge:${alliance}:${rarity}`);
        if (!entry) continue;
        const total = steps.reduce((sum, s) => sum + s.badges, 0);
        // "Next" only counts when this rarity charges the very next level; a
        // rarity that only bites further up the ladder is not a next cost.
        const next = steps[0]?.from === ability.level ? steps[0].badges : undefined;
        entry.uses.push({
          unitId: unit.id,
          unitName: unit.name ?? definition?.name ?? unit.id,
          abilityId: ability.id,
          abilityName: db.abilities[ability.id]?.name ?? ability.id,
          slot: SLOT_OF(definition, ability.id),
          level: ability.level,
          steps,
          ...(next !== undefined ? { next } : {}),
          total,
        });
        entry.nextTotal += next ?? 0;
        entry.grandTotal += total;
      }
    }
  }

  for (const entry of entries.values()) {
    entry.uses.sort(
      (a, b) =>
        (b.next ?? -1) - (a.next ?? -1) ||
        a.unitName.localeCompare(b.unitName) ||
        a.abilityName.localeCompare(b.abilityName),
    );
  }

  return [...entries.values()].sort(
    (a, b) => a.alliance.localeCompare(b.alliance) || a.rarity - b.rarity,
  );
}
