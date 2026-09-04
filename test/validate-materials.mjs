/**
 * Checks the material-to-use index: that inverting the rank tables loses
 * nothing, that recipe chains multiply correctly, and that the badge catalogue
 * charges what the planner charges.
 *
 * Usage: node test/validate-materials.mjs <player.json>
 */

import { readFileSync } from 'node:fs';

import {
  loadGameDatabase,
  indexMaterialUses,
  materialCatalogue,
  nextRankCost,
  nextRankCosts,
  badgeCatalogue,
  planCosts,
  itemSource,
  rankName,
  rarityName,
} from '../dist/gamedata/index.js';

const playerPath = process.argv[2] ?? 'player.json';
const player = JSON.parse(readFileSync(playerPath, 'utf8'));
const db = await loadGameDatabase();

const problems = [];
const note = (m) => problems.push(m);

/* ---- the inversion is complete -------------------------------------------
 * Every (unit, rank, material) the forward tables hold must come back out of
 * the index. This is the property that matters: a missing use is a material the
 * player is told they cannot spend when they can.
 */
{
  const index = indexMaterialUses(db);
  let direct = 0;
  for (const definition of Object.values(db.units)) {
    for (const rankStats of definition.ranks) {
      const pooled = new Map();
      for (const slot of rankStats.upgrades ?? []) {
        pooled.set(slot.upgradeId, (pooled.get(slot.upgradeId) ?? 0) + slot.amount);
      }
      for (const [id, amount] of pooled) {
        direct += 1;
        const uses = (index.get(id) ?? []).filter(
          (u) => u.unitId === definition.id && u.rank === rankStats.rank && u.chain.length === 0,
        );
        const total = uses.reduce((sum, u) => sum + u.amount, 0);
        if (total !== amount) {
          note(
            `${definition.name} ${rankName(rankStats.rank)} needs ${amount}x ${id}, ` +
              `index says ${total}`,
          );
        }
      }
    }
  }
  const totalUses = [...index.values()].reduce((n, list) => n + list.length, 0);
  console.log(
    `inversion: ${direct} direct (unit, rank, material) rows all present; ` +
      `${index.size} materials, ${totalUses} uses  ✓`,
  );
}

/* ---- chains multiply, and every link is real ----------------------------- */
{
  const index = indexMaterialUses(db);
  let chained = 0;
  let deepest = 0;
  for (const [id, uses] of index) {
    for (const use of uses) {
      if (use.chain.length === 0) continue;
      chained += 1;
      deepest = Math.max(deepest, use.chain.length);

      // Each link must actually be forged from the next, and the last from the
      // material itself. A chain that does not hold is a lie about where the
      // material goes, which is the one thing this page must not do.
      const path = [...use.chain.map((l) => l.id), id];
      for (let i = 0; i < path.length - 1; i += 1) {
        const source = itemSource({ kind: 'upgrade', key: `upgrade:${path[i]}` }, db);
        if (source.kind !== 'craft' || !source.recipe.some((c) => c.id === path[i + 1])) {
          note(`chain ${path.join(' -> ')} breaks at ${path[i]} -> ${path[i + 1]}`);
          break;
        }
      }
      if (use.amount <= 0) note(`${id}: chained use has amount ${use.amount}`);
    }
  }
  console.log(`chains: ${chained} chained uses, deepest ${deepest} links, all verified  ✓`);
}

/* ---- one worked example, multiplied by hand ------------------------------
 * Picks a real two-level recipe out of the data rather than hard-coding one, so
 * it survives a game update, and checks the arithmetic the long way.
 */
{
  let checked = 0;
  for (const definition of Object.values(db.units)) {
    for (const rankStats of definition.ranks) {
      for (const slot of rankStats.upgrades ?? []) {
        const top = itemSource({ kind: 'upgrade', key: `upgrade:${slot.upgradeId}` }, db);
        if (top.kind !== 'craft') continue;
        for (const mid of top.recipe) {
          const inner = itemSource({ kind: 'upgrade', key: `upgrade:${mid.id}` }, db);
          if (inner.kind !== 'craft') continue;
          const leaf = inner.recipe[0];
          const expected = slot.amount * mid.amount * leaf.amount;
          const index = indexMaterialUses(db);
          const use = (index.get(leaf.id) ?? []).find(
            (u) =>
              u.unitId === definition.id &&
              u.rank === rankStats.rank &&
              u.chain.length === 2 &&
              u.chain[0].id === slot.upgradeId &&
              u.chain[1].id === mid.id,
          );
          if (!use) {
            note(`worked example: no two-link use of ${leaf.id} under ${slot.upgradeId}`);
          } else if (use.amount !== expected) {
            note(`worked example: ${leaf.id} should be ${expected}, index says ${use.amount}`);
          } else {
            console.log(
              `worked example: ${definition.name} ${rankName(rankStats.rank)} needs ` +
                `${slot.amount}x ${db.upgrades[slot.upgradeId]?.name}, each ${mid.amount}x ` +
                `${mid.name}, each ${leaf.amount}x ${leaf.name} = ${expected}  ✓`,
            );
          }
          checked = 1;
          break;
        }
        if (checked) break;
      }
      if (checked) break;
    }
    if (checked) break;
  }
  if (!checked) note('worked example: no two-level recipe found in any rank slot');
}

