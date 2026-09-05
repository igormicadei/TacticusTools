/**
 * Checks the cross-plan running order and the energy picker: that the order
 * respects the rules it claims, that stock is spread across plans rather than
 * claimed twice, and that what the energy budget buys is actually buyable.
 *
 * Usage: node test/validate-timeline.mjs <player.json>
 */

import { readFileSync } from 'node:fs';

import {
  loadGameDatabase,
  resolvePlan,
  markProgress,
  currentState,
  ownedByKey,
  buildTimeline,
  energyCandidates,
  planEnergy,
} from '../dist/gamedata/index.js';

const playerPath = process.argv[2] ?? 'player.json';
const playerResponse = JSON.parse(readFileSync(playerPath, 'utf8'));
const player = playerResponse.player;
const db = await loadGameDatabase();

const problems = [];
const note = (m) => problems.push(m);

/* ---- a roster-wide set of plans, which is where the rules bite ------------- */
const plans = player.units
  .filter((u) => u.rank > 0 && u.rank < 16)
  .map((unit) => ({
    id: unit.id,
    unit,
    plan: markProgress(
      resolvePlan(unit, { rank: Math.min(unit.rank + 2, 19) }, db),
      currentState(unit, db),
    ),
  }));

const timeline = buildTimeline(plans, playerResponse, db);
console.log(`timeline: ${timeline.bundles.length} bundles across ${plans.length} plans`);

/* ---- the stated ordering --------------------------------------------------
 * Rank first, so the roster comes up together; effort second, so the cheapest
 * way to a rank is taken first.
 */
for (let i = 1; i < timeline.bundles.length; i += 1) {
  const previous = timeline.bundles[i - 1];
  const current = timeline.bundles[i];
  if (current.sortRank < previous.sortRank) {
    note(`ordering: ${current.unitName} (rank ${current.sortRank}) after rank ${previous.sortRank}`);
  }
  if (current.sortRank === previous.sortRank && current.effort < previous.effort) {
    note(
      `ordering: within rank ${current.sortRank}, ${current.unitName} (${current.effort}) after ` +
        `${previous.unitName} (${previous.effort})`,
    );
  }
}
console.log('ordering: rank tier, then effort  ✓');

/* ---- a plan's own steps keep their order --------------------------------- */
{
  const seen = new Map();
  for (const [index, bundle] of timeline.bundles.entries()) {
    const last = seen.get(bundle.planId);
    if (last !== undefined && bundle.sortRank < last.rank) {
      note(`${bundle.unitName}: bundle for rank ${bundle.sortRank} placed after rank ${last.rank}`);
    }
    seen.set(bundle.planId, { rank: bundle.sortRank, index });
  }
  console.log('dependencies: each plan advances in its own order  ✓');
}

/* ---- one pool, spread across the order -----------------------------------
 * The whole point of the timeline: scored plan by plan, two units wanting the
 * same material both claim it. Across the timeline the total covered may never
 * exceed what the player actually holds.
 */
{
  const owned = ownedByKey(playerResponse, db);
  const claimed = new Map();
  const tally = (item) => {
    if (!item.applied) claimed.set(item.key, (claimed.get(item.key) ?? 0) + item.covered);
    for (const component of item.components ?? []) tally(component);
  };
  for (const bundle of timeline.bundles) for (const item of bundle.items) tally(item);

  let contested = 0;
  for (const [key, total] of claimed) {
    const have = owned.get(key) ?? 0;
    if (total > have) note(`allocation: ${total} of ${key} claimed, ${have} held`);
    if (total > 0 && have > 0) contested += 1;
  }
  console.log(`allocation: ${claimed.size} items drawn from one pool, none over-claimed  ✓`);
}

