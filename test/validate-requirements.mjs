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
  isUnobtainable,
  canForge,
  itemSources,
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

  // Fitted materials are covered without touching stock, so the same 12 are
  // still free for the steps that genuinely need them.
  const applied = [
    { ...costs[0], items: [{ ...costs[0].items[0], applied: true }] },
    costs[1],
    costs[2],
  ];
  const withApplied = allocateHoldings(applied, new Map([['upgrade:test', 12]]));
  const appliedGot = withApplied.map((s) => `${s.items[0].covered}/${s.items[0].amount}`).join(', ');
  if (appliedGot !== '5/5, 5/5, 5/5') {
    note(`applied items: expected "5/5, 5/5, 5/5", got "${appliedGot}"`);
  } else console.log(`applied items do not draw stock: ${appliedGot}  ✓`);
  if (withApplied[0].items[0].missing !== 0) note('applied items: reported as missing');

  const none = allocateHoldings(costs, new Map());
  if (none.some((s) => s.items[0].covered !== 0)) note('distribution: covered something with nothing held');
  const plenty = allocateHoldings(costs, new Map([['upgrade:test', 99]]));
  if (plenty.some((s) => s.items[0].covered !== 5)) note('distribution: covered more than the step needs');
}

/* ---- "ready to forge" ------------------------------------------------------
 * A forged item shows readiness instead of a count, so that readiness has to
 * mean exactly one thing: every ingredient is in hand, counting an ingredient
 * that is itself forgeable from what is held.
 */
{
  const held = (missing) => ({ key: 'x', id: 'x', name: 'x', amount: 1, covered: 1 - missing, missing });
  const cases = [
    [[held(0), held(0)], true, 'all ingredients held'],
    [[held(0), held(1)], false, 'one ingredient short'],
    [[{ ...held(1), components: [held(0)] }], true, 'short ingredient is itself forgeable'],
    [[{ ...held(1), components: [held(1)] }], false, 'short ingredient cannot be forged either'],
    [[], true, 'nothing to gather'],
  ];
  for (const [components, expected, why] of cases) {
    if (canForge(components) !== expected) note(`canForge: ${why} should be ${expected}`);
  }
  console.log('forge readiness: 5 cases  ✓');
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
    const spread = allocateHoldings(costs, owned, db);
    const totals = aggregate(costs, owned, db);
    checked += 1;

    for (const step of spread) {
      for (const item of step.items) {
        if (item.covered > item.amount) note(`${unit.name}: covered exceeds need for ${item.name}`);
        if (item.covered < 0 || item.missing < 0) note(`${unit.name}: negative allocation for ${item.name}`);
      }
    }

    // No item may be allocated more than the player actually holds — counting
    // recipe ingredients, which draw on the same stock.
    const allocated = new Map();
    const tally = (item) => {
      // Fitted materials are spent, not drawn from stock.
      if (!item.applied) allocated.set(item.key, (allocated.get(item.key) ?? 0) + item.covered);
      for (const component of item.components ?? []) tally(component);
    };
    for (const step of spread) for (const item of step.items) tally(item);
    for (const [key, total] of allocated) {
      if (total > (owned.get(key) ?? 0)) note(`${unit.name}: allocated ${total} of ${key}, holds ${owned.get(key) ?? 0}`);
    }

    // Totals must equal the sum of the steps. Fitted materials pool separately
    // from the same item still to find, so the key carries that split.
    const poolKey = (item) => (item.applied ? `${item.key}#applied` : item.key);
    const summed = new Map();
    for (const { items } of costs) {
      for (const item of items) summed.set(poolKey(item), (summed.get(poolKey(item)) ?? 0) + item.amount);
    }
    for (const item of totals) {
      if (item.amount !== summed.get(poolKey(item))) {
        note(`${unit.name}: total for ${item.name} disagrees with its steps`);
      }
      if (item.applied && item.missing !== 0) note(`${unit.name}: ${item.name} is fitted but reported missing`);
    }

    // Readiness replaces the count only for forged items, so anything showing
    // it must have no farmable form at all.
    for (const item of totals) {
      if (itemSource(item, db).kind !== 'craft') continue;
      if ((itemSources(item, db) ?? []).length > 0) {
        note(`${unit.name}: ${item.name} is both forged and farmed`);
      }
      if (item.missing > 0 && canForge(item.components ?? []) && item.components === undefined) {
        note(`${unit.name}: ${item.name} reads ready to forge with no recipe resolved`);
      }
    }

    // "Stock only" warns that what is in hand cannot be replaced, so it must
    // only ever appear where there is genuinely no reachable source.
    for (const item of totals) {
      if (!isUnobtainable(item, db, playerResponse)) continue;
      const source = itemSource(item, db);
      if (source.kind === 'other') note(`${unit.name}: ${item.name} unobtainable but is not campaign-farmed`);
      if (source.kind === 'farm' && nodeStatuses(source.nodes, playerResponse, db).some((n) => n.unlocked)) {
        note(`${unit.name}: ${item.name} unobtainable but has an unlocked node`);
      }
    }

    // The reverse must hold: nothing can be a wall for its shortfall while
    // still having somewhere to come from. (Not the converse — a recipe with
    // no farmable ingredient is still craftable from what is in hand, which is
    // precisely what "stock only" warns about.)
    for (const item of totals) {
      if (isUnfarmable(item, db, playerResponse) && !isUnobtainable(item, db, playerResponse)) {
        note(`${unit.name}: ${item.name} flagged blocked yet has a reachable source`);
      }
    }

    // A blocked item must genuinely have no reachable source, and must still be
    // short of it — holding enough is not being blocked.
    for (const item of totals) {
      if (item.missing <= 0 && isUnfarmable(item, db, playerResponse)) {
        note(`${unit.name}: ${item.name} flagged blocked but nothing is missing`);
      }
      if (!isUnfarmable(item, db, playerResponse)) continue;
      blockedSeen += 1;
      const source = itemSource(item, db);
      if (source.kind === 'farm' && nodeStatuses(source.nodes, playerResponse, db).some((n) => n.unlocked)) {
        note(`${unit.name}: ${item.name} flagged blocked but has an unlocked node`);
      }
      if (source.kind === 'other') note(`${unit.name}: ${item.name} flagged blocked but is not campaign-farmed`);
      if (source.kind === 'craft' && item.components?.every((c) => c.missing === 0)) {
        note(`${unit.name}: ${item.name} flagged blocked but every ingredient is in hand`);
      }
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
