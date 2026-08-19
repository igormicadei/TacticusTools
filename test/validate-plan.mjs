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
  currentState,
  maxRankForRarity,
  maxLevelForRarity,
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

// A worked example, printed so a human can sanity-check the ordering.
const certus = player.units.find((u) => u.name === 'Certus');
if (certus) {
  const plan = resolvePlan(certus, { rank: 15, activeAbilityLevel: 40, rarity: 4 }, db);
  console.log(`\nCertus -> rank 15, active 40, Legendary (${plan.steps.length} steps):`);
  for (const s of plan.steps) console.log(`  ${String(s.order).padStart(2)}. ${s.label}`);
}

if (problems.length === 0) {
  console.log('\n✓ every plan respects the caps at every step');
  process.exit(0);
}
console.log(`\n✗ ${problems.length} problem(s):`);
for (const p of problems.slice(0, 20)) console.log('  ' + p);
process.exit(1);
