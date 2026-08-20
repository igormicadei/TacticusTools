/**
 * What a unit actually does when it attacks.
 *
 * The character screen shows one damage number, which is damage *per hit*
 * before armour. What matters in a fight is that number times the hit count,
 * and then how much of it armour cannot stop. Both follow from data the game
 * publishes per weapon; neither is displayed anywhere in the game.
 */

import { Rarity } from './enums.js';
import type { AbilityDefinition, GameDatabase, WeaponProfile } from './types.js';
import type { Unit } from '../types/player.js';

/* -------------------------------------------------------------------------- */
/* Rules                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every attack rolls +/- 20% on its damage.
 *
 * Published on the wiki's Advanced Mechanics page and again in HDTW Damage,
 * where the formula reads `DamVar = Damage * (1 +/- up to 0.2)`. It is applied
 * to the damage *per hit, before armour and before the pierce floor*, so
 * everything downstream — total and effective alike — swings by the same 20%.
 */
export const DAMAGE_VARIANCE = 0.2;

/**
 * Ability values gain 20% per rarity tier.
 *
 * The other half of the pair the wiki's HDTW Progression page describes: stars
 * raise unit stats, rarity raises ability variables. Which variables it touches
 * is named per ability by `variablesAffectedByRarityBonus`.
 *
 * Confirmed against a character screen: Vindicta's Fire of Absolution at
 * ability level 11 is 64 in the table, and she is Uncommon, so 64 x 1.2 = 76.8,
 * displayed as 77.
 */
export const ABILITY_RARITY_BONUS = 0.2;

/** Pierce for types no weapon carries, so the derived map cannot see them. */
const PIERCE_FALLBACK: Record<string, number> = {
  // Named on the wiki's damage table; no hero weapon uses it, so it cannot be
  // read off the roster the way the other twenty are.
  DirectDamage: 1,
};

/** Pierce ratio for a damage type, 0-1, or `undefined` if nothing publishes it. */
export function pierceRatio(damageProfile: string, db: GameDatabase): number | undefined {
  return db.pierceByDamageProfile[damageProfile] ?? PIERCE_FALLBACK[damageProfile];
}

/* -------------------------------------------------------------------------- */
/* Attacks                                                                    */
/* -------------------------------------------------------------------------- */

/** A band around a figure, from the +/- 20% every attack rolls. */
export interface DamageRange {
  mid: number;
  low: number;
  high: number;
}

const band = (mid: number): DamageRange => ({
  mid: Math.round(mid),
  low: Math.round(mid * (1 - DAMAGE_VARIANCE)),
  high: Math.round(mid * (1 + DAMAGE_VARIANCE)),
});

export interface AttackProfile {
  /** Where this attack comes from. */
  source: 'melee' | 'ranged' | 'ability';
  /** Weapon name is not published, so this is the damage type or ability name. */
  label: string;
  damageProfile: string;
  hits: number;
  range?: number;
  pierceRatio?: number;
  pierceDescription?: string;
  traits: string[];
  /** Damage per hit before armour. */
  perHit: DamageRange;
  /** `perHit x hits` — the whole attack against an unarmoured target. */
  total: DamageRange;
  /**
   * `total x pierceRatio` — the part armour can never stop.
   *
   * The floor, not a prediction: against a lightly armoured target the attack
   * lands for more. Undefined when no source publishes the type's pierce.
   */
  effective?: DamageRange;
  /**
   * Armour at which this attack drops to its pierce floor.
   *
   * `perHit x (1 - pierce)`. Below it armour still bites one-for-one; above it
   * more armour changes nothing.
   */
  armourFloorAt?: number;
  /** Set for abilities that ride on or replace a normal attack. */
  attackRangeType?: 'Melee' | 'Ranged' | 'Normal';
  /**
   * Which ability slot an attack came from.
   *
   * Read off the unit's own `activeAbilityId` / `passiveAbilityId` /
   * `mythicAbilityIds`, so it is structural rather than inferred from the
   * ability's own fields. Absent for the two normal attacks.
   */
  slot?: AbilitySlot;
}

