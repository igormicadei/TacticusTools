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
 * Character level needed to apply every upgrade of a rank — and so to leave it.
 *
 * A rank's six upgrades sit in two rows. The first row can be applied at any
 * level; each upgrade in the second row has its own level threshold, and the
 * value here is the highest of them, which is what completing the rank costs.
 *
 * Published on the Tacticus wiki's Unit Progression page, and not present in
 * any machine-readable source — neither `gameInfo` nor Codex models it, so it
 * is transcribed here rather than loaded.
 *
 * Two independent checks support it. Four units in a 29-unit roster sit exactly
 * on a threshold and none violates one (Azrael reached Stone III at exactly 5,
 * Calandis Iron I at exactly 8, Bellator and Vindicta Bronze I at exactly 17).
 * And each tier's last rank costs exactly that tier's rarity level cap — Common
 * caps at 8 and Stone III costs 8, Uncommon at 17 and Iron III costs 17, Rare
 * at 26 and Bronze III costs 26, Epic at 35 and Silver III costs 35 — so the
 * two tables, from different sources, agree on every boundary.
 *
 * Indexed by {@link Rank}. Diamond III and the Mythic ranks are absent: the
 * table was written when Diamond III was the ceiling, so no value is published
 * for them and none is invented here.
 */
const LEVEL_TO_COMPLETE_RANK: readonly (number | undefined)[] = [
  3, // Stone I
  5, // Stone II
  8, // Stone III
  11, // Iron I
  14, // Iron II
  17, // Iron III
  20, // Bronze I
  23, // Bronze II
  26, // Bronze III
  29, // Silver I
  32, // Silver II
  35, // Silver III
  38, // Gold I
  41, // Gold II
  44, // Gold III
  47, // Diamond I
  50, // Diamond II
];

/**
 * Character level needed to finish `rank`'s upgrades and move off it.
 *
 * `undefined` where the game publishes no threshold, in which case the level is
 * treated as no obstacle rather than guessed at.
 */
