/**
 * Checks the equipment layer: that unit/item compatibility agrees with itself
 * in both directions, that a plan's currency cost matches a level table read
 * by hand, and that ascending only ever happens from an item's own max level.
 *
 * Usage: node test/validate-items.mjs <player.json>
 */

import { readFileSync } from 'node:fs';

import {
  loadGameDatabase,
  compatibleUnits,
  itemFitsUnit,
  itemOptionsForSlot,
  itemsForUnit,
  costOfSpan,
  projectedItemStats,
  resolveItemTarget,
  computeUnitStats,
} from '../dist/gamedata/index.js';

const playerPath = process.argv[2] ?? 'player.json';
const player = JSON.parse(readFileSync(playerPath, 'utf8'));
const db = await loadGameDatabase();

const problems = [];
const note = (m) => problems.push(m);

/* ---- compatibility is reciprocal and respects every restriction ----------
 * Every unit compatibleUnits(item) returns must itself list item among
 * itemsForUnit(unit), and must actually be able to slot it — same category,
 * and named outright when the item names units at all.
 */
{
  let checkedItems = 0;
  let checkedPairs = 0;
  for (const item of Object.values(db.items)) {
    checkedItems += 1;
    const units = compatibleUnits(item, db);
    for (const unit of units) {
      checkedPairs += 1;
      if (!unit.itemSlots.includes(item.itemType)) {
        note(`${item.name} -> ${unit.name}: no slot of category ${item.itemType}`);
      }
      if (item.allowedUnits.length > 0 && !item.allowedUnits.includes(unit.id)) {
        note(`${item.name} names ${item.allowedUnits.join(', ')} but included ${unit.name}`);
      }
      if (
        item.allowedUnits.length === 0 &&
        item.allowedFactions.length > 0 &&
        !item.allowedFactions.includes(unit.factionId ?? '')
      ) {
        note(`${item.name} restricted to ${item.allowedFactions.join(', ')} but included ${unit.name} (${unit.factionId})`);
      }
      if (!itemsForUnit(unit, db).some((i) => i.id === item.id)) {
        note(`${item.name} -> ${unit.name} but itemsForUnit(${unit.name}) omits it`);
      }
      if (!itemFitsUnit(item, unit)) {
        note(`compatibleUnits(${item.name}) included ${unit.name}, but itemFitsUnit disagrees`);
      }
    }
  }
  // A handful of items are known to name a single unit outright (Relics) —
  // confirms allowedUnits is actually read, not merely present unused.
  const relics = Object.values(db.items).filter((i) => i.allowedUnits.length > 0);
  const singleUnit = relics.filter((i) => compatibleUnits(i, db).length === 1);
  if (relics.length > 0 && singleUnit.length === 0) {
    note(`${relics.length} item(s) name specific units, but none resolved to exactly that unit`);
  }
  console.log(
    `compatibility: ${checkedItems} items, ${checkedPairs} (item, unit) pairs, ` +
      `${relics.length} unit-bound  ✓`,
  );
}

/* ---- a slot's options are exactly what that slot, and only that slot, allows */
{
  let checked = 0;
  for (const unit of Object.values(db.units)) {
    unit.itemSlots.forEach((wanted, index) => {
      const slotId = `Slot${index + 1}`;
      const options = itemOptionsForSlot(unit, slotId, db);
      checked += options.length;
      for (const item of options) {
        if (item.itemType !== wanted) {
          note(`${unit.name} ${slotId} (${wanted}) offered ${item.name} (${item.itemType})`);
        }
      }
    });
  }
  console.log(`slot options: ${checked} (unit, slot, item) offers checked  ✓`);
}