function weaponProfile(
  weapon: WeaponProfile,
  source: 'melee' | 'ranged',
  damage: number,
  db: GameDatabase,
): AttackProfile {
  const pierce = pierceRatio(weapon.damageProfile, db) ?? weapon.pierceRatio;
  return {
    source,
    label: weapon.damageProfile,
    damageProfile: weapon.damageProfile,
    hits: weapon.hits,
    ...(weapon.range !== undefined ? { range: weapon.range } : {}),
    pierceRatio: pierce,
    ...(weapon.pierceDescription !== undefined
      ? { pierceDescription: weapon.pierceDescription }
      : {}),
    traits: weapon.traits,
    perHit: band(damage),
    total: band(damage * weapon.hits),
    effective: band(damage * weapon.hits * pierce),
    armourFloorAt: Math.round(damage * (1 - pierce)),
  };
}

/* -------------------------------------------------------------------------- */
/* Abilities                                                                  */
/* -------------------------------------------------------------------------- */

/** Which of a unit's ability slots this came from. */
export type AbilitySlot = 'active' | 'passive' | 'mythic';

export interface ResolvedAbility {
  id: string;
  name: string;
  slot: AbilitySlot;
  level: number;
  /** Description with `{[name]}` placeholders filled in, markup intact. */
  description?: string;
  /** Every variable and constant at this level and rarity. */
  values: Record<string, number | string>;
  /** Present when the ability deals damage in its own right. */
  attack?: AttackProfile;
}

/** Number of hits an ability deals, when it says. */
function abilityHits(ability: AbilityDefinition): number | undefined {
  const raw = ability.constants?.['nrOfHits'];
  const hits = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(hits) ? hits : undefined;
}

/**
 * Fill an ability's values in at a given level and rarity.
 *
 * Levels are 1-based; a level beyond the published table clamps to its last
 * entry rather than reading off the end. Rarity raises only the variables the
 * ability names, which is why the bonus cannot be applied to the row as a whole.
 */