/* ---- the cards agree with the timeline ------------------------------------ */
{
  const summed = new Map();
  for (const bundle of timeline.bundles) {
    const entry = summed.get(bundle.planId) ?? { missing: 0, unreachable: 0, bundles: 0 };
    entry.missing += bundle.missing;
    entry.unreachable += bundle.unreachable;
    entry.bundles += 1;
    summed.set(bundle.planId, entry);
  }
  for (const [id, entry] of summed) {
    const card = timeline.byPlan.get(id);
    if (card?.missing !== entry.missing) {
      note(`card ${id}: ${card?.missing} missing, bundles sum to ${entry.missing}`);
    }
    if (card?.unreachable !== entry.unreachable) {
      note(`card ${id}: ${card?.unreachable} unreachable, bundles sum to ${entry.unreachable}`);
    }
  }
  console.log('cards: every summary matches the bundles behind it  ✓');
}

/* ---- energy ---------------------------------------------------------------
 * Candidates are the slots a unit can fill *now*, priced whole, and the picker
 * takes them greedily by stat per energy.
 */
{
  const units = player.units.filter((u) => u.rank > 0);
  const candidates = energyCandidates(units, playerResponse, db);

  for (const c of candidates) {
    const unit = units.find((u) => u.id === c.unitId);
    const slots = db.units[c.unitId]?.ranks.find((r) => r.rank === unit.rank)?.upgrades ?? [];
    if (!slots.some((s) => `upgrade:${s.upgradeId}` === c.itemKey)) {
      note(`energy: ${c.unitName} offered ${c.itemName}, not a slot at its current rank`);
    }
    // The position is what the screen tells the player to go and fill, so it
    // has to be the position of *this* material, not merely a plausible one.
    const at = slots[c.slotIndex];
    if (!at || `upgrade:${at.upgradeId}` !== c.itemKey) {
      note(`energy: ${c.unitName} put ${c.itemName} at slot ${c.slotIndex + 1}, which holds ${at?.upgradeId ?? 'nothing'}`);
    }
    if (c.rank !== unit.rank) note(`energy: ${c.unitName} priced at rank ${c.rank}, but stands at ${unit.rank}`);
    if (at && c.statType !== (at.statType ?? '')) {
      note(`energy: ${c.unitName} slot ${c.slotIndex + 1} claims ${c.statType}, the slot gives ${at.statType}`);
    }
    if (!(c.energy > 0) || !(c.gain > 0)) note(`energy: ${c.itemName} priced ${c.energy} for ${c.gain}`);
    if (Math.abs(c.energy - c.copies * c.energyPerCopy) > 1e-6) {
      note(`energy: ${c.itemName} total disagrees with copies x per-copy`);
    }
  }
  for (let i = 1; i < candidates.length; i += 1) {
    if (candidates[i].ratio > candidates[i - 1].ratio + 1e-9) {
      note('energy: candidates are not ordered by stat per energy');
    }
  }

  for (const budget of [0, 30, 60, 200, 10000]) {
    const { picks, rest, energyUsed, gain } = planEnergy(candidates, budget);
    if (energyUsed > budget) note(`energy: ${energyUsed} spent of a ${budget} budget`);
    if (picks.reduce((n, c) => n + c.gain, 0) !== gain) note(`energy: gain total disagrees at ${budget}`);
    // Greedy must never skip something affordable for something worse.
    const cut = picks.length > 0 ? picks[picks.length - 1].ratio : Infinity;
    for (const skipped of rest) {
      if (skipped.ratio > cut && skipped.energy + energyUsed <= budget) {
        note(`energy: ${skipped.itemName} beats the cut at ${budget} and fits, yet was skipped`);
      }
    }
  }

  const sixty = planEnergy(candidates, 60);
  console.log(
    `energy: ${candidates.length} slots priced; 60 buys ${sixty.picks.length} for +${sixty.gain}  ✓`,
  );
}

if (problems.length === 0) {
  console.log('\n✓ the timeline orders, allocates and prices consistently');
  process.exit(0);
}
console.log(`\n✗ ${problems.length} problem(s):`);
for (const p of problems.slice(0, 20)) console.log('  ' + p);
process.exit(1);