/* ---- next-rank cost agrees with the planner ------------------------------
 * The planner already prices a rank-up and is covered by its own tests, so the
 * new path is checked against it rather than against a second hand-rolled sum.
 */
{
  let compared = 0;
  for (const unit of player.player.units) {
    const next = nextRankCost(unit, player, db);
    if (!next) continue;
    compared += 1;

    const step = {
      order: 1,
      kind: 'rank',
      label: `Rank up`,
      from: unit.rank,
      to: unit.rank + 1,
    };
    const [cost] = planCosts(unit, { steps: [step] }, db);
    const planned = new Map();
    for (const item of cost.items) {
      if (item.kind !== 'upgrade') continue;
      const id = item.key.slice('upgrade:'.length);
      const entry = planned.get(id) ?? { amount: 0, applied: 0 };
      entry.amount += item.amount;
      if (item.applied) entry.applied += item.amount;
      planned.set(id, entry);
    }

    for (const material of next.materials) {
      const p = planned.get(material.id);
      if (!p) {
        note(`${unit.name}: ${material.id} in next-rank cost but not in the plan`);
        continue;
      }
      if (p.amount !== material.amount || p.applied !== material.applied) {
        note(
          `${unit.name}: ${material.id} next-rank ${material.amount}/${material.applied} applied, ` +
            `plan ${p.amount}/${p.applied}`,
        );
      }
    }
    if (planned.size !== next.materials.length) {
      note(`${unit.name}: plan has ${planned.size} materials, next-rank has ${next.materials.length}`);
    }

    // Components are the shortfall's recipe, so a material fully in hand must
    // not drag a forging tree along behind it.
    for (const material of next.materials) {
      const short = Math.max(0, material.amount - material.applied - material.owned);
      if (short === 0 && material.components.length > 0) {
        note(`${unit.name}: ${material.id} is covered but still lists components`);
      }
    }
  }
  console.log(`next rank: ${compared} units priced, all agreeing with the planner  ✓`);
}

/* ---- badges charge what the planner charges ------------------------------ */
{
  const badges = badgeCatalogue(player, db);
  if (badges.length === 0) note('badges: none held, nothing checked');

  for (const badge of badges) {
    for (const use of badge.uses) {
      if (use.next === undefined) continue;
      const unit = player.player.units.find((u) => u.id === use.unitId);
      const step = {
        order: 1,
        kind: 'ability',
        label: 'Level ability',
        from: use.level,
        to: use.level + 1,
        ability: use.slot === 'active' ? 'active' : 'passive',
      };
      const [cost] = planCosts(unit, { steps: [step] }, db);
      const item = cost.items.find((i) => i.key === badge.key);
      if (!item) {
        note(`${use.unitName} ${use.abilityName}: catalogue charges ${badge.key}, plan does not`);
      } else if (item.amount !== use.next) {
        note(
          `${use.unitName} ${use.abilityName} ${use.level}->${use.level + 1}: ` +
            `catalogue says ${use.next}, plan says ${item.amount}`,
        );
      }
    }

    // Totals must be the sum of the parts they claim to add up.
    const nextTotal = badge.uses.reduce((sum, u) => sum + (u.next ?? 0), 0);
    const grand = badge.uses.reduce((sum, u) => sum + u.total, 0);
    if (nextTotal !== badge.nextTotal) {
      note(`${badge.key}: nextTotal ${badge.nextTotal}, parts sum to ${nextTotal}`);
    }
    if (grand !== badge.grandTotal) {
      note(`${badge.key}: grandTotal ${badge.grandTotal}, parts sum to ${grand}`);
    }
    for (const use of badge.uses) {
      const stepped = use.steps.reduce((sum, s) => sum + s.badges, 0);
      if (stepped !== use.total) {
        note(`${badge.key} ${use.abilityName}: total ${use.total}, steps sum to ${stepped}`);
      }
      // Every level a badge covers must sit above the ability's current one.
      if (use.steps.some((s) => s.from < use.level)) {
        note(`${badge.key} ${use.abilityName}: charges a level already reached`);
      }
    }
  }
  console.log(
    `badges: ${badges.length} held ` +
      `(${badges.map((b) => `${rarityName(b.rarity)} ${b.alliance} x${b.owned}`).join(', ')})  ✓`,
  );
}

/* ---- the catalogue covers the inventory ---------------------------------- */
{
  const catalogue = materialCatalogue(player, db);
  const byId = new Map(catalogue.map((m) => [m.id, m]));
  if (catalogue.length !== Object.keys(db.upgrades).length) {
    note(`catalogue: ${catalogue.length} rows for ${Object.keys(db.upgrades).length} materials`);
  }
  let unknown = 0;
  for (const item of player.player.inventory.upgrades) {
    const row = byId.get(item.id);
    if (!row) {
      unknown += 1;
      continue;
    }
    if (row.owned < item.amount) {
      note(`catalogue: holds ${item.amount}x ${item.id}, catalogue says ${row.owned}`);
    }
  }
  const useless = catalogue.filter((m) => m.uses.length === 0);
  const held = catalogue.filter((m) => m.owned > 0);
  console.log(
    `catalogue: ${catalogue.length} materials, ${held.length} in stock, ` +
      `${useless.length} spent by nothing` +
      (unknown > 0 ? `, ${unknown} inventory id(s) not in the database` : '') +
      '  ✓',
  );

  const ranked = nextRankCosts(player, db);
  console.log(
    `next ranks: ${ranked.length} units, ${ranked.filter((r) => r.missing === 0).length} ready now  ✓`,
  );
}

if (problems.length === 0) {
  console.log('\n✓ materials and badges invert the tables faithfully');
  process.exit(0);
}
console.log(`\n✗ ${problems.length} problem(s):`);
for (const p of problems.slice(0, 20)) console.log('  ' + p);
process.exit(1);