export function levelToCompleteRank(rank: Rank): number | undefined {
  return LEVEL_TO_COMPLETE_RANK[rank];
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

/** Why a step the player did not ask for is in the plan. */
export type PlanReasonCode =
  | 'rankUpgradesNeedLevel'
  | 'cappedByRarity'
  | 'cappedByLevel'
  | 'neededBeforeAscending'
  | 'onTheWayTo'
  | 'abilityRequiresLevel'
  | 'rankRequiresLevel'
  | 'levelRequiresRarity'
  | 'rankRequiresRarity';

/** A reason derived while resolving a target, in both forms. */
interface DerivedReason {
  text: string;
  code: PlanReasonCode;
  values: Readonly<Record<string, string | number>>;
}

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
   *
   * English, for scripts and validators that read a plan without a UI.
   */
  reason?: string;
  /**
   * The same reason as a code and its values.
   *
   * A sentence built here can only be built in one language, and the UI has
   * more than one. This carries what the sentence is *about* so the reader's
   * language can phrase it — see the UI's `localStepReason`.
   */
  reasonCode?: PlanReasonCode;
  reasonValues?: Readonly<Record<string, string | number>>;
  /** State after the step completes. */
  after: UnitState;
  /**
   * Already achieved. Set by {@link markProgress} when a plan is resolved from
   * where it started rather than from where the unit is now.
   */
  done?: boolean;
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
): {
  resolved: EvolutionTarget;
  blocked?: string;
  reasons: Map<string, DerivedReason>;
} {
  const reasons = new Map<string, DerivedReason>();

  const abilityMax = Math.max(
    target.activeAbilityLevel ?? 0,
    target.passiveAbilityLevel ?? 0,
  );
  const rank = Math.max(target.rank ?? 0, current.rank) as Rank;

  let level = Math.max(target.xpLevel ?? 0, current.xpLevel);
  if (abilityMax > level) {
    level = abilityMax;
    reasons.set('level', {
      text: `ability level ${abilityMax} requires character level ${abilityMax}`,
      code: 'abilityRequiresLevel',
      values: { level: abilityMax },
    });
  }
  // A rank is left by applying its upgrades, and those are level-gated, so a
  // rank target drags the character level up with it.
  const rankLevel = rank > current.rank ? levelToCompleteRank((rank - 1) as Rank) : undefined;
  if (rankLevel !== undefined && rankLevel > level) {
    level = rankLevel;
    reasons.set('level', {
      text: `rank ${rankName(rank)} requires character level ${rankLevel}`,
      code: 'rankRequiresLevel',
      values: { rank, level: rankLevel },
    });
  }

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
    reasons.set(
      'rarity',
      neededForLevel >= neededForRank
        ? {
            text: `level ${level} requires ${rarityName(rarity)}`,
            code: 'levelRequiresRarity',
            values: { level, rarity },
          }
        : {
            text: `rank ${rankName(rank)} requires ${rarityName(rarity)}`,
            code: 'rankRequiresRarity',
            values: { rank, rarity },
          },
    );
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
  /**
   * Plan from here instead of from the unit's present state. Used to lay out
   * the whole route a plan set out to walk, so the parts already behind the
   * unit stay visible rather than silently disappearing as it progresses.
   */
  from?: UnitState,
): EvolutionPlan {
  const current = from ?? currentState(unit, db);
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
      // One rank at a time. Each rank consumes its own six materials, so
      // collapsing a span into a single step would hide which materials are
      // needed now and which belong to a rank days away.
      const from = state.rank;
      const to = (from + 1) as Rank;
      const gate = levelToCompleteRank(from);
      // The upgrades that leave a rank cannot be applied below a certain level,
      // so the level comes first — farming the materials early would only leave
      // them sitting unusable.
      const tooLow = gate !== undefined && state.xpLevel < gate;

      if (tooLow && state.xpLevel < levelCap) {
        const reached = Math.min(gate!, levelCap);
        const fromLevel = state.xpLevel;
        state.xpLevel = reached;
        push({
          kind: 'level',
          label: `Level to ${reached}`,
          from: fromLevel,
          to: reached,
          ...(reached >= gate!
            ? {
                reason: `${rankName(from)}'s upgrades need character level ${gate} to apply`,
                reasonCode: 'rankUpgradesNeedLevel' as const,
                reasonValues: { rank: from, level: gate! },
              }
            : {
                reason: `capped by ${rarityName(rarity)} until ascension`,
                reasonCode: 'cappedByRarity' as const,
                reasonValues: { rarity },
              }),
        });
        continue;
      }

      if (!tooLow) {
        state.rank = to;
        push({
          kind: 'rank',
          label: `Rank up to ${rankName(to)}`,
          from,
          to,
          ...(to === rankCap && to < wantRank
            ? {
                reason: `capped by ${rarityName(rarity)} until ascension`,
                reasonCode: 'cappedByRarity' as const,
                reasonValues: { rarity },
              }
            : {}),
        });
        continue;
      }
      // Short of the gate with the level itself capped: only an ascension lifts
      // it, so fall through to the rarity branch below.
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
        ...(reasons.has('level') && to >= wantLevel
          ? {
              reason: reasons.get('level')!.text,
              reasonCode: reasons.get('level')!.code,
              reasonValues: reasons.get('level')!.values,
            }
          : {}),
        ...(to < wantLevel
          ? {
              reason: `capped by ${rarityName(rarity)} until ascension`,
              reasonCode: 'cappedByRarity' as const,
              reasonValues: { rarity },
            }
          : {}),
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
        ...(to < wantActive
          ? {
              reason: `capped by character level ${state.xpLevel}`,
              reasonCode: 'cappedByLevel' as const,
              reasonValues: { level: state.xpLevel },
            }
          : {}),
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
        ...(to < wantPassive
          ? {
              reason: `capped by character level ${state.xpLevel}`,
              reasonCode: 'cappedByLevel' as const,
              reasonValues: { level: state.xpLevel },
            }
          : {}),
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
        reasonCode: 'neededBeforeAscending' as const,
        reasonValues: { rarity: nextRarity },
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
        ? {
            reason: reasons.get('rarity')!.text,
            reasonCode: reasons.get('rarity')!.code,
            reasonValues: reasons.get('rarity')!.values,
          }
        : {
            reason: `on the way to ${rarityName(wantRarity)}`,
            reasonCode: 'onTheWayTo' as const,
            reasonValues: { rarity: wantRarity },
          }),
    });
  }

  if (steps.length === 0) notes.push('This unit already meets the target.');

  return { unitId: unit.id, current, target, resolved, steps, final: { ...state }, notes };
}

/**
 * Flag the steps a unit has already walked past, and re-anchor the plan on
 * where it stands now.
 *
 * Progress is judged per attribute rather than by position, so a unit that
 * advanced out of order — ascending before finishing a rank, say — still has
 * every step it actually completed marked.
 */
export function markProgress(plan: EvolutionPlan, live: UnitState): EvolutionPlan {
  const done = (step: PlanStep): boolean => {
    switch (step.kind) {
      case 'rank':
        return live.rank >= step.to;
      case 'level':
        return live.xpLevel >= step.to;
      case 'ability':
        return (
          (step.ability === 'passive' ? live.passiveAbilityLevel : live.activeAbilityLevel) >=
          step.to
        );
      case 'promotion':
      case 'ascension':
        return live.progressionIndex >= step.to;
    }
  };

  return {
    ...plan,
    current: live,
    steps: plan.steps.map((step) => (done(step) ? { ...step, done: true } : step)),
  };
}

/**
 * Stats the unit will have once the plan completes.
 *
 * Rank upgrades are counted as none applied: reaching a rank consumes the
 * previous rank's upgrades, so a freshly reached rank starts empty.
 */
export function projectedStatsAt(
  unit: Unit,
  state: UnitState,
  db: GameDatabase,
): ComputedUnitStats | undefined {
  const projected: Unit = {
    ...unit,
    rank: state.rank,
    xpLevel: state.xpLevel,
    progressionIndex: state.progressionIndex,
    // No rank upgrades applied. Reaching a rank consumes the previous rank's,
    // so a newly reached rank starts empty — projecting with the unit's current
    // upgrades would credit it with slots it is about to spend.
    upgrades: [],
  };
  return computeUnitStats(projected, db);
}

export function projectedStats(
  unit: Unit,
  plan: EvolutionPlan,
  db: GameDatabase,
): ComputedUnitStats | undefined {
  return projectedStatsAt(unit, plan.final, db);
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
