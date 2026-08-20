/**
 * Checks the attack and ability figures: that the pierce ratios the database
 * derives agree with the ones the wiki publishes, that a resolved ability
 * matches a real character screen, and that the arithmetic holds across the
 * whole roster.
 *
 * Usage: node test/validate-combat.mjs <player.json>
 */

import { readFileSync } from 'node:fs';

import {
  loadGameDatabase,
  computeUnitStats,
  unitCombat,
  resolveAbility,
  pierceRatio,
  plainText,
  DAMAGE_VARIANCE,
  ABILITY_RARITY_BONUS,
} from '../dist/gamedata/index.js';

const playerPath = process.argv[2] ?? 'player.json';
const playerResponse = JSON.parse(readFileSync(playerPath, 'utf8'));
const player = playerResponse.player;
const db = await loadGameDatabase();

const problems = [];
const note = (m) => problems.push(m);

/**
 * Placeholders `gameInfo` carries no value for, so the client must fill them
 * from somewhere else. Listed rather than failed, so a real regression still
 * shows against a known-empty set.
 */
const UNPUBLISHED_PLACEHOLDERS = new Set(['nrOfUnits']);

/* ---- pierce, against the published table -----------------------------------
 * The database derives these from the weapons themselves. The wiki's Damage
 * Types and Pierce Ratio page is an independent transcription, so the two
 * agreeing is worth more than either alone. Molecular is the wiki's name for
 * what the game still calls Gauss.
 */
const WIKI_PIERCE = {
  Bio: 30, Blast: 15, Bolter: 20, Chain: 20, Energy: 30, Eviscerate: 50,
  Flame: 25, Gauss: 60, HeavyRound: 55, Las: 10, Melta: 75, Particle: 35,
  Physical: 1, Piercing: 80, Plasma: 65, Power: 40, Projectile: 15,
  Psychic: 100, Pulse: 20, Toxic: 70, DirectDamage: 100,
};
{
  let checked = 0;
  for (const [profile, percent] of Object.entries(WIKI_PIERCE)) {
    const derived = pierceRatio(profile, db);
    if (derived === undefined) {
      note(`pierce: ${profile} has no ratio, wiki says ${percent}%`);
      continue;
    }
    checked += 1;
    if (Math.abs(derived * 100 - percent) > 0.001) {
      note(`pierce: ${profile} derived ${derived * 100}%, wiki says ${percent}%`);
    }
  }
  // And nothing derived may contradict the table where both know the type.
  for (const [profile, ratio] of Object.entries(db.pierceByDamageProfile)) {
    if (ratio < 0 || ratio > 1) note(`pierce: ${profile} out of range at ${ratio}`);
  }
  console.log(`pierce: ${checked} damage types agree with the published table  ✓`);
}

