/**
 * Checks the team-building library: that the derived rank cap agrees with a
 * real roster, that a rarity cap only ever scales down, that capped equipment
 * lands on the levels the wiki publishes, that filters and sorts agree with
 * the stats they claim to order by, and that the optimisers propose only
 * layouts the game would allow.
 *
 * Usage: node test/validate-teams.mjs <player.json>
 */

import { readFileSync } from 'node:fs';

import {
  loadGameDatabase,
  RarityCeiling,
  RosterUnit,
  RosterQuery,
  EquipmentPool,
  ItemOptimiser,
  BattleBrief,
  TeamOptimiser,
  Team,
  buildRosterUnits,
  computeUnitStats,
  rankName,
  rarityName,
  Rarity,
  score,
  campaignAlliances,
  campaignFamily,
  GRAND_ALLIANCE_NAMES,
} from '../dist/gamedata/index.js';

const player = JSON.parse(readFileSync(process.argv[2] ?? 'player.json', 'utf8'));
const db = await loadGameDatabase();

const problems = [];
const note = (m) => problems.push(m);

const RARITIES = [0, 1, 2, 3, 4, 5];
const OBJECTIVES = ['health', 'armour', 'damage', 'effective', 'offence', 'defence'];

/* ---- the derived rank cap ------------------------------------------------
 * No source publishes a rank-per-rarity table, so the library derives one from
 * the XP-level cap and the level gates on each rank. The check that matters is
 * that a real roster never exceeds it — a cap that cut a unit the game allows
 * would silently understate it everywhere.
 */
{
  const caps = RARITIES.map((r) => new RarityCeiling(r, db));
  console.log('rank caps derived from the level gates:');
  for (const cap of caps) {
    console.log(
      `  ${cap.name.padEnd(10)} level <= ${String(cap.levelCap).padStart(2)} ` +
        `=> rank <= ${rankName(cap.rankCap)}, stars <= index ${cap.progressionCap}`,
    );
  }

  const byIndex = new Map(db.progressionRequirements.map((r) => [r.progressionIndex, r]));
  let checked = 0;
  for (const unit of player.player.units) {
    const rarity = byIndex.get(unit.progressionIndex)?.rarity;
    if (rarity === undefined) continue;
    checked += 1;
    const cap = caps[rarity];
    if (unit.rank > cap.rankCap) {
      note(`${unit.name}: ${rarityName(rarity)} at ${rankName(unit.rank)}, above the ${rankName(cap.rankCap)} cap`);
    }
    if (unit.xpLevel > cap.levelCap) {
      note(`${unit.name}: ${rarityName(rarity)} at level ${unit.xpLevel}, above the ${cap.levelCap} cap`);
    }
  }
  console.log(`  ${checked} owned units all sit within their rarity's derived cap  ✓`);
}

/* ---- a cap only ever scales down ----------------------------------------
 * The wiki's rule, from Survival: "unit stats only scale down, not up". Every
 * unit under every cap, against its uncapped self.
 */
{
  let capped = 0;
  let untouched = 0;
  for (const unit of player.player.units) {
    const base = computeUnitStats(unit, db);
    if (!base) continue;
    for (const rarity of RARITIES) {
      const ceiling = new RarityCeiling(rarity, db);
      const after = ceiling.apply(unit);
      const stats = computeUnitStats(after, db);
      if (!stats) {
        note(`${unit.name}: no stats at ${rarityName(rarity)} cap (rank ${rankName(after.rank)})`);
        continue;
      }
      if (after === unit) {
        untouched += 1;
        continue;
      }
      capped += 1;

      for (const key of ['health', 'damage', 'armour']) {
        if (stats[key] > base[key]) {
          note(
            `${unit.name} at ${rarityName(rarity)} cap: ${key} rose ${base[key]} -> ${stats[key]}`,
          );
        }
      }
      if (after.rank > unit.rank) note(`${unit.name}: cap raised rank`);
      if (after.xpLevel > unit.xpLevel) note(`${unit.name}: cap raised level`);
      if (after.progressionIndex > unit.progressionIndex) note(`${unit.name}: cap raised stars`);
      if ((stats.rarity ?? 0) > rarity) {
        note(`${unit.name}: capped to ${rarityName(rarity)} but reads ${rarityName(stats.rarity)}`);
      }
      for (const ability of after.abilities) {
        if (ability.level > after.xpLevel) {
          note(`${unit.name}: ability level ${ability.level} above capped XP level ${after.xpLevel}`);
        }
      }
    }
  }
  console.log(`caps: ${capped} unit-and-cap pairs scaled down, ${untouched} left alone  ✓`);
}