/* ---- a level span's cost is exactly the sum of the levels crossed --------- */
{
  let spans = 0;
  for (const item of Object.values(db.items)) {
    if (item.levels.length < 2) continue;
    spans += 1;
    const whole = costOfSpan(item, 0, item.levels.length);
    const byHand = item.levels.reduce(
      (sum, l) => ({
        dust: sum.dust + (l.dustCost ?? 0),
        gold: sum.gold + (l.goldCost ?? 0),
        mythicDust: sum.mythicDust + (l.mythicDustCost ?? 0),
      }),
      { dust: 0, gold: 0, mythicDust: 0 },
    );
    if (whole.dust !== byHand.dust || whole.gold !== byHand.gold || whole.mythicDust !== byHand.mythicDust) {
      note(`${item.name}: costOfSpan(0, max) = ${JSON.stringify(whole)}, hand sum = ${JSON.stringify(byHand)}`);
    }
    // A prefix plus its remaining suffix must equal the whole: the span
    // function cannot be double-counting or dropping a level at the join.
    const mid = Math.floor(item.levels.length / 2);
    const prefix = costOfSpan(item, 0, mid);
    const suffix = costOfSpan(item, mid, item.levels.length);
    const dust = prefix.dust + suffix.dust;
    const gold = prefix.gold + suffix.gold;
    const mythicDust = prefix.mythicDust + suffix.mythicDust;
    if (dust !== whole.dust || gold !== whole.gold || mythicDust !== whole.mythicDust) {
      note(`${item.name}: prefix+suffix does not equal the whole span`);
    }
  }
  console.log(`level spans: ${spans} multi-level items cross-checked against hand sums  ✓`);
}

/* ---- resolveItemTarget against every worn item on the roster -------------
 * For each equipped item, three targets are checked: one more level on the
 * same item (must equal a hand-computed costOfSpan), a level already passed
 * (must report nothing left to do), and — where the item ascends — the next
 * item in series at level 1 (must cross exactly one ascension, priced as the
 * current item finishing out its own levels plus the next item's level 1).
 */
{
  let sameItemChecks = 0;
  let alreadyMetChecks = 0;
  let ascensionChecks = 0;
  let disconnectedChecks = 0;

  for (const unit of player.player.units) {
    for (const worn of unit.items) {
      const def = db.items[worn.id];
      if (!def) continue;

      // One more level of the same item, when there is one to give.
      if (worn.level < def.levels.length) {
        sameItemChecks += 1;
        const target = { slotId: worn.slotId, itemId: worn.id, level: worn.level + 1 };
        const plan = resolveItemTarget(unit, target, db);
        const expected = costOfSpan(def, worn.level, worn.level + 1);
        if (!plan.connected || plan.legs.length !== 1) {
          note(`${unit.id} ${worn.slotId}: +1 level on the same item did not read as connected/one leg`);
        } else if (
          plan.cost.dust !== expected.dust ||
          plan.cost.gold !== expected.gold ||
          plan.cost.mythicDust !== expected.mythicDust
        ) {
          note(
            `${unit.id} ${worn.slotId}: +1 level costed ${JSON.stringify(plan.cost)}, ` +
              `expected ${JSON.stringify(expected)}`,
          );
        }
      }

      // A level already passed must be "nothing to do", not a negative cost.
      if (worn.level > 1) {
        alreadyMetChecks += 1;
        const target = { slotId: worn.slotId, itemId: worn.id, level: worn.level - 1 };
        const plan = resolveItemTarget(unit, target, db);
        if (plan.legs.length !== 0 || plan.cost.dust !== 0 || plan.cost.gold !== 0) {
          note(`${unit.id} ${worn.slotId}: a level already passed still priced something`);
        }
      }

      // Ascending to the next item in series.
      if (def.nextInSeries && db.items[def.nextInSeries]) {
        ascensionChecks += 1;
        const nextDef = db.items[def.nextInSeries];
        const target = { slotId: worn.slotId, itemId: def.nextInSeries, level: 1 };
        const plan = resolveItemTarget(unit, target, db);
        if (!plan.connected) {
          note(`${unit.id} ${worn.slotId}: ${nextDef.name} is nextInSeries but resolveItemTarget called it disconnected`);
        } else {
          const closeOut = costOfSpan(def, worn.level, def.levels.length || 1);
          const first = costOfSpan(nextDef, 0, 1);
          const expectDust = closeOut.dust + first.dust;
          const expectGold = closeOut.gold + first.gold;
          const expectMythic = closeOut.mythicDust + first.mythicDust;
          if (
            plan.cost.dust !== expectDust ||
            plan.cost.gold !== expectGold ||
            plan.cost.mythicDust !== expectMythic
          ) {
            note(
              `${unit.id} ${worn.slotId}: ascension to ${nextDef.name} costed ` +
                `${JSON.stringify(plan.cost)}, expected dust ${expectDust}/gold ${expectGold}/mythic ${expectMythic}`,
            );
          }
          const badgeRarity = nextDef.rarity ?? def.rarity;
          const badges = Object.entries(plan.cost.forgeBadges);
          if (badgeRarity !== undefined && (badges.length !== 1 || Number(badges[0][0]) !== badgeRarity || badges[0][1] !== 1)) {
            note(`${unit.id} ${worn.slotId}: ascension to ${nextDef.name} should cost exactly 1 Forge Badge of rarity ${badgeRarity}`);
          }
        }
      }

      // A target with no relation at all to what is worn must be priced fresh,
      // never claim a connection that does not exist.
      const unrelated = Object.values(db.items).find(
        (i) => i.id !== worn.id && i.itemType === def.itemType && i.id !== def.nextInSeries,
      );
      if (unrelated) {
        disconnectedChecks += 1;
        const target = { slotId: worn.slotId, itemId: unrelated.id, level: 1 };
        const plan = resolveItemTarget(unit, target, db);
        if (plan.connected) {
          note(`${unit.id} ${worn.slotId}: ${unrelated.name} has no relation to ${def.name} but read as connected`);
        }
        const expected = costOfSpan(unrelated, 0, 1);
        if (plan.legs.length !== 1 || plan.cost.dust !== expected.dust) {
          note(`${unit.id} ${worn.slotId}: disconnected target ${unrelated.name} was not costed fresh from level 1`);
        }
      }
    }
  }
  console.log(
    `resolveItemTarget: ${sameItemChecks} same-item, ${alreadyMetChecks} already-met, ` +
      `${ascensionChecks} ascension, ${disconnectedChecks} disconnected cases  ✓`,
  );
}