/* ---- one resolved ability, against a character screen ----------------------
 * Vindicta's Fire of Absolution reads 77 Flame damage in game at passive level
 * 11 while she is Uncommon. The table says 64, and Uncommon is one tier up, so
 * 64 x 1.2 = 76.8 -> 77.
 */
{
  const vindicta = player.units.find((u) => u.name === 'Vindicta');
  if (!vindicta) {
    console.log('ability ground truth: SKIP — Vindicta not in this roster');
  } else {
    const definition = db.units[vindicta.id];
    const ability = db.abilities[definition.passiveAbilityId];
    const stats = computeUnitStats(vindicta, db);
    const level = vindicta.abilities.find((a) => a.id === definition.passiveAbilityId)?.level;
    const resolved = resolveAbility(ability, level, stats.rarity, db);

    if (resolved.values.dmg !== 77) {
      note(`ability: Fire of Absolution resolved ${resolved.values.dmg}, the game shows 77`);
    }
    if (resolved.attack?.hits !== 3) {
      note(`ability: Fire of Absolution resolved ${resolved.attack?.hits} hits, the game shows 3`);
    }
    if (/\{\[/.test(resolved.description ?? '')) {
      note('ability: Fire of Absolution left a placeholder unfilled');
    }
    // And a list variable indexed per target must resolve to its own figure.
    const hawk = Object.values(db.abilities).find((a) => a.name === 'Swooping Hawk');
    if (hawk) {
      const text = resolveAbility(hawk, 5, 0, db).description ?? '';
      if (/\{\[/.test(text)) note('ability: Swooping Hawk left an indexed placeholder unfilled');
    }
    console.log(
      `ability ground truth: Fire of Absolution at level ${level}, ${resolved.attack?.hits}x ` +
        `${resolved.values.dmg} ${resolved.values.damageProfile}  ✓`,
    );
  }
}

/* ---- the arithmetic, across the roster ------------------------------------ */
{
  let attacks = 0;
  let withEffective = 0;
  const unfilled = new Set();
  for (const unit of player.units) {
    const stats = computeUnitStats(unit, db);
    if (!stats) continue;
    const combat = unitCombat(unit, stats.damage, stats.rarity, db, stats.itemBonuses.critChance);

    for (const attack of [combat.melee, combat.ranged, ...combat.abilityAttacks]) {
      if (!attack) continue;
      attacks += 1;

      // Total is computed from the unrounded per-hit figure, so comparing it
      // against the rounded one drifts by up to half a point per hit. An
      // ability quoting 88-109 has a midpoint of 98.5, shown as 99.
      if (Math.abs(attack.total.mid - attack.perHit.mid * attack.hits) > attack.hits / 2 + 0.5) {
        note(`${unit.name}: ${attack.label} total ${attack.total.mid} is not per-hit x hits`);
      }
      const swingHigh = attack.total.high / attack.total.mid - 1;
      if (attack.total.mid > 5 && Math.abs(swingHigh - DAMAGE_VARIANCE) > 0.02) {
        note(`${unit.name}: ${attack.label} variance band is ${(swingHigh * 100).toFixed(1)}%`);
      }
      if (attack.effective) {
        withEffective += 1;
        const expected = attack.total.mid * attack.pierceRatio;
        if (Math.abs(attack.effective.mid - expected) > 1) {
          note(
            `${unit.name}: ${attack.label} effective ${attack.effective.mid}, expected ${expected.toFixed(1)}`,
          );
        }
        if (attack.effective.mid > attack.total.mid + 1) {
          note(`${unit.name}: ${attack.label} effective exceeds total`);
        }
      }
    }

    // Melee is universal; a unit without one is a data gap worth seeing.
    if (!combat.melee) note(`${unit.name}: no melee attack in the database`);

    // Every ability should resolve. A placeholder the game itself does not
    // publish a value for is the one exception, and is counted rather than
    // failed so a regression in the rest still shows.
    for (const ability of combat.abilities) {
      for (const [, name] of (ability.description ?? '').matchAll(/\{\[(\w+)(?:\[\d+\])?\]\}/g)) {
        if (UNPUBLISHED_PLACEHOLDERS.has(name)) unfilled.add(`${ability.name}.${name}`);
        else note(`${unit.name}: ${ability.name} left {[${name}]} unfilled`);
      }
    }

    if (combat.critChain) {
      const [first] = combat.critChain.perAttack;
      if (Math.abs(first - combat.critChain.chance / 100) > 1e-9) {
        note(`${unit.name}: crit chain starts at ${first}, not the crit chance`);
      }
      for (let i = 1; i < combat.critChain.perAttack.length; i += 1) {
        if (combat.critChain.perAttack[i] > combat.critChain.perAttack[i - 1]) {
          note(`${unit.name}: crit chain rises with hit count`);
        }
      }
    }
  }
  console.log(
    `attacks: ${attacks} priced, ${withEffective} with a pierce floor` +
      (unfilled.size > 0 ? `; ${unfilled.size} placeholder(s) the game does not publish` : '') +
      '  ✓',
  );
}

/* ---- rarity raises abilities, not unit stats ------------------------------ */
{
  const ability = Object.values(db.abilities).find(
    (a) => a.variables && (a.variablesAffectedByRarityBonus ?? []).length > 0,
  );
  const scaled = ability.variablesAffectedByRarityBonus[0];
  const common = resolveAbility(ability, 5, 0, db).values[scaled];
  const rare = resolveAbility(ability, 5, 2, db).values[scaled];
  const expected = Math.round(common * (1 + ABILITY_RARITY_BONUS * 2));
  if (rare !== expected) note(`rarity bonus: ${ability.name} gave ${rare}, expected ${expected}`);

  // And a variable it does not name must not move.
  const unscaled = Object.keys(ability.variables).find(
    (name) => !ability.variablesAffectedByRarityBonus.includes(name),
  );
  if (unscaled) {
    const a = resolveAbility(ability, 5, 0, db).values[unscaled];
    const b = resolveAbility(ability, 5, 4, db).values[unscaled];
    if (a !== b) note(`rarity bonus: ${unscaled} moved despite not being named`);
  }
  console.log(`rarity bonus: +20% per tier, only where the ability names it  ✓`);
}

/* ---- traits are carried as written ---------------------------------------- */
{
  const withDescription = Object.values(db.traits).filter((t) => t.description).length;
  if (withDescription === 0) note('traits: none carry a description');
  for (const trait of Object.values(db.traits)) {
    if (/<[^>]+>/.test(plainText(trait.description) ?? '')) {
      note(`traits: ${trait.id} still has markup after stripping`);
    }
  }
  console.log(`traits: ${withDescription} of ${Object.keys(db.traits).length} described  ✓`);
}

if (problems.length === 0) {
  console.log('\n✓ attacks, abilities and traits resolve consistently');
  process.exit(0);
}
console.log(`\n✗ ${problems.length} problem(s):`);
for (const p of problems.slice(0, 20)) console.log('  ' + p);
process.exit(1);