/* ---- a cap above a unit's own rarity changes nothing ---------------------- */
{
  let checked = 0;
  for (const unit of player.player.units) {
    const rarity = computeUnitStats(unit, db)?.rarity;
    if (rarity === undefined || rarity >= 5) continue;
    for (let above = rarity + 1; above <= 5; above += 1) {
      checked += 1;
      if (new RarityCeiling(above, db).apply(unit) !== unit) {
        note(`${unit.name} (${rarityName(rarity)}) was changed by a ${rarityName(above)} cap`);
      }
    }
  }
  console.log(`caps: ${checked} caps above a unit's own rarity left it untouched  ✓`);
}

/* ---- capped equipment lands on the published ceilings --------------------
 * The wiki: capped to Common an item acts as Common level 3, Uncommon 5, Rare
 * 7, Epic 9, Legendary 11. Those are exactly the level counts of each series
 * member, so walking `nextInSeries` down must land on a member whose top level
 * matches.
 */
{
  const EXPECTED_LEVELS = { 0: 3, 1: 5, 2: 7, 3: 9, 4: 11 };
  let walked = 0;
  let stranded = 0;
  for (const unit of player.player.units) {
    for (const rarity of [0, 1, 2, 3, 4]) {
      const capped = new RarityCeiling(rarity, db).apply(unit);
      for (const item of capped.items) {
        const spec = db.items[item.id];
        if (!spec) continue;
        if ((spec.rarity ?? 0) > rarity) {
          // The chain ran out before reaching the cap; the item stays where it
          // is, which the library documents as the honest fallback.
          stranded += 1;
          continue;
        }
        walked += 1;
        if (item.level > spec.levels.length) {
          note(`${item.id} capped to level ${item.level}, only ${spec.levels.length} published`);
        }
        const original = unit.items.find((i) => i.slotId === item.slotId);
        if (original && original.id !== item.id) {
          const ceiling = EXPECTED_LEVELS[spec.rarity ?? 0];
          if (ceiling !== undefined && item.level !== ceiling) {
            note(
              `${original.id} capped to ${rarityName(rarity)} became ${item.id} level ` +
                `${item.level}, the wiki says ${ceiling}`,
            );
          }
        }
      }
    }
  }
  console.log(
    `equipment: ${walked} capped items land at or below their series ceiling` +
      (stranded > 0 ? `, ${stranded} with no lower counterpart in the data` : '') +
      '  ✓',
  );
}

/* ---- filters and sorts say what they order by ---------------------------- */
{
  const roster = buildRosterUnits(player, db);
  const all = new RosterQuery().run(roster);
  if (all.length !== roster.length) note(`empty filter dropped ${roster.length - all.length} units`);

  for (const key of [
    'health',
    'damage',
    'armour',
    'effective',
    'effectiveNormal',
    'effectiveAbility',
    'rank',
  ]) {
    const sorted = new RosterQuery({}, key, true).run(roster);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i - 1].value(key) < sorted[i].value(key)) {
        note(`sort by ${key} is not descending at position ${i}`);
        break;
      }
    }
  }

  // Every filter, checked by re-deriving the predicate independently.
  const faction = roster[0].factionId;
  const byFaction = new RosterQuery({ factions: [faction] }).run(roster);
  if (byFaction.some((u) => u.factionId !== faction)) note('faction filter let another faction through');
  if (byFaction.length !== roster.filter((u) => u.factionId === faction).length) {
    note('faction filter dropped a unit of that faction');
  }

  const byRank = new RosterQuery({ minRank: 6 }).run(roster);
  if (byRank.some((u) => u.effective.rank < 6)) note('minRank let a lower rank through');

  const someTrait = roster.flatMap((u) => u.traits)[0];
  if (someTrait) {
    const byTrait = new RosterQuery({ traits: [someTrait] }).run(roster);
    if (byTrait.some((u) => !u.traits.includes(someTrait))) note('trait filter let a unit through');
  }

  const someType = roster.flatMap((u) => u.damageTypes)[0];
  const byType = new RosterQuery({ damageTypes: [someType] }).run(roster);
  if (byType.some((u) => !u.damageTypes.includes(someType))) {
    note('damage-type filter let a unit through');
  }

  // The capped roster must sort into the same set, not a different one.
  const cappedRoster = buildRosterUnits(player, db, new RarityCeiling(Rarity.Rare, db));
  if (cappedRoster.length !== roster.length) note('capping changed the roster size');
  const heavier = cappedRoster.filter((u, i) => (u.stats?.health ?? 0) > (roster[i].stats?.health ?? 0));
  if (heavier.length > 0) note(`${heavier.length} units got healthier under a Rare cap`);

  // The split has to be exhaustive: every attack is a weapon or an ability, so
  // the best of the two halves must equal the best overall, and neither half
  // may claim an attack belonging to the other.
  let withAbility = 0;
  for (const unit of roster) {
    const best = Math.max(unit.normalEffectiveDamage, unit.abilityEffectiveDamage);
    if (Math.abs(best - unit.effectiveDamage) > 1e-9) {
      note(`${unit.name}: normal/ability split does not reconstruct effectiveDamage`);
    }
    if (unit.normalAttacks.length + unit.abilityAttacks.length !== unit.attacks.length) {
      note(`${unit.name}: an attack is in neither half of the split`);
    }
    if (unit.normalAttacks.some((a) => a.source === 'ability')) {
      note(`${unit.name}: an ability leaked into the normal attacks`);
    }
    if (unit.abilityAttacks.some((a) => a.source !== 'ability')) {
      note(`${unit.name}: a weapon leaked into the ability attacks`);
    }
    if (unit.abilityEffectiveDamage > 0) withAbility += 1;
  }
  console.log(
    `split: ${roster.length} units reconstruct from normal + ability, ` +
      `${withAbility} land damage through armour with an ability  ✓`,
  );

  console.log(
    `roster: ${roster.length} units, ${new Set(roster.map((u) => u.factionId)).size} factions, ` +
      `${new Set(roster.flatMap((u) => u.damageTypes)).size} damage types, ` +
      `${new Set(roster.flatMap((u) => u.traits)).size} traits  ✓`,
  );
}

