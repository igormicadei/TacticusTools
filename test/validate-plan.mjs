/**
 * Checks that evolution plans respect the caps that gate a unit's attributes.
 *
 * Usage: node test/validate-plan.mjs <player.json> [--raw <dir>]
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildGameDatabase,
  loadGameDatabase,
  resolvePlan,
  markProgress,
  levelToCompleteRank,
  currentState,
  maxRankForRarity,
  maxLevelForRarity,
  projectedStats,
  computeUnitStats,
} from '../dist/gamedata/index.js';

const args = process.argv.slice(2);
const playerPath = args.find((a) => !a.startsWith('--')) ?? 'player.json';
const rawIndex = args.indexOf('--raw');
const rawDir = rawIndex >= 0 ? args[rawIndex + 1] : undefined;
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const maybe = (dir, f) => (existsSync(join(dir, f)) ? read(join(dir, f)) : undefined);

const db = rawDir
  ? buildGameDatabase({
      gameInfo: read(join(rawDir, 'gameInfo.json')),
      codexUnitLevels: maybe(rawDir, 'unitlevel.json'),
      codexOrbPromotions: maybe(rawDir, 'orbpromotion.json'),
      codexLevelProgression: maybe(rawDir, 'levelprogression.json'),
      codexBattleData: maybe(rawDir, 'battledata.json'),
      codexCampaignConfigs: maybe(rawDir, 'campaignconfig.json'),
    })
  : await loadGameDatabase();

const player = read(playerPath).player;
const problems = [];
const note = (m) => problems.push(m);

/** Every intermediate state must be legal, not just the final one. */
function auditPlan(unit, target) {
  const plan = resolvePlan(unit, target, db);
  if (plan.blocked) return plan;

  for (const step of plan.steps) {
    const s = step.after;
    const rarity = s.rarity ?? 0;
    const rankCap = maxRankForRarity(rarity);
    const levelCap = maxLevelForRarity(rarity, db) ?? Infinity;
    const where = `${unit.name} step ${step.order} (${step.kind})`;
    if (s.rank > rankCap) note(`${where}: rank ${s.rank} exceeds ${rankCap} for rarity ${rarity}`);
    if (s.xpLevel > levelCap) note(`${where}: level ${s.xpLevel} exceeds ${levelCap} for rarity ${rarity}`);
    if (s.activeAbilityLevel > s.xpLevel) note(`${where}: active ability above character level`);
    if (s.passiveAbilityLevel > s.xpLevel) note(`${where}: passive ability above character level`);
  }

  // A rank step must advance exactly one rank: each rank consumes its own
  // materials, so a span collapsed into one step would hide what is needed when.
  for (const step of plan.steps) {
    if (step.kind === 'rank' && step.to - step.from !== 1) {
      note(`${unit.name} step ${step.order}: rank step spans ${step.to - step.from} ranks`);
    }
  }

  // Steps must only ever move forward.
  let prev = plan.current;
  for (const step of plan.steps) {
    const s = step.after;
    if (
      s.rank < prev.rank ||
      s.xpLevel < prev.xpLevel ||
      s.progressionIndex < prev.progressionIndex ||
      s.activeAbilityLevel < prev.activeAbilityLevel ||
      s.passiveAbilityLevel < prev.passiveAbilityLevel
    ) {
      note(`${unit.name} step ${step.order}: an attribute went backwards`);
    }
    prev = s;
  }

  // The plan must actually arrive.
  const f = plan.final;
  const r = plan.resolved;
  if (r.rank !== undefined && f.rank < r.rank) note(`${unit.name}: final rank ${f.rank} < required ${r.rank}`);
  if (r.xpLevel !== undefined && f.xpLevel < r.xpLevel) note(`${unit.name}: final level short of ${r.xpLevel}`);
  if (r.activeAbilityLevel !== undefined && f.activeAbilityLevel < r.activeAbilityLevel)
    note(`${unit.name}: final active ability short of ${r.activeAbilityLevel}`);
  if (r.rarity !== undefined && (f.rarity ?? 0) < r.rarity) note(`${unit.name}: final rarity short`);
  return plan;
}

