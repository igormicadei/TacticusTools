/**
 * Validates the normalized game database: enum integrity, id normalization,
 * source-merge coverage, and the XP table's semantics.
 *
 * Usage:
 *   node test/validate-gamedata.mjs                     # cached or live build
 *   node test/validate-gamedata.mjs --player p.json     # also check joins
 *   node test/validate-gamedata.mjs --raw <dir>         # build from saved raw files
 *
 * With --raw, <dir> must contain gameInfo.json, and optionally
 * battledata.json and campaignconfig.json.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { buildGameDatabase, loadGameDatabase, battleKey, rankName } from '../dist/gamedata/index.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const problems = [];
const note = (m) => problems.push(m);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const rawDir = flag('--raw');
const db = rawDir
  ? buildGameDatabase({
      gameInfo: read(join(rawDir, 'gameInfo.json')),
      codexBattleData: existsSync(join(rawDir, 'battledata.json'))
        ? read(join(rawDir, 'battledata.json'))
        : undefined,
      codexCampaignConfigs: existsSync(join(rawDir, 'campaignconfig.json'))
        ? read(join(rawDir, 'campaignconfig.json'))
        : undefined,
    })
  : await loadGameDatabase();

console.log('sources:', JSON.stringify(db.sources));
console.log('stats  :', JSON.stringify({ ...db.stats, unresolvedNpcIds: db.stats.unresolvedNpcIds.length, unresolvedBattleRefs: db.stats.unresolvedBattleRefs.length }));

/* ---- enums are integers everywhere -------------------------------------- */
const int = (v) => v === undefined || (typeof v === 'number' && Number.isInteger(v));
for (const u of Object.values(db.units)) {
  if (!int(u.grandAlliance) || !int(u.baseRarity)) note(`unit ${u.id}: non-integer enum`);
  for (const r of u.ranks) if (!int(r.rank)) note(`unit ${u.id}: non-integer rank ${r.rank}`);
}
for (const u of Object.values(db.upgrades)) if (!int(u.rarity)) note(`upgrade ${u.id}: non-integer rarity`);
for (const i of Object.values(db.items)) if (!int(i.rarity)) note(`item ${i.id}: non-integer rarity`);
const battles = Object.values(db.campaigns).flatMap((c) => Object.values(c.battles));
for (const b of battles) {
  if (!int(b.campaignType)) note(`battle ${b.key}: non-integer campaignType`);
  for (const e of b.enemies) {
    if (!int(e.rank) || !int(e.rarity) || typeof e.stars !== 'number') {
      note(`battle ${b.key}: non-integer enemy enum on ${e.sourceNpcId}`);
    }
  }
}

/* ---- XP table semantics -------------------------------------------------- */
const byLevel = new Map(db.xpLevels.map((l) => [l.level, l]));
if (byLevel.get(1)?.totalXp !== 0) note('xpLevels: level 1 totalXp must be 0');
for (const l of db.xpLevels) {
  const next = byLevel.get(l.level + 1);
  if (next && l.totalXp + l.xpToNextLevel !== next.totalXp) {
    note(`xpLevels: level ${l.level} totalXp+xpToNextLevel != level ${l.level + 1} totalXp`);
  }
}

/* ---- drop rates are per-node with provenance ----------------------------- */
const rated = battles.filter((b) => b.dropRates);
for (const b of rated) {
  if (b.dropRateProvenance !== 'campaignType' && b.dropRateProvenance !== 'node') {
    note(`battle ${b.key}: dropRates without valid provenance`);
  }
}
console.log(`dropRates: ${rated.length}/${battles.length} nodes carry rates`);

/* ---- battle refs resolve ------------------------------------------------- */
const known = new Set(battles.map((b) => b.key));
const refs = Object.values(db.upgrades).flatMap((u) => u.farmableAt);
const resolved = refs.filter((r) => known.has(battleKey(r)));
console.log(`farming refs: ${resolved.length}/${refs.length} resolve to a known node`);

/* ---- enemy stat backfill ------------------------------------------------- */
const enemies = battles.flatMap((b) => b.enemies);
const hit = enemies.filter((e) => e.statsResolved);
console.log(`enemy stats : ${hit.length}/${enemies.length} resolved from NPC tables`);
for (const e of enemies) {
  if (!e.statsResolved && (e.health !== undefined || e.armour !== undefined)) {
    note(`enemy ${e.sourceNpcId}: stats present but statsResolved false`);
  }
}

/* ---- optional: joins against a real player payload ----------------------- */
const playerPath = flag('--player');
if (playerPath) {
  const p = read(playerPath).player;
  const cov = (label, ids, keys) => {
    const k = new Set(keys);
    const miss = [...new Set(ids)].filter((x) => !k.has(x));
    const total = new Set(ids).size;
    console.log(`join ${label.padEnd(26)} ${total - miss.length}/${total}`);
    if (miss.length) note(`join ${label}: unmatched ${miss.slice(0, 5).join(', ')}`);
  };
  cov('units', p.units.map((u) => u.id), Object.keys(db.units));
  cov('shards', p.inventory.shards.map((s) => s.id), Object.keys(db.units));
  cov('upgrades', p.inventory.upgrades.map((u) => u.id), Object.keys(db.upgrades));
  cov('items', p.inventory.items.map((i) => i.id), Object.keys(db.items));
  cov('equipped items', p.units.flatMap((u) => u.items.map((i) => i.id)), Object.keys(db.items));
  cov('abilities', p.units.flatMap((u) => u.abilities.map((a) => a.id)), Object.keys(db.abilities));

  let xpOk = 0, xpBad = 0;
  for (const u of p.units) {
    const cur = byLevel.get(u.xpLevel), next = byLevel.get(u.xpLevel + 1);
    if (!cur || !next) continue;
    if (cur.totalXp <= u.xp && u.xp < next.totalXp) xpOk += 1;
    else { xpBad += 1; note(`xp: ${u.id} lvl ${u.xpLevel} xp ${u.xp} outside [${cur.totalXp}, ${next.totalXp})`); }
  }
  console.log(`xp table    : ${xpOk}/${xpOk + xpBad} units consistent`);

  const sample = p.units[0];
  const def = db.units[sample.id];
  if (def) {
    const rank = def.ranks[sample.rank];
    console.log(`sample      : ${def.name} rank ${sample.rank} (${rankName(sample.rank)}), ` +
      `${rank ? rank.upgrades.length : 0} materials for that rank`);
  }
}

if (problems.length === 0) {
  console.log('\n✓ game database valid');
  process.exit(0);
}
console.log(`\n✗ ${problems.length} problem(s):`);
for (const p of problems.slice(0, 25)) console.log('  ' + p);
process.exit(1);
