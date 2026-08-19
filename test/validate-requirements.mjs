/**
 * Checks per-step item requirements: how held stock is spread across steps,
 * that totals agree with the steps, and that "nowhere to farm this" is only
 * reported when it is true.
 *
 * Usage: node test/validate-requirements.mjs <player.json> [--raw <dir>]
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildGameDatabase,
  loadGameDatabase,
  resolvePlan,
  planCosts,
  ownedByKey,
  allocateHoldings,
  aggregate,
  itemSource,
  nodeStatuses,
  isUnfarmable,
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
      codexBattleData: maybe(rawDir, 'battledata.json'),
      codexCampaignConfigs: maybe(rawDir, 'campaignconfig.json'),
      codexUnitLevels: maybe(rawDir, 'unitlevel.json'),
      codexOrbPromotions: maybe(rawDir, 'orbpromotion.json'),
      codexLevelProgression: maybe(rawDir, 'levelprogression.json'),
    })
  : await loadGameDatabase();

const playerResponse = read(playerPath);
const player = playerResponse.player;
const problems = [];
const note = (m) => problems.push(m);

/* ---- the stated distribution rule ------------------------------------------
 * 15 of one item split evenly over three steps, with 12 held, must read
 * 5/5, 5/5, 2/5 — earliest steps filled first, never averaged.
 */
{
  const costs = [1, 2, 3].map((order) => ({
    step: { order, kind: 'rank', label: `step ${order}`, from: 0, to: 1, after: {} },
    gold: 0,
    items: [{ key: 'upgrade:test', kind: 'upgrade', name: 'Test', amount: 5 }],
  }));
  const spread = allocateHoldings(costs, new Map([['upgrade:test', 12]]));
  const got = spread.map((s) => `${s.items[0].covered}/${s.items[0].amount}`).join(', ');
  if (got !== '5/5, 5/5, 2/5') note(`distribution: expected "5/5, 5/5, 2/5", got "${got}"`);
  else console.log(`distribution rule: ${got}  ✓`);

  const none = allocateHoldings(costs, new Map());
  if (none.some((s) => s.items[0].covered !== 0)) note('distribution: covered something with nothing held');
  const plenty = allocateHoldings(costs, new Map([['upgrade:test', 99]]));
  if (plenty.some((s) => s.items[0].covered !== 5)) note('distribution: covered more than the step needs');
}

/* ---- against the real roster ---------------------------------------------- */
const TARGETS = [{ rank: 12, activeAbilityLevel: 30 }, { rarity: 4 }, { xpLevel: 35 }];
let checked = 0;
let blockedSeen = 0;

for (const unit of player.units) {
  for (const target of TARGETS) {
    const plan = resolvePlan(unit, target, db);
    if (plan.steps.length === 0) continue;
    const costs = planCosts(unit, plan, db);
    const owned = ownedByKey(playerResponse, db);
    const spread = allocateHoldings(costs, owned);
    const totals = aggregate(costs, owned);
    checked += 1;

    for (const step of spread) {
      for (const item of step.items) {
        if (item.covered > item.amount) note(`${unit.name}: covered exceeds need for ${item.name}`);
        if (item.covered < 0 || item.missing < 0) note(`${unit.name}: negative allocation for ${item.name}`);
      }
    }

    // No item may be allocated more than the player actually holds.
    const allocated = new Map();
    for (const step of spread) {
      for (const item of step.items) {
        allocated.set(item.key, (allocated.get(item.key) ?? 0) + item.covered);
      }
    }
    for (const [key, total] of allocated) {
      if (total > (owned.get(key) ?? 0)) note(`${unit.name}: allocated ${total} of ${key}, holds ${owned.get(key) ?? 0}`);
    }

    // Totals must equal the sum of the steps.
    const summed = new Map();
    for (const { items } of costs) {
      for (const item of items) summed.set(item.key, (summed.get(item.key) ?? 0) + item.amount);
    }
    for (const item of totals) {
      if (item.amount !== summed.get(item.key)) note(`${unit.name}: total for ${item.name} disagrees with its steps`);
    }

    // A blocked item must genuinely have no reachable source.
    for (const item of totals) {
      if (!isUnfarmable(item, db, playerResponse)) continue;
      blockedSeen += 1;
      const source = itemSource(item, db);
      if (source.kind === 'farm' && nodeStatuses(source.nodes, playerResponse, db).some((n) => n.unlocked)) {
        note(`${unit.name}: ${item.name} flagged blocked but has an unlocked node`);
      }
      if (source.kind === 'other') note(`${unit.name}: ${item.name} flagged blocked but is not campaign-farmed`);
    }
  }
}

console.log(`audited ${checked} plans; ${blockedSeen} blocked-item findings verified`);

if (problems.length === 0) {
  console.log('\n✓ requirements, allocation and sources are consistent');
  process.exit(0);
}
console.log(`\n✗ ${problems.length} problem(s):`);
for (const p of problems.slice(0, 20)) console.log('  ' + p);
process.exit(1);
