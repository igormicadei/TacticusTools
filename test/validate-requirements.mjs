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
  flattenNeeds,
  farmingCost,
  energyPerCopy,
  raidsToday,
  levelToCompleteRank,
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

/* ---- ability upgrade costs --------------------------------------------------
 * A row is the cost of leaving its level, not of reaching it. Ground truth from
 * the game: taking an ability from 14 to 15 asks 1250 gold and 3 Uncommon
 * badges, which is the row at level 14 — reading it as the cost of reaching 15
 * charged 1500 gold and 4 badges.
 */
{
  const step = { order: 1, kind: 'ability', ability: 'active', label: '', from: 14, to: 15, after: {} };
  const [cost] = planCosts(
    { id: 'x', name: 'x', rank: 0, xpLevel: 1, progressionIndex: 0, grandAlliance: 'Chaos', upgrades: [], abilities: [], items: [], shards: 0, mythicShards: 0 },
    { steps: [step] },
    db,
  );
  const badges = cost.items.find((i) => i.kind === 'badge');
  if (cost.gold !== 1250) note(`ability 14->15: expected 1250 gold, got ${cost.gold}`);
  if (badges?.amount !== 3) note(`ability 14->15: expected 3 badges, got ${badges?.amount}`);
  if (badges?.rarity !== 1) note(`ability 14->15: expected Uncommon badges, got rarity ${badges?.rarity}`);

  // And a span must be the sum of the rows it crosses, not an offset window.
  const span = { ...step, from: 13, to: 15 };
  const [wide] = planCosts(
    { id: 'x', name: 'x', rank: 0, xpLevel: 1, progressionIndex: 0, grandAlliance: 'Chaos', upgrades: [], abilities: [], items: [], shards: 0, mythicShards: 0 },
    { steps: [span] },
    db,
  );
  const rows = db.abilityUpgradeCosts.filter((c) => c.level >= 13 && c.level <= 14);
  const goldSum = rows.reduce((n, c) => n + c.gold, 0);
  const badgeSum = rows.reduce((n, c) => n + c.amount, 0);
  if (wide.gold !== goldSum) note(`ability 13->15: expected ${goldSum} gold, got ${wide.gold}`);
  const wideBadges = wide.items.find((i) => i.kind === 'badge');
  if (wideBadges?.amount !== badgeSum) {
    note(`ability 13->15: expected ${badgeSum} badges, got ${wideBadges?.amount}`);
  }
  console.log(`ability costs: 14->15 is ${cost.gold} gold + ${badges?.amount} badges, 13->15 is ${wide.gold} + ${wideBadges?.amount}  ✓`);
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

/* ---- slot placements line up with the rank tables ------------------------- */
{
  // A requirement pools a material across a rank span, so the slots it carries
  // are the only record of where those copies actually go. If they drift from
  // the tables the page shows a confident lie about the game screen.
  let placements = 0;
  for (const unit of player.units) {
    const plan = resolvePlan(unit, { rank: Math.min(19, unit.rank + 2) }, db);
    if (plan.steps.length === 0) continue;
    for (const cost of planCosts(unit, plan, db)) {
      if (cost.step.kind !== 'rank') {
        for (const item of cost.items) {
          if (item.slots) note(`${unit.name}: a ${cost.step.kind} step carries slot placements`);
        }
        continue;
      }
      for (const item of cost.items) {
        const slots = item.slots ?? [];
        if (slots.length === 0) {
          note(`${unit.name}: ${item.name} on a rank step carries no slot`);
          continue;
        }
        const total = slots.reduce((sum, slot) => sum + slot.amount, 0);
        if (total !== item.amount) {
          note(`${unit.name}: ${item.name} wants ${item.amount} but its slots sum to ${total}`);
        }
        for (const slot of slots) {
          placements += 1;
          const table = db.units[unit.id]?.ranks.find((r) => r.rank === slot.rank);
          const entry = table?.upgrades?.[slot.slotIndex];
          if (entry?.upgradeId !== item.key.replace('upgrade:', '')) {
            note(`${unit.name}: ${item.name} claims ${slot.rank}#${slot.slotIndex}, table says ${entry?.upgradeId}`);
          }
          if (slot.levelToComplete !== levelToCompleteRank(slot.rank)) {
            note(`${unit.name}: ${item.name} carries the wrong level gate for rank ${slot.rank}`);
          }
          // Applied is only ever true at the rank the unit is standing on.
          if (slot.applied && slot.rank !== unit.rank) {
            note(`${unit.name}: ${item.name} marked applied at rank ${slot.rank}, unit is at ${unit.rank}`);
          }
        }
      }
    }
  }
  console.log(`slot placements: ${placements} agree with the rank tables  ✓`);
}

/* ---- flattening resolves recipes without inventing or losing need --------- */
{
  // Two things have to hold: nothing flattened is itself a recipe (that would
  // mean the walk stopped early and the list still needs reading by hand), and
  // no shortfall goes missing (that would understate the farming).
  let flattened = 0;
  let expanded = 0;
  for (const unit of player.units) {
    const plan = resolvePlan(unit, { rank: Math.min(19, unit.rank + 2) }, db);
    if (plan.steps.length === 0) continue;
    const owned = ownedByKey(playerResponse, db);
    for (const step of allocateHoldings(planCosts(unit, plan, db), owned, db)) {
      const needs = flattenNeeds(step.items);
      flattened += needs.length;

      for (const need of needs) {
        if (need.amount <= 0) note(`${unit.name}: flattened ${need.name} to a non-positive amount`);
        const recipe = db.upgrades[need.key.replace('upgrade:', '')]?.crafting;
        if (need.via.length > 0 && recipe && Object.keys(recipe).length > 0) {
          note(`${unit.name}: flattened to ${need.name}, which is itself forged`);
        }
      }

      // Every item with a shortfall is either on the list or represented by
      // the ingredients it was replaced with.
      for (const item of step.items) {
        if (item.applied || item.missing <= 0) continue;
        if (item.components?.length) {
          expanded += 1;
          if (needs.length === 0) note(`${unit.name}: ${item.name} expanded to nothing`);
        } else if (!needs.some((n) => n.key === item.key)) {
          note(`${unit.name}: ${item.name} is missing but absent from the flattened list`);
        }
      }
    }
  }
  console.log(`flattening: ${flattened} base need(s) from ${expanded} recipe(s)  ✓`);
}

/* ---- costing a plan in slots, drops and energy ---------------------------- */
{
  // The three figures answer different questions and must not drift into each
  // other. The one that actually misled before was a count of copies of the
  // *named* requirements, which is smaller than the drops to farm whenever any
  // recipe is involved — so that relation is asserted rather than assumed.
  let costed = 0;
  let recipesSeen = 0;
  for (const unit of player.units) {
    const plan = resolvePlan(unit, { rank: Math.min(19, unit.rank + 2) }, db);
    if (plan.steps.length === 0) continue;
    const owned = ownedByKey(playerResponse, db);
    for (const step of allocateHoldings(planCosts(unit, plan, db), owned, db)) {
      const cost = farmingCost(step.items, db, playerResponse);
      costed += 1;

      // XP is deliberately not a drop; the cost figures exclude it.
      const needs = flattenNeeds(step.items).filter((n) => n.kind !== 'xp');
      if (cost.distinct !== needs.length) {
        note(`${unit.name}: distinct ${cost.distinct} but flattenNeeds gave ${needs.length}`);
      }
      const copies = needs.reduce((n, x) => n + x.amount, 0);
      if (cost.copies !== copies) note(`${unit.name}: copies ${cost.copies} but needs sum to ${copies}`);

      // Slots are the open slots of the step's own requirements, never the
      // applied ones — a filled slot is not work left to do.
      const open = step.items
        .filter((i) => !i.applied)
        .reduce((n, i) => n + (i.slots?.length ?? 0), 0);
      if (cost.slots !== open) note(`${unit.name}: slots ${cost.slots} but ${open} are open`);
      if (step.items.some((i) => i.applied && (i.slots ?? []).length > 0) && step.step.kind === 'rank') {
        // Applied requirements do carry slots; they must simply not be counted.
        if (cost.slots >= step.items.reduce((n, i) => n + (i.slots?.length ?? 0), 0) && open > 0) {
          note(`${unit.name}: applied slots leaked into the count`);
        }
      }

      if (cost.energy < 0 || cost.copies < 0 || cost.unpriced < 0) {
        note(`${unit.name}: negative figure in ${JSON.stringify(cost)}`);
      }
      // Anything priced must have a route; anything unpriced must not.
      for (const need of needs) {
        const each = energyPerCopy(
          { kind: need.kind, key: need.key, ...(need.rarity !== undefined ? { rarity: need.rarity } : {}) },
          db,
          playerResponse,
        );
        if (each !== undefined && !(each > 0)) {
          note(`${unit.name}: ${need.name} priced at ${each}, which is not a cost`);
        }
      }
      if (needs.some((n) => n.via.length > 0)) recipesSeen += 1;
      // A slot's cost and the step's total are shown one above the other, so
      // the rows have to add up to the heading. They only do while the figure
      // stays exact: rounding inside the costing made 19 of these disagree by
      // one, which is small, visible, and corrosive to numbers that are exact
      // everywhere else.
      const perRow = step.items.reduce(
        (n, it) => n + farmingCost([it], db, playerResponse).energy,
        0,
      );
      if (Math.abs(perRow - cost.energy) > 1e-9) {
        note(`${unit.name}: rows cost ${perRow} but the step says ${cost.energy}`);
      }

      // And the exclusion has to be real, not just smaller: no XP may survive.
      if (flattenNeeds(step.items).some((n) => n.kind === 'xp') && cost.copies > 0) {
        const xp = flattenNeeds(step.items)
          .filter((n) => n.kind === 'xp')
          .reduce((n, x) => n + x.amount, 0);
        if (cost.copies >= xp) note(`${unit.name}: ${xp} XP looks counted among ${cost.copies} drops`);
      }

      // Every unpriced copy is a copy, so it can never exceed the total.
      if (cost.unpriced > cost.copies) {
        note(`${unit.name}: ${cost.unpriced} unpriced of only ${cost.copies} copies`);
      }
    }
  }
  console.log(`farming cost: ${costed} step(s) costed, ${recipesSeen} through recipes  ✓`);
}

/* -------------------------------------------------------------------------- */
/* Raids today                                                                */
/* -------------------------------------------------------------------------- */
{
  /*
   * A raid plan is a claim about a day that has a hard edge: a node allows so
   * many runs and no more. So the checks are the two ways that claim can be
   * wrong — spending runs the node does not have, and stopping short of the
   * copies asked for.
   */
  let planned = 0;
  let stocked = 0;
  const items = new Map();
  for (const unit of player.units) {
    const slots = db.units[unit.id]?.ranks.find((r) => r.rank === unit.rank)?.upgrades ?? [];
    const filled = new Set(unit.upgrades);
    slots.forEach((slot, index) => {
      if (filled.has(index)) return;
      const upgrade = db.upgrades[slot.upgradeId];
      items.set(`${unit.id}:${index}`, {
        who: `${unit.name ?? unit.id} slot ${index + 1}`,
        item: {
          kind: 'upgrade',
          key: `upgrade:${slot.upgradeId}`,
          ...(upgrade?.rarity !== undefined ? { rarity: upgrade.rarity } : {}),
        },
        copies: slot.amount,
        name: upgrade?.name ?? slot.upgradeId,
      });
    });
  }

  for (const { who, item, copies, name } of items.values()) {
    const plan = raidsToday(item, copies, db, playerResponse);
    if (plan === undefined) continue;
    planned += 1;
    if (plan.raids === 0) stocked += 1;

    if (plan.raids < 0 || plan.energy < 0 || plan.nodes < 0) {
      note(`raids: ${who} planned ${plan.raids} raids for ${plan.energy} energy`);
    }
    // A directly farmed item is checkable against its own nodes: the runs it
    // asks for must fit in what is left today, and must be expected to cover
    // the copies. A crafted one is its ingredients' problem, checked when they
    // come round in this same loop.
    const source = itemSource(item, db);
    if (source.kind !== 'farm') continue;
    const open = nodeStatuses(source.nodes, playerResponse, db, {
      kind: item.kind,
      ...(item.rarity !== undefined ? { rarity: item.rarity } : {}),
    }).filter((n) => n.unlocked && n.attemptsLeft > 0 && n.dropRate && n.energyCost !== undefined);

    const attempts = open.reduce((n, node) => n + node.attemptsLeft, 0);
    if (plan.raids > attempts) {
      note(`raids: ${who} wants ${plan.raids} runs of ${name}, only ${attempts} left today`);
    }
    const best = open.reduce((n, node) => Math.max(n, node.dropRate), 0);
    // Cheapest-per-copy first, so the runs booked can never beat what the best
    // rate would need — that would mean drops counted twice.
    if (best > 0 && plan.raids < Math.ceil(copies / best) && plan.raids > 0) {
      note(`raids: ${who} books ${plan.raids} runs for ${copies}x ${name}, under the ${best} rate`);
    }
    const reachable = open.reduce((n, node) => n + node.attemptsLeft * node.dropRate, 0);
    if (reachable + 1e-9 < copies) {
      note(`raids: ${who} called reachable, yet today tops out at ${reachable.toFixed(1)} of ${copies}`);
    }
  }

  // The edge itself: with the day spent, nothing that has to be farmed today
  // can be reachable. Anything still reported is being read from a stale
  // attempt count or is not consulting them at all.
  const spent = JSON.parse(JSON.stringify(playerResponse));
  for (const campaign of spent.player.progress.campaigns) {
    for (const battle of campaign.battles) {
      battle.attemptsLeft = 0;
    }
  }
  let survived = 0;
  for (const { item, copies } of items.values()) {
    const plan = raidsToday(item, copies, db, spent);
    // Zero raids is not farming: those are the ones already sitting in stock.
    if (plan !== undefined && plan.raids > 0) survived += 1;
  }
  if (survived > 0) {
    note(`raids: ${survived} slot(s) still farmable with every attempt spent`);
  }
  console.log(
    `raids: ${planned} slot(s) reachable today, ${stocked} needing no raid at all  ✓`,
  );
}

if (problems.length === 0) {
  console.log('\n✓ requirements, allocation and sources are consistent');
  process.exit(0);
}
console.log(`\n✗ ${problems.length} problem(s):`);
for (const p of problems.slice(0, 20)) console.log('  ' + p);
process.exit(1);