/* ---- projecting the exact item already worn changes nothing --------------
 * The hypothetical-swap machinery must be a no-op when the "swap" puts back
 * what was already there — otherwise a plan preview could show a false delta
 * for a slot nobody touched.
 */
{
  let checked = 0;
  for (const unit of player.player.units) {
    for (const worn of unit.items) {
      checked += 1;
      const before = computeUnitStats(unit, db);
      const after = projectedItemStats(unit, { slotId: worn.slotId, itemId: worn.id, level: worn.level }, db);
      if (!before || !after) continue;
      if (before.health !== after.health || before.armour !== after.armour) {
        note(`${unit.id} ${worn.slotId}: re-projecting the worn item changed health/armour`);
      }
      for (const key of new Set([...Object.keys(before.itemBonuses), ...Object.keys(after.itemBonuses)])) {
        if ((before.itemBonuses[key] ?? 0) !== (after.itemBonuses[key] ?? 0)) {
          note(`${unit.id} ${worn.slotId}: re-projecting the worn item changed itemBonuses.${key}`);
        }
      }
    }
  }
  console.log(`projectedItemStats: ${checked} worn items re-projected as a no-op  ✓`);
}

if (problems.length === 0) {
  console.log('\n✓ equipment compatibility and item-plan costs are consistent');
  process.exit(0);
}
console.log(`\n✗ ${problems.length} problem(s):`);
for (const p of problems.slice(0, 20)) console.log('  ' + p);
process.exit(1);