export function resolveAbility(
  ability: AbilityDefinition,
  level: number,
  rarity: Rarity | undefined,
  db: GameDatabase,
  slot: AbilitySlot = 'active',
  /**
   * Values the game client supplies from context rather than from the ability,
   * `UnitName` being the one that appears in descriptions.
   */
  context: Readonly<Record<string, string>> = {},
): ResolvedAbility {
  const bonus = 1 + ABILITY_RARITY_BONUS * (rarity ?? 0);
  const scaled = new Set(ability.variablesAffectedByRarityBonus ?? []);
  const values: Record<string, number | string> = { ...context, ...ability.constants };

  const at = (length: number): number => Math.min(Math.max(level, 1), length) - 1;

  for (const [name, series] of Object.entries(ability.variables ?? {})) {
    if (series.length === 0) continue;
    const base = series[at(series.length)]!;
    // 76.8 shows as 77, so this rounds where unit stats truncate. One screen
    // cannot separate rounding from ceiling; rounding is the safer reading.
    values[name] = scaled.has(name) ? Math.round(base * bonus) : base;
  }
  // Values that are a list rather than a number fill the description in as
  // written; the rarity bonus has no single figure to multiply.
  for (const [name, series] of Object.entries(ability.textVariables ?? {})) {
    if (series.length === 0) continue;
    values[name] = series[at(series.length)]!;
  }

  // Placeholders are `{[name]}`, or `{[name[i]]}` to pick one entry out of a
  // list variable — Swooping Hawk's `36,28,20` is read as dmg[0], dmg[1],
  // dmg[2], one figure per target.
  const description = ability.description?.replace(
    /\{\[(\w+)(?:\[(\d+)\])?\]\}/g,
    (whole, name: string, index: string | undefined) => {
      const value = values[name];
      if (value === undefined) return whole;
      if (index === undefined) return String(value);
      const parts = String(value).split(',');
      return parts[Number(index)]?.trim() ?? whole;
    },
  );

  const damageProfile = ability.constants?.['damageProfile'];
  const hits = abilityHits(ability);
  // `dmg` is the usual name; some abilities give a range instead.
  const perHit =
    typeof values['dmg'] === 'number'
      ? values['dmg']
      : typeof values['minDmg'] === 'number' && typeof values['maxDmg'] === 'number'
        ? (values['minDmg'] + values['maxDmg']) / 2
        : undefined;

  let attack: AttackProfile | undefined;
  if (damageProfile && hits !== undefined && perHit !== undefined) {
    const pierce = pierceRatio(damageProfile, db);
    const range = Number(values['range']);
    attack = {
      source: 'ability',
      label: ability.name,
      damageProfile,
      hits,
      ...(Number.isFinite(range) ? { range } : {}),
      ...(pierce !== undefined ? { pierceRatio: pierce } : {}),
      traits: [],
      perHit: band(perHit),
      total: band(perHit * hits),
      ...(pierce !== undefined
        ? {
            effective: band(perHit * hits * pierce),
            armourFloorAt: Math.round(perHit * (1 - pierce)),
          }
        : {}),
      ...(ability.attackRangeType !== undefined
        ? { attackRangeType: ability.attackRangeType }
        : {}),
      slot,
    };
  }

  return {
    id: ability.id,
    name: ability.name,
    slot,
    level,
    ...(description !== undefined ? { description } : {}),
    values,
    ...(attack !== undefined ? { attack } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Everything a unit brings                                                   */
/* -------------------------------------------------------------------------- */

export interface UnitCombat {
  melee?: AttackProfile;
  ranged?: AttackProfile;
  /** Active first, then passive, then any mythic abilities. */
  abilities: ResolvedAbility[];
  /** Abilities that deal damage, in the order above. */
  abilityAttacks: AttackProfile[];
  /** Trait ids the unit carries, resolved against the trait table. */
  traits: { id: string; name: string; description?: string }[];
  /**
   * Chance that a multi-hit attack keeps critting.
   *
   * Hits are rolled one at a time and the chain stops at the first failure, so
   * the chance of the whole attack critting is `critChance ^ hits` — which is
   * why crit chance is worth far more on a one-hit weapon than a four-hit one.
   * Absent when no equipment grants crit chance.
   */
  critChain?: { chance: number; perAttack: number[] };
}

/** Strip the client's icon markup, keeping the words. */
export function plainText(markup: string | undefined): string | undefined {
  if (markup === undefined) return undefined;
  return markup
    .replace(/<img[^>]*>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a unit's attacks, abilities and traits.
 *
 * `damage` is the unit's computed damage stat — the one the character screen
 * shows — since every attack scales from it.
 */
export function unitCombat(
  unit: Unit,
  damage: number,
  rarity: Rarity | undefined,
  db: GameDatabase,
  critChance?: number,
): UnitCombat {
  const definition = db.units[unit.id];
  const levelOf = (id: string | undefined): number =>
    id ? (unit.abilities.find((a) => a.id === id)?.level ?? 1) : 1;

  const abilities: ResolvedAbility[] = [];
  const slots: [string | undefined, AbilitySlot][] = [
    [definition?.activeAbilityId, 'active'],
    [definition?.passiveAbilityId, 'passive'],
    ...(definition?.mythicAbilityIds ?? []).map(
      (id): [string, AbilitySlot] => [id, 'mythic'],
    ),
  ];
  for (const [id, slot] of slots) {
    const ability = id ? db.abilities[id] : undefined;
    if (ability) {
      abilities.push(
        resolveAbility(ability, levelOf(id), rarity, db, slot, {
          UnitName: unit.name ?? unit.id,
        }),
      );
    }
  }

  const traits = (definition?.traits ?? []).map((id) => {
    const trait = db.traits[id];
    const name = plainText(trait?.name) ?? id;
    const description = plainText(trait?.description);
    return { id, name, ...(description !== undefined ? { description } : {}) };
  });

  // A chain of `n` crits needs `n` successes in a row, since the roll stops at
  // the first failure.
  const hits = Math.max(definition?.meleeWeapon?.hits ?? 1, definition?.rangeWeapon?.hits ?? 1);
  const critChain =
    critChance !== undefined && critChance > 0
      ? {
          chance: critChance,
          perAttack: Array.from({ length: hits }, (_, i) => (critChance / 100) ** (i + 1)),
        }
      : undefined;

  return {
    ...(definition?.meleeWeapon
      ? { melee: weaponProfile(definition.meleeWeapon, 'melee', damage, db) }
      : {}),
    ...(definition?.rangeWeapon
      ? { ranged: weaponProfile(definition.rangeWeapon, 'ranged', damage, db) }
      : {}),
    abilities,
    abilityAttacks: abilities.flatMap((a) => (a.attack ? [a.attack] : [])),
    traits,
    ...(critChain ? { critChain } : {}),
  };
}