/* ---- the item optimiser proposes only legal layouts ---------------------- */
{
  const roster = buildRosterUnits(player, db);
  const team = new Team('probe', 'Probe', roster.slice(0, 5).map((u) => u.id));
  const members = team.members(roster);

  for (const scope of ['team', 'team+inventory', 'all']) {
    const pool = EquipmentPool.from(player, db, scope, team.memberIds);
    const assignments = OBJECTIVES.flatMap((objective) =>
      new ItemOptimiser(pool, db, objective).optimise(members).map((a) => ({ ...a, objective })),
    );

    // Within one objective: no slot twice, no copy beyond what the pool holds.
    const slots = new Set();
    const used = new Map();
    for (const a of assignments) {
      const slotKey = `${a.objective}:${a.unitId}:${a.slotId}`;
      if (slots.has(slotKey)) note(`${scope}: ${slotKey} assigned twice`);
      slots.add(slotKey);
      const itemKey = `${a.objective}:${a.item.id}@${a.item.level}`;
      used.set(itemKey, (used.get(itemKey) ?? 0) + 1);
      if (a.gain <= 0) note(`${scope}: proposed a swap with no gain (${a.gain})`);

      // The unit must actually be allowed to wear it.
      const unit = members.find((m) => m.id === a.unitId);
      const spec = db.items[a.item.id];
      const slotIndex = Number(a.slotId.replace(/\D+/g, '')) - 1;
      const wanted = unit.definition?.itemSlots[slotIndex];
      if (wanted && spec.itemType !== wanted) {
        note(`${scope}: ${a.item.name} (${spec.itemType}) offered for a ${wanted} slot`);
      }
      if ((spec.rarity ?? 0) > (unit.stats?.rarity ?? 0)) {
        note(`${scope}: ${rarityName(spec.rarity)} item offered to a ${rarityName(unit.stats?.rarity)} unit`);
      }
      if (spec.allowedFactions.length > 0 && !spec.allowedFactions.includes(unit.factionId)) {
        note(`${scope}: ${a.item.name} offered to ${unit.factionId}, which cannot equip it`);
      }
      // Only Rare and above may wear a Booster.
      if (spec.itemType.startsWith('I_Booster') && (unit.stats?.rarity ?? 0) < Rarity.Rare) {
        note(`${scope}: booster offered to a ${rarityName(unit.stats?.rarity)} unit`);
      }
    }
    /*
     * The plan has to be worth what it says it is.
     *
     * This is the check the optimiser used to fail. It would take a copy off a
     * squad member to put it on another, count only what the receiver gained,
     * and never take the item off the donor at all — so it advertised +414 on
     * a swap that left the squad barely better and one unit's slot bare. Here
     * the plan is replayed onto the squad and the real total is compared with
     * the total it claims.
     */
    for (const objective of OBJECTIVES) {
      const plan = new ItemOptimiser(pool, db, objective).optimise(members);
      if (plan.length === 0) continue;
      const before = members.reduce((n, u) => n + score(u, objective), 0);
      const worn = new Map(members.map((u) => [u.id, [...u.effective.items]]));

      for (const move of plan) {
        if (move.takenFrom) {
          const donor = worn.get(move.takenFrom.unitId);
          if (!donor) {
            note(`${scope}/${objective}: takes from ${move.takenFrom.unitId}, who is not in the squad`);
            continue;
          }
          const had = donor.find((i) => i.slotId === move.takenFrom.slotId);
          if (!had || had.id !== move.item.id || had.level !== move.item.level) {
            note(
              `${scope}/${objective}: says ${move.item.name} lv${move.item.level} comes off ` +
                `${move.takenFrom.unitId} ${move.takenFrom.slotId}, which holds ` +
                `${had ? `${had.id} lv${had.level}` : 'nothing'}`,
            );
          }
          worn.set(move.takenFrom.unitId, donor.filter((i) => i.slotId !== move.takenFrom.slotId));
        }
        const mine = worn.get(move.unitId) ?? [];
        const current = mine.find((i) => i.slotId === move.slotId);
        const claimed = move.replaces;
        if (Boolean(current) !== Boolean(claimed)) {
          note(`${scope}/${objective}: ${move.unitId} ${move.slotId} replaces disagrees with the layout`);
        }
        worn.set(move.unitId, [
          ...mine.filter((i) => i.slotId !== move.slotId),
          { slotId: move.slotId, id: move.item.id, level: move.item.level },
        ]);
      }

      const after = members.reduce(
        (n, u) => n + score(new RosterUnit({ ...u.effective, items: worn.get(u.id) }, db), objective),
        0,
      );
      const claimed = plan.reduce((n, m) => n + m.gain, 0);
      if (Math.abs(after - before - claimed) > 0.5) {
        note(
          `${scope}/${objective}: plan claims ${claimed.toFixed(1)} but the squad moves ` +
            `${(after - before).toFixed(1)}`,
        );
      }

      // And the finished layout has to be one the player could actually wear.
      const held = new Map();
      for (const entry of pool.all) {
        const key = `${entry.id}@${entry.level}`;
        held.set(key, (held.get(key) ?? 0) + entry.count);
      }
      const inUse = new Map();
      for (const [unitId, items] of worn) {
        const seen = new Set();
        for (const item of items) {
          if (seen.has(item.slotId)) note(`${scope}/${objective}: ${unitId} wears two things in ${item.slotId}`);
          seen.add(item.slotId);
          const key = `${item.id}@${item.level}`;
          inUse.set(key, (inUse.get(key) ?? 0) + 1);
        }
      }
      for (const [key, count] of inUse) {
        if (count > (held.get(key) ?? 0)) {
          note(`${scope}/${objective}: layout wears ${count} of ${key}, the pool holds ${held.get(key) ?? 0}`);
        }
      }
    }

    console.log(
      `optimiser (${scope}): pool of ${pool.size}, ${assignments.length} swap(s) across ` +
        `${OBJECTIVES.length} objectives, all legal, none double-spent, ` +
        `each plan worth what it claims  ✓`,
    );
  }
}