const TARGETS = [
  { rank: 15 },
  { rarity: 5 },
  { activeAbilityLevel: 40 },
  { passiveAbilityLevel: 30 },
  { xpLevel: 50 },
  { rank: 12, activeAbilityLevel: 35, passiveAbilityLevel: 25, rarity: 4 },
  {},
];

let plans = 0;
let steps = 0;
for (const unit of player.units) {
  for (const target of TARGETS) {
    const plan = auditPlan(unit, target);
    plans += 1;
    steps += plan.steps.length;
  }
}
console.log(`audited ${plans} plans across ${player.units.length} units, ${steps} steps total`);

/* ---- the level gate on rank upgrades ----------------------------------------
 * A rank is left by applying its six upgrades, and those need a character
 * level. The roster is the check on the table: every unit had to clear the
 * threshold of the rank below to have reached the one it sits on.
 */
{
  let tight = 0;
  for (const unit of player.units) {
    if (unit.rank === 0) continue;
    const gate = levelToCompleteRank(unit.rank - 1);
    if (gate === undefined) continue;
    if (unit.xpLevel < gate) {
      note(`${unit.name}: rank ${unit.rank} at level ${unit.xpLevel}, below the gate of ${gate}`);
    }
    if (unit.xpLevel === gate) tight += 1;
  }
  console.log(`level gate: roster consistent, ${tight} unit(s) sitting exactly on a threshold  ✓`);
}

/* ---- progress against a recorded starting point -----------------------------
 * A plan resolved from where it started must keep the steps the unit has since
 * walked past, marked done, and must leave exactly the same work outstanding as
 * one resolved from where the unit stands now.
 */
for (const unit of player.units) {
  if (unit.rank < 2) continue;
  const target = { rank: Math.min(unit.rank + 2, 19) };
  // Pretend the plan was made two ranks back.
  const origin = { ...currentState(unit, db), rank: unit.rank - 2 };
  const full = markProgress(resolvePlan(unit, target, db, origin), currentState(unit, db));
  const fresh = resolvePlan(unit, target, db);

  const done = full.steps.filter((s) => s.done);
  const left = full.steps.filter((s) => !s.done);
  if (done.length === 0) note(`${unit.name}: no step marked done despite two ranks of progress`);
  if (done.some((s) => s.kind === 'rank' && s.to > unit.rank)) {
    note(`${unit.name}: a rank above the unit's own was marked done`);
  }
  if (left.length !== fresh.steps.length) {
    note(`${unit.name}: ${left.length} steps left but planning fresh gives ${fresh.steps.length}`);
  }
  if (left.map((s) => s.label).join('|') !== fresh.steps.map((s) => s.label).join('|')) {
    note(`${unit.name}: remaining steps disagree with a fresh plan`);
  }
  if (full.current.rank !== unit.rank) note(`${unit.name}: progress did not re-anchor on the live state`);
}
console.log('progress marking: checked against fresh plans  ✓');

/* ---- no rank step outruns its level gate ----------------------------------- */
for (const unit of player.units) {
  for (const target of [{ rank: 12 }, { rank: 19 }, { rarity: 5 }]) {
    for (const step of resolvePlan(unit, target, db).steps) {
      if (step.kind !== 'rank') continue;
      const gate = levelToCompleteRank(step.from);
      if (gate !== undefined && step.after.xpLevel < gate) {
        note(
          `${unit.name}: ranks off ${step.from} at level ${step.after.xpLevel}, gate is ${gate}`,
        );
      }
    }
  }
}
console.log('level gate: no plan ranks up below the threshold  ✓');

// A worked example, printed so a human can sanity-check the ordering.
const certus = player.units.find((u) => u.name === 'Certus');
if (certus) {
  const plan = resolvePlan(certus, { rank: 15, activeAbilityLevel: 40, rarity: 4 }, db);
  console.log(`\nCertus -> rank 15, active 40, Legendary (${plan.steps.length} steps):`);
  for (const s of plan.steps) console.log(`  ${String(s.order).padStart(2)}. ${s.label}`);
}

