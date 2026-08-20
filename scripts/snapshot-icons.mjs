/**
 * Builds an icon manifest by resolving our ids against Codex's asset bundle.
 *
 * Codex ships its images as webpack assets with content hashes, and serves them
 * with `Access-Control-Allow-Origin: *` and no referer check. So rather than
 * copying ~150 MB of artwork into this repo, we store the mapping — a few tens
 * of kilobytes — and let the browser load each image from Codex directly.
 *
 * The hashes change whenever Codex rebuilds, so re-run this when icons start
 * 404ing. It reads the live bundle rather than a cached copy for that reason.
 *
 * Usage:
 *   node scripts/snapshot-icons.mjs                 # writes ui/public/icons.json
 *   node scripts/snapshot-icons.mjs --out path.json
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { loadGameDatabase } from '../dist/gamedata/index.js';

const CODEX = 'https://www.tacticuscodex.com';
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = flag('--out') ?? 'ui/public/icons.json';

/* ---- Codex's asset table --------------------------------------------------- */

const index = await fetch(CODEX).then((r) => r.text());
const bundle = index.match(/\/static\/js\/main\.[a-z0-9]+\.js/)?.[0];
if (!bundle) throw new Error('Could not find the Codex bundle in its index.html');
const source = await fetch(`${CODEX}${bundle}`).then((r) => r.text());

const files = [...new Set([...source.matchAll(/static\/media\/([^"\\]+)/g)].map((m) => m[1]))];
if (files.length === 0) throw new Error('No static/media assets found in the bundle');

/** `VarroTigurius.33e8bf….png` -> `VarroTigurius`. */
const logicalName = (file) => {
  const parts = file.split('.');
  return parts.length >= 3 ? parts.slice(0, -2).join('.') : parts.slice(0, -1).join('.');
};
/**
 * Fold a name to a lookup key.
 *
 * Diacritics are stripped rather than dropped: the game writes Khârn and Ûthar,
 * Codex files them as kharn and uthar, and removing the accented letter
 * entirely would leave "khrn" and match nothing.
 */
const norm = (value) =>
  (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Logical name -> file, normalised for lookup.
 *
 * Codex renames some assets without removing the old one, so a key can map to
 * several files. The shortest name wins: `Vindicta` over
 * `Vindicta-removebg-preview`, which is the same art with a suffix.
 */
const byKey = new Map();
for (const file of files) {
  const name = logicalName(file);
  for (const key of [norm(name), norm(name.replace(/-removebg-preview/i, ''))]) {
    if (!key) continue;
    const current = byKey.get(key);
    if (!current || name.length < logicalName(current).length) byKey.set(key, file);
  }
}

const find = (...candidates) => {
  for (const candidate of candidates) {
    const hit = byKey.get(norm(candidate));
    if (hit) return hit;
  }
  return undefined;
};

/* ---- resolve our ids ------------------------------------------------------- */

const db = await loadGameDatabase();
const stats = {};
const record = (label, entries) => {
  const found = Object.values(entries).filter(Boolean).length;
  stats[label] = { found, total: Object.keys(entries).length };
  return Object.fromEntries(Object.entries(entries).filter(([, v]) => v));
};

const units = {};
const unitAbilities = {};
for (const [id, unit] of Object.entries(db.units)) {
  units[id] = find(unit.name, unit.fullName, id);
  // Ability art is keyed by the unit and the slot, not by the ability.
  const slug = [unit.name, unit.fullName, id];
  const active = find(...slug.map((s) => `${s}_ability_1_icon`));
  const passive = find(...slug.map((s) => `${s}_ability_2_icon`));
  if (active || passive) {
    unitAbilities[id] = { ...(active ? { active } : {}), ...(passive ? { passive } : {}) };
  }
}

const upgrades = {};
for (const [id, upgrade] of Object.entries(db.upgrades)) upgrades[id] = find(upgrade.name, id);

const items = {};
for (const [id, item] of Object.entries(db.items)) items[id] = find(item.name, id);

const RARITY = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const ALLIANCE = ['Imperial', 'Chaos', 'Xenos'];

const orbs = {};
const badges = {};
for (const alliance of ALLIANCE) {
  const orbRow = {};
  const badgeRow = {};
  RARITY.forEach((rarity, index) => {
    // Orbs start at Uncommon; there is no Common orb to look for.
    const orb = find(`${alliance}-${rarity}-orb`);
    if (orb) orbRow[index] = orb;
    const badge = find(`${alliance}-${rarity}`);
    if (badge) badgeRow[index] = badge;
  });
  if (Object.keys(orbRow).length) orbs[alliance] = orbRow;
  if (Object.keys(badgeRow).length) badges[alliance] = badgeRow;
}

// Rank art is per tier and step, in the Rank enum's order. Codex carries no
// Stone or Bronze icons, so those ranks resolve to nothing rather than to the
// wrong tier's art.
const TIERS = ['stone', 'iron', 'bronze', 'silver', 'gold', 'diamond', 'adamantine'];
const ranks = {};
let rank = 0;
for (const tier of TIERS) {
  for (let step = 1; step <= 3 && rank < 20; step += 1, rank += 1) {
    const file = find(`${tier}${step}`, `${tier}-${step}`);
    if (file) ranks[rank] = file;
  }
}

const stars = {
  white: find('star'),
  blue: find('blue star'),
  red: find('red star'),
};
const shards = { normal: find('characterShards'), mythic: find('characterMythicShards') };

const manifest = {
  base: `${CODEX}/static/media/`,
  bundle,
  fetchedAt: new Date().toISOString(),
  assets: files.length,
  units: record('units', units),
  unitAbilities,
  upgrades: record('upgrades', upgrades),
  items: record('items', items),
  orbs,
  badges,
  ranks,
  stars: record('stars', stars),
  shards: record('shards', shards),
};

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(manifest), 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`wrote ${out} (${kb(Buffer.byteLength(JSON.stringify(manifest)))})`);
console.log(`  from ${bundle}, ${files.length} assets`);
for (const [label, { found, total }] of Object.entries(stats)) {
  console.log(`  ${label.padEnd(10)} ${found}/${total}`);
}
console.log(`  ${'abilities'.padEnd(10)} ${Object.keys(unitAbilities).length}/${Object.keys(db.units).length} units`);
console.log(`  ${'ranks'.padEnd(10)} ${Object.keys(ranks).length}/20`);
console.log(`  ${'orbs'.padEnd(10)} ${Object.values(orbs).reduce((n, r) => n + Object.keys(r).length, 0)}`);
console.log(`  ${'badges'.padEnd(10)} ${Object.values(badges).reduce((n, r) => n + Object.keys(r).length, 0)}`);