/* ---- battle briefs and squad picks --------------------------------------- */
{
  const briefs = BattleBrief.all(db);
  const withEnemies = briefs.filter((b) => b.enemyCount > 0);
  if (withEnemies.length === 0) {
    console.log('battles: SKIP — this snapshot carries no enemy rosters');
  } else {
    const roster = buildRosterUnits(player, db);
    let picked = 0;
    for (const brief of withEnemies.slice(0, 50)) {
      const squad = new TeamOptimiser(brief).recommend(roster);
      for (const pick of squad) {
        const split = Math.max(
          brief.normalDamageAgainst(pick.unit),
          brief.abilityDamageAgainst(pick.unit),
        );
        if (Math.abs(split - brief.damageAgainst(pick.unit)) > 1e-9) {
          note(`${pick.unit.name}: node damage split does not reconstruct the whole`);
        }
      }
      if (squad.length > brief.slots) note(`${brief.campaignName}: picked ${squad.length} for ${brief.slots} slots`);
      if (squad.length > new Set(squad.map((s) => s.unit.id)).size) {
        note(`${brief.campaignName}: picked the same unit twice`);
      }
      picked += squad.length;
    }
    const sample = withEnemies.find((b) => b.meanEnemyArmour > 20) ?? withEnemies[0];
    const squad = new TeamOptimiser(sample).recommend(roster);
    console.log(
      `battles: ${briefs.length} nodes, ${withEnemies.length} with enemy rosters; ` +
        `${picked} picks all within slot counts  ✓`,
    );
    console.log(
      `  example — ${sample.campaignName} node ${sample.battle.nodeNumber}: ${sample.slots} slots, ` +
        `${sample.enemyCount} enemies averaging ${sample.meanEnemyArmour.toFixed(0)} armour`,
    );
    for (const pick of squad) {
      console.log(
        `    ${pick.unit.name.padEnd(18)} ${pick.damage.toFixed(0).padStart(5)} dmg through armour  ` +
          `${pick.toughness.toFixed(0).padStart(6)} effective HP  (${pick.reason})`,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Who a campaign lets you deploy                                             */
/* -------------------------------------------------------------------------- */
{
  /*
   * The alliance a campaign is fought by is derived, not published, so the
   * checks are the ones that would catch a derivation drifting: a side must
   * never be the alliance it spends the campaign shooting at, and the two ends
   * of the same board must never be the same side.
   */
  const alliances = campaignAlliances(db);
  const roster = buildRosterUnits(player, db);
  const allianceOfFaction = new Map();
  for (const unit of Object.values(db.units)) {
    if (unit.factionId === undefined || unit.grandAlliance === undefined) continue;
    allianceOfFaction.set(unit.factionId.replace(/[^a-z0-9]/gi, '').toLowerCase(), unit.grandAlliance);
  }

  const unresolved = [];
  const byFamily = new Map();
  for (const campaign of Object.values(db.campaigns)) {
    const name = campaign.name ?? campaign.id;
    const alliance = alliances.get(campaign.id);
    if (alliance === undefined) {
      unresolved.push(name);
      continue;
    }

    // You do not fight your own side. Whoever the campaign puts across the
    // board on most of its nodes must belong to a different alliance than the
    // one it is derived to be fought by.
    const battles = Object.values(campaign.battles);
    const seen = new Map();
    for (const battle of battles) {
      for (const faction of new Set(battle.enemyFactions ?? [])) {
        seen.set(faction, (seen.get(faction) ?? 0) + 1);
      }
    }
    const [top] = [...seen].sort((a, b) => b[1] - a[1]);
    if (top && top[1] / battles.length >= 0.5) {
      const enemyAlliance = allianceOfFaction.get(top[0].replace(/[^a-z0-9]/gi, '').toLowerCase());
      if (enemyAlliance !== undefined && enemyAlliance === alliance) {
        note(
          `campaigns: ${name} is played by ${GRAND_ALLIANCE_NAMES[alliance]} and fights ` +
            `${top[0]}, who are ${GRAND_ALLIANCE_NAMES[enemyAlliance]}`,
        );
      }
    }

    const family = campaignFamily(name);
    const list = byFamily.get(family) ?? [];
    list.push({ name, type: campaign.type ?? 0, alliance });
    byFamily.set(family, list);
  }

  // Standard against Mirror at the same level: two ends of one board, and the
  // whole point of a mirror is that the sides swap.
  const OPPOSITE = { 0: 1, 1: 0, 2: 3, 3: 2 };
  let mirrored = 0;
  for (const [family, sides] of byFamily) {
    for (const side of sides) {
      const other = sides.find((s) => s.type === OPPOSITE[side.type]);
      if (!other) continue;
      mirrored += 1;
      if (other.alliance === side.alliance) {
        note(`campaigns: ${family} has both sides played by ${GRAND_ALLIANCE_NAMES[side.alliance]}`);
      }
    }
  }

  // And the restriction has to actually reach the squad picker.
  let filtered = 0;
  for (const brief of BattleBrief.all(db)) {
    if (brief.allowedAlliance === undefined) continue;
    for (const pick of new TeamOptimiser(brief, 'defence').recommend(roster)) {
      if (!brief.allows(pick.unit)) {
        note(
          `campaigns: ${brief.campaignName} node ${brief.battle.nodeNumber} picked ` +
            `${pick.unit.name} (${pick.unit.alliance}) for a ${brief.allowedAllianceName} board`,
        );
      }
      filtered += 1;
    }
  }

  console.log(
    `campaigns: ${alliances.size} sides derived, ${mirrored} mirrored pairs, ` +
      `${filtered} pick(s) within their alliance` +
      (unresolved.length > 0 ? `; unrestricted: ${[...new Set(unresolved)].join(', ')}` : '') +
      '  ✓',
  );
}

if (problems.length === 0) {
  console.log('\n✓ caps, filters, equipment and squad picks all hold');
  process.exit(0);
}
console.log(`\n✗ ${problems.length} problem(s):`);
for (const p of problems.slice(0, 20)) console.log('  ' + p);
process.exit(1);