/* ---- a projection keeps what the unit does not spend ---------------------- */
{
  // Ranking up consumes the rank's slots, so a projection past a rank-up must
  // drop the applied upgrades. A plan that does not move the rank must keep
  // them — clearing them there reported the unit weaker than it is today and
  // turned a real gain into a loss on screen.
  let sameRank = 0;
  let ranked = 0;
  for (const unit of player.units) {
    if ((unit.upgrades ?? []).length === 0) continue;
    const today = computeUnitStats(unit, db);

    const starsOnly = resolvePlan(unit, { progressionIndex: unit.progressionIndex + 1 }, db);
    if (starsOnly.final.rank === unit.rank && starsOnly.steps.length > 0) {
      const after = projectedStats(unit, starsOnly, db);
      sameRank += 1;
      if (after.health < today.health) {
        note(`${unit.name}: stars-only plan projects ${after.health} health, below today's ${today.health}`);
      }
    }

    const rankUp = resolvePlan(unit, { rank: Math.min(19, unit.rank + 1) }, db);
    if (rankUp.final.rank > unit.rank) {
      ranked += 1;
      const bare = computeUnitStats({ ...unit, rank: rankUp.final.rank, progressionIndex: rankUp.final.progressionIndex, xpLevel: rankUp.final.xpLevel, upgrades: [] }, db);
      const after = projectedStats(unit, rankUp, db);
      if (after.health !== bare.health) {
        note(`${unit.name}: rank-up projection ${after.health} is not the empty-slot figure ${bare.health}`);
      }
    }
  }
  console.log(`projection: ${sameRank} star-only kept their upgrades, ${ranked} rank-ups dropped them  ✓`);
}

/* ---- a star target stands on its own ------------------------------------- */
{
  // Stars are worth buying for their own sake, so asking for them must not
  // quietly ascend the unit to a rarity it was not asked to reach.
  let planned = 0;
  for (const unit of player.units) {
    // The payload does not carry rarity, so it comes off the ladder — reading
    // `unit.rarity` here made every unit look Common and this check ran on
    // nothing at all while reporting a pass.
    const rarity = db.progressionRequirements.find(
      (r) => r.progressionIndex === unit.progressionIndex,
    )?.rarity;
    if (rarity === undefined) continue;
    const band = db.progressionRequirements.filter((r) => r.rarity === rarity);
    const top = band.reduce((n, r) => Math.max(n, r.progressionIndex), -1);
    if (top <= unit.progressionIndex) continue;
    const plan = resolvePlan(unit, { progressionIndex: top }, db);
    planned += 1;
    if (plan.steps.some((s) => s.kind === 'ascension')) {
      note(`${unit.name}: a star target inside its own band still ascended`);
    }
    if (plan.final.progressionIndex < top) {
      note(`${unit.name}: asked for rung ${top}, plan reaches ${plan.final.progressionIndex}`);
    }
  }
  console.log(`star targets: ${planned} reached without ascending  ✓`);
}

/* ---- every reason carries both of its forms ------------------------------ */
{
  // The planner writes an English sentence for scripts and a code for the UI.
  // A step with one and not the other reads as blank in one of the two places,
  // and which one depends on the language — so neither is optional.
  let coded = 0;
  for (const unit of player.units) {
    for (const target of TARGETS) {
      for (const step of resolvePlan(unit, target, db).steps) {
        if (step.reason === undefined && step.reasonCode === undefined) continue;
        if (step.reason === undefined) {
          note(`${unit.name}: step ${step.order} has a reason code but no sentence`);
        }
        if (step.reasonCode === undefined) {
          note(`${unit.name}: step ${step.order} has a reason but no code — "${step.reason}"`);
        } else {
          coded += 1;
          if (step.reasonValues === undefined) {
            note(`${unit.name}: reason ${step.reasonCode} carries no values`);
          }
        }
      }
    }
  }
  console.log(`reasons: ${coded} carry both a sentence and a code  ✓`);
}

if (problems.length === 0) {
  console.log('\n✓ every plan respects the caps at every step');
  process.exit(0);
}
console.log(`\n✗ ${problems.length} problem(s):`);
for (const p of problems.slice(0, 20)) console.log('  ' + p);
process.exit(1);
