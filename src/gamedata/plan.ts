/**
 * Evolution planning: what to improve, in what order, to reach a target.
 *
 * A unit's attributes gate each other, so a target on one implies work on the
 * others. The rules below are what the data supports; each records how it was
 * established, because only some are published.
 */

import { Rarity, type Rank } from './enums.js';
import { computeUnitStats, type ComputedUnitStats } from './stats.js';
import type { GameDatabase } from './types.js';
import type { Unit } from '../types/player.js';

/* -------------------------------------------------------------------------- */
/* Rules                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Highest rank reachable at a given rarity.
 *
 * Derived, not published. `maxRank = 3 * (rarity + 1)` — Common tops out at Iron
 * I, Uncommon at Bronze I, and so on. Three things support it: no unit in a
 * 29-unit roster exceeds it, two sit exactly on it (a Common at Iron I and an
 * Uncommon at Bronze I), and it explains why the game's progression panel shows
 * "MAX. RANK: I" for both of those rarities — each cap is the first rank of a
 * tier.
 *
 * If the real caps differ, this is the only place to change them.
 */
export function maxRankForRarity(rarity: Rarity): Rank {
  return Math.min(3 * (rarity + 1), 19) as Rank;
}

/**
 * Highest character level reachable at a given rarity.
 *
 * Published, via the level ceilings in {@link GameDatabase.rarityCaps}
 * (Common 8, Uncommon 17, Rare 26, Epic 35, Legendary 50).
 */
export function maxLevelForRarity(rarity: Rarity, db: GameDatabase): number | undefined {
  return db.rarityCaps.find((c) => c.rarity === rarity)?.maxLevel;
}

/**
 * Ability levels are capped by the character's level.
 *
 * Observed: across a 29-unit roster no ability exceeds its unit's level, and 12
 * units have an ability sitting exactly on it.
 */
export function maxAbilityLevel(xpLevel: number): number {
  return xpLevel;
}

/** The lowest rarity that permits a given level. */
function rarityForLevel(level: number, db: GameDatabase): Rarity | undefined {
  const caps = [...db.rarityCaps].sort((a, b) => a.rarity - b.rarity);
  return caps.find((c) => c.maxLevel >= level)?.rarity;
}

/** The lowest rarity that permits a given rank. */
function rarityForRank(rank: number): Rarity | undefined {
  for (let rarity = 0 as Rarity; rarity <= Rarity.Mythic; rarity = (rarity + 1) as Rarity) {
    if (maxRankForRarity(rarity) >= rank) return rarity;
  }
  return undefined;
}

/** First progression index at which a rarity is reached. */
function firstIndexOfRarity(rarity: Rarity, db: GameDatabase): number | undefined {
  const matches = db.progressionRequirements
    .filter((r) => r.rarity === rarity)
    .map((r) => r.progressionIndex);
  return matches.length > 0 ? Math.min(...matches) : undefined;
}

/* -------------------------------------------------------------------------- */
/* Model                                                                      */
/* -------------------------------------------------------------------------- */

export interface UnitState {
  progressionIndex: number;
  rarity: Rarity | undefined;
  xpLevel: number;
  rank: Rank;
  activeAbilityLevel: number;
  passiveAbilityLevel: number;
}

/** Every field is optional: set only what you care about. */
export interface EvolutionTarget {
  rarity?: Rarity;
  rank?: Rank;
  xpLevel?: number;
  activeAbilityLevel?: number;
  passiveAbilityLevel?: number;
}

export type PlanStepKind = 'promotion' | 'ascension' | 'rank' | 'level' | 'ability';

export interface PlanStep {
  /** 1-based position in the sequence. */
  order: number;
  kind: PlanStepKind;
  /** Short imperative label, e.g. "Rank up to Bronze I". */
  label: string;
  /** Numeric from/to for the attribute this step advances. */
  from: number;
  to: number;
  /** Which ability, when `kind` is `ability`. */
  ability?: 'active' | 'passive';
  /**
   * Why this step is in the plan when it was not asked for — e.g. a level
   * raised only because an ability target needs it.
   */
  reason?: string;
  /** State after the step completes. */
  after: UnitState;
}

export interface EvolutionPlan {
  unitId: string;
  current: UnitState;
  /** What the user asked for. */
  target: EvolutionTarget;
  /** What must actually be reached once dependencies are folded in. */
  resolved: EvolutionTarget;
  steps: PlanStep[];
  final: UnitState;
  /** Set when the target cannot be reached, with the reason. */
  blocked?: string;
  /** Non-fatal notes, e.g. a target already met. */
  notes: string[];
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

export function currentState(unit: Unit, db: GameDatabase): UnitState {
  const rarity = db.progressionRequirements.find(
    (r) => r.progressionIndex === unit.progressionIndex,
  )?.rarity;
  const definition = db.units[unit.id];
  const activeId = definition?.activeAbilityId;
  const passiveId = definition?.passiveAbilityId;
  const level = (id: string | undefined) =>
    id ? (unit.abilities.find((a) => a.id === id)?.level ?? 0) : 0;

  // Fall back to positional order when the database does not name the abilities.
  const active = activeId ? level(activeId) : (unit.abilities[0]?.level ?? 0);
  const passive = passiveId ? level(passiveId) : (unit.abilities[1]?.level ?? 0);

  return {
    progressionIndex: unit.progressionIndex,
    rarity,
    xpLevel: unit.xpLevel,
    rank: unit.rank as Rank,
    activeAbilityLevel: active,
    passiveAbilityLevel: passive,
  };
}

/**
 * Fold a target's dependencies into the minimum each attribute must reach.
 *
 * An ability target drags the character level up with it, and a level or rank
 * target drags rarity up, because rarity caps both.
 */
function resolveTarget(
  target: EvolutionTarget,
  current: UnitState,
  db: GameDatabase,
): { resolved: EvolutionTarget; blocked?: string; reasons: Map<string, string> } {
  const reasons = new Map<string, string>();

  const abilityMax = Math.max(
    target.activeAbilityLevel ?? 0,
    target.passiveAbilityLevel ?? 0,
  );
  let level = Math.max(target.xpLevel ?? 0, current.xpLevel);
  if (abilityMax > level) {
    level = abilityMax;
    reasons.set('level', `ability level ${abilityMax} requires character level ${abilityMax}`);
  }

  const rank = Math.max(target.rank ?? 0, current.rank) as Rank;

  const neededForLevel = rarityForLevel(level, db);
  const neededForRank = rarityForRank(rank);
  if (neededForLevel === undefined) {
    return { resolved: {}, blocked: `No rarity allows level ${level}.`, reasons };
  }
  if (neededForRank === undefined) {
    return { resolved: {}, blocked: `No rarity allows rank ${rank}.`, reasons };
  }

  let rarity = Math.max(
    target.rarity ?? 0,
    current.rarity ?? 0,
    neededForLevel,
    neededForRank,
  ) as Rarity;

  if (rarity > (target.rarity ?? current.rarity ?? 0)) {
    const driver =
      neededForLevel >= neededForRank
        ? `level ${level} requires ${rarityName(rarity)}`
        : `rank ${rankName(rank)} requires ${rarityName(rarity)}`;
    reasons.set('rarity', driver);
  }

  return {
    resolved: {
      rarity,
      rank,
      xpLevel: level,
      activeAbilityLevel: Math.max(target.activeAbilityLevel ?? 0, current.activeAbilityLevel),
      passiveAbilityLevel: Math.max(
        target.passiveAbilityLevel ?? 0,
        current.passiveAbilityLevel,
      ),
    },
    reasons,
  };
}

/**
 * Build an ordered plan from a unit's current state to a target.
 *
 * Steps are emitted greedily in the order that unblocks progress: advance rank
 * and level as far as the current rarity allows, raise abilities as far as the
 * level allows, then promote and ascend to lift the caps and repeat. That
 * produces the phased sequence a player actually follows rather than a flat
 * total, so effort is never spent on a rank that is still gated.
 */
export function resolvePlan(
  unit: Unit,
  target: EvolutionTarget,
  db: GameDatabase,
): EvolutionPlan {
  const current = currentState(unit, db);
  const notes: string[] = [];
  const { resolved, blocked, reasons } = resolveTarget(target, current, db);
  if (blocked) {
    return { unitId: unit.id, current, target, resolved, steps: [], final: current, blocked, notes };
  }

  const state: UnitState = { ...current };
  const steps: PlanStep[] = [];
  const push = (step: Omit<PlanStep, 'order' | 'after'>) => {
    steps.push({ ...step, order: steps.length + 1, after: { ...state } });
  };

  const wantRank = resolved.rank ?? current.rank;
  const wantLevel = resolved.xpLevel ?? current.xpLevel;
  const wantActive = resolved.activeAbilityLevel ?? current.activeAbilityLevel;
  const wantPassive = resolved.passiveAbilityLevel ?? current.passiveAbilityLevel;
  const wantRarity = resolved.rarity ?? current.rarity ?? 0;

  // Bounded to keep a rule change from spinning: far more iterations than the
  // 20 ranks, 50 levels and 6 rarities could ever need.
  for (let guard = 0; guard < 200; guard += 1) {
    const rarity = (state.rarity ?? 0) as Rarity;
    const rankCap = maxRankForRarity(rarity);
    const levelCap = maxLevelForRarity(rarity, db) ?? state.xpLevel;

    if (state.rank < wantRank && state.rank < rankCap) {
      const to = Math.min(wantRank, rankCap) as Rank;
      const from = state.rank;
      state.rank = to;
      push({
        kind: 'rank',
        label: `Rank up to ${rankName(to)}`,
        from,
        to,
        ...(to < wantRank ? { reason: `capped by ${rarityName(rarity)} until ascension` } : {}),
      });
      continue;
    }

    if (state.xpLevel < wantLevel && state.xpLevel < levelCap) {
      const to = Math.min(wantLevel, levelCap);
      const from = state.xpLevel;
      state.xpLevel = to;
      push({
        kind: 'level',
        label: `Level to ${to}`,
        from,
        to,
        ...(reasons.has('level') && to >= wantLevel ? { reason: reasons.get('level')! } : {}),
        ...(to < wantLevel ? { reason: `capped by ${rarityName(rarity)} until ascension` } : {}),
      });
      continue;
    }

    const abilityCap = maxAbilityLevel(state.xpLevel);
    if (state.activeAbilityLevel < wantActive && state.activeAbilityLevel < abilityCap) {
      const to = Math.min(wantActive, abilityCap);
      const from = state.activeAbilityLevel;
      state.activeAbilityLevel = to;
      push({
        kind: 'ability',
        ability: 'active',
        label: `Active ability to ${to}`,
        from,
        to,
        ...(to < wantActive ? { reason: `capped by character level ${state.xpLevel}` } : {}),
      });
      continue;
    }
    if (state.passiveAbilityLevel < wantPassive && state.passiveAbilityLevel < abilityCap) {
      const to = Math.min(wantPassive, abilityCap);
      const from = state.passiveAbilityLevel;
      state.passiveAbilityLevel = to;
      push({
        kind: 'ability',
        ability: 'passive',
        label: `Passive ability to ${to}`,
        from,
        to,
        ...(to < wantPassive ? { reason: `capped by character level ${state.xpLevel}` } : {}),
      });
      continue;
    }

    // Everything the current rarity allows is done. Lift the ceiling if the
    // target still needs it.
    const needsMore =
      state.rank < wantRank ||
      state.xpLevel < wantLevel ||
      state.activeAbilityLevel < wantActive ||
      state.passiveAbilityLevel < wantPassive ||
      (state.rarity ?? 0) < wantRarity;
    if (!needsMore) break;

    const nextRarity = ((state.rarity ?? 0) + 1) as Rarity;
    const ascendAt = firstIndexOfRarity(nextRarity, db);
    if (ascendAt === undefined) {
      return {
        unitId: unit.id,
        current,
        target,
        resolved,
        steps,
        final: { ...state },
        blocked: `No ascension published beyond ${rarityName((state.rarity ?? 0) as Rarity)}.`,
        notes,
      };
    }

    // Promotions come first: ascension sits at the top of the next band, so the
    // stars in between must be bought before it is reachable.
    if (state.progressionIndex < ascendAt - 1) {
      const from = state.progressionIndex;
      state.progressionIndex = ascendAt - 1;
      push({
        kind: 'promotion',
        label: `Promote to ${state.progressionIndex} stars`,
        from,
        to: state.progressionIndex,
        reason: `needed before ascending to ${rarityName(nextRarity)}`,
      });
    }
    const fromIndex = state.progressionIndex;
    state.progressionIndex = ascendAt;
    state.rarity = nextRarity;
    // Only the ascension that actually reaches the required rarity carries the
    // overall driver; the ones before it are steps on the way there.
    const isFinalAscension = nextRarity >= wantRarity;
    push({
      kind: 'ascension',
      label: `Ascend to ${rarityName(nextRarity)}`,
      from: fromIndex,
      to: ascendAt,
      ...(isFinalAscension && reasons.has('rarity')
        ? { reason: reasons.get('rarity')! }
        : { reason: `on the way to ${rarityName(wantRarity)}` }),
    });
  }

  if (steps.length === 0) notes.push('This unit already meets the target.');

  return { unitId: unit.id, current, target, resolved, steps, final: { ...state }, notes };
}

/**
 * Stats the unit will have once the plan completes.
 *
 * Rank upgrades are counted as none applied: reaching a rank consumes the
 * previous rank's upgrades, so a freshly reached rank starts empty.
 */
export function projectedStats(
  unit: Unit,
  plan: EvolutionPlan,
  db: GameDatabase,
): ComputedUnitStats | undefined {
  const projected: Unit = {
    ...unit,
    rank: plan.final.rank,
    xpLevel: plan.final.xpLevel,
    progressionIndex: plan.final.progressionIndex,
    upgrades: [],
  };
  return computeUnitStats(projected, db);
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                     */
/* -------------------------------------------------------------------------- */

const RANK_NAMES = [
  'Stone I', 'Stone II', 'Stone III', 'Iron I', 'Iron II', 'Iron III',
  'Bronze I', 'Bronze II', 'Bronze III', 'Silver I', 'Silver II', 'Silver III',
  'Gold I', 'Gold II', 'Gold III', 'Diamond I', 'Diamond II', 'Diamond III',
  'Mythic I', 'Mythic II',
];
const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];

function rankName(rank: number): string {
  return RANK_NAMES[rank] ?? `Rank ${rank}`;
}
function rarityName(rarity: number): string {
  return RARITY_NAMES[rarity] ?? `Rarity ${rarity}`;
}
