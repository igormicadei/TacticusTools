/**
 * Builds an icon manifest by resolving our ids against Codex's asset bundle.
 *
 * Codex ships its images as webpack assets with content hashes, and serves them
 * with `Access-Control-Allow-Origin: *` and no referer check. So rather than
 * copying ~150 MB of artwork into this repo, we store the mapping — a couple of
 * hundred kilobytes — and let the browser load each image from Codex directly.
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

/* ---- Codex's asset table ---------------------------------------------------
 *
 * Resolved through webpack's own bookkeeping rather than by matching file names
 * out of the bundle text. Each `require.context` call leaves a map of source
 * path to module id — `{"./ranks/iron1.png": 85324, …}` — and each of those
 * modules exports either an emitted file name or, for small images, an inline
 * data URI. Following that chain gives the original folder and file name, which
 * matters: three different assets are called `epic.png`, and the six Stone and
 * Bronze rank pips have no emitted file at all.
 */

const index = await fetch(CODEX).then((r) => r.text());
const bundle = index.match(/\/static\/js\/main\.[a-z0-9]+\.js/)?.[0];
if (!bundle) throw new Error('Could not find the Codex bundle in its index.html');
const source = await fetch(`${CODEX}${bundle}`).then((r) => r.text());

const emitted = new Map();
for (const m of source.matchAll(
  /(\d+):\s*\(e,t,r\)\s*=>\s*\{\s*(?:"use strict";)?\s*e\.exports\s*=\s*r\.p\s*\+\s*"static\/media\/([^"]+)"/g,
)) {
  emitted.set(m[1], m[2]);
}
const inlined = new Map();
for (const m of source.matchAll(
  /(\d+):\s*e\s*=>\s*\{\s*(?:"use strict";)?\s*e\.exports\s*=\s*"(data:image\/[^"]+)"/g,
)) {
  inlined.set(m[1], m[2]);
}
if (emitted.size === 0) throw new Error('No emitted media modules found in the bundle');

/** Source path (`ranks/iron1.png`) -> emitted file name, or an inline data URI. */
const assets = new Map();
for (const m of source.matchAll(/"\.\/([^"]+\.(?:png|webp|jpg|jpeg|svg|gif))":(\d+)/gi)) {
  const value = emitted.get(m[2]) ?? inlined.get(m[2]);
  if (value) assets.set(m[1], value);
}
if (assets.size === 0) throw new Error('No asset paths could be resolved to modules');

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
 * One folder of the bundle, indexed by its folded file name.
 *
 * Codex renames some assets without removing the old one, so a key can map to
 * several files. The shortest name wins: `Vindicta` over
 * `Vindicta-removebg-preview`, which is the same art with a suffix.
 */
function folder(name) {
  const prefix = `${name}/`;
  const byKey = new Map();
  for (const [path, value] of assets) {
    if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
    const file = path.slice(prefix.length).replace(/\.[a-z]+$/i, '');
    for (const key of [norm(file), norm(file.replace(/-removebg-preview$/i, ''))]) {
      if (!key) continue;
      const current = byKey.get(key);
      if (!current || file.length < current.file.length) byKey.set(key, { file, value });
    }
  }
  return {
    size: byKey.size,
    /** First candidate that resolves, so callers can list ids newest-name-first. */
    find: (...candidates) => {
      for (const candidate of candidates) {
        const hit = byKey.get(norm(candidate));
        if (hit) return hit.value;
      }
      return undefined;
    },
  };
}

const portraits = folder('portraits');
const characters = folder('characters');
const abilityArt = folder('abilities');
const materials = folder('upgradeMaterials');
const namedUpgrades = folder('upgrades');
const equipment = folder('equipment');
const rankArt = folder('ranks');
const rarityArt = folder('rarity');
const starArt = folder('stars');
const badgeArt = folder('badges');
const orbArt = folder('orbs');
const factionArt = folder('factions');
const damageArt = folder('damage');
const campaignArt = folder('campaigns');
const uiArt = folder('icons');

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
  const slugs = [unit.name, unit.fullName, id];
  units[id] = portraits.find(...slugs) ?? characters.find(...slugs);
  // Ability art is keyed by the unit and the slot, not by the ability.
  const slot = (suffix) => abilityArt.find(...slugs.map((s) => `${s}_ability_${suffix}_icon`));
  const [active, passive, mythic] = [slot(1), slot(2), slot('mythic')];
  if (active || passive || mythic) {
    unitAbilities[id] = {
      ...(active ? { active } : {}),
      ...(passive ? { passive } : {}),
      ...(mythic ? { mythic } : {}),
    };
  }
}

// Materials are filed under their id, which is exactly ours; a handful are
// filed only under their display name instead.
const upgrades = {};
for (const [id, upgrade] of Object.entries(db.upgrades)) {
  upgrades[id] = materials.find(id) ?? namedUpgrades.find(upgrade.name);
}

const items = {};
for (const [id, item] of Object.entries(db.items)) {
  items[id] = equipment.find(id) ?? namedUpgrades.find(item.name);
}

const RARITY = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const ALLIANCE = ['Imperial', 'Chaos', 'Xenos'];

const orbs = {};
const badges = {};
for (const alliance of ALLIANCE) {
  const orbRow = {};
  const badgeRow = {};
  RARITY.forEach((rarity, index) => {
    // Orbs start at Uncommon; there is no Common orb to look for.
    const orb = orbArt.find(`${alliance}-${rarity}-orb`);
    if (orb) orbRow[index] = orb;
    const badge = badgeArt.find(`${alliance}-${rarity}`);
    if (badge) badgeRow[index] = badge;
  });
  if (Object.keys(orbRow).length) orbs[alliance] = orbRow;
  if (Object.keys(badgeRow).length) badges[alliance] = badgeRow;
}

// Rank art is per tier and step, in the Rank enum's order. Stone and Bronze are
// small enough that Codex inlines them, so they arrive as data URIs.
const TIERS = ['stone', 'iron', 'bronze', 'silver', 'gold', 'diamond', 'adamantine'];
const ranks = {};
let rank = 0;
for (const tier of TIERS) {
  for (let step = 1; step <= 3 && rank < 20; step += 1, rank += 1) {
    const file = rankArt.find(`${tier}${step}`, `${tier}-${step}`);
    if (file) ranks[rank] = file;
  }
}

const rarities = {};
RARITY.forEach((name, index) => {
  const file = rarityArt.find(name);
  if (file) rarities[index] = file;
});

const stars = {
  white: starArt.find('star'),
  blue: starArt.find('blue star'),
  red: starArt.find('red star'),
  mythic: starArt.find('mythic'),
};
const shards = { normal: uiArt.find('characterShards'), mythic: uiArt.find('characterMythicShards') };

const factions = {};
for (const id of new Set(Object.values(db.units).map((u) => u.factionId))) {
  const art = factionArt.find(id, id.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
  if (art) factions[id] = art;
}

// Codex names two damage types differently from `gameInfo`: Molecular is its
// word for Gauss, and the plain melee/ranged glyphs stand in for the normal
// attacks that carry no profile of their own.
const DAMAGE_ALIASES = { Gauss: 'molecular' };
const damageTypes = {};
for (const profile of Object.keys(db.pierceByDamageProfile)) {
  const art = damageArt.find(
    DAMAGE_ALIASES[profile] ?? profile,
    profile.replace(/([a-z0-9])([A-Z])/g, '$1-$2'),
  );
  if (art) damageTypes[profile] = art;
}
const attacks = {
  melee: damageArt.find('melee'),
  ranged: damageArt.find('ranged'),
  hits: damageArt.find('hits'),
};

// Keyed by campaign id, which is what a node reference carries; the name is
// only the fallback spelling to look the art up by.
const campaigns = {};
for (const [id, campaign] of Object.entries(db.campaigns)) {
  const art = campaignArt.find(campaign.name ?? '', id);
  if (art) campaigns[id] = art;
}

/**
 * The handful of chrome glyphs the app has a place for.
 *
 * Named rather than swept up wholesale: Codex's `icons/` folder also holds its
 * own branding, Patreon and Discord marks, and seasonal art, none of which
 * belongs in someone else's tool.
 */
const ui = {
  gold: uiArt.find('gold'),
  energy: uiArt.find('energy'),
  power: uiArt.find('power'),
  health: uiArt.find('health'),
  damage: uiArt.find('damage'),
  armour: uiArt.find('armour'),
  movement: uiArt.find('movement'),
  forge: uiArt.find('recipeHammer'),
  unlock: uiArt.find('characterUnlock'),
  requisition: uiArt.find('requisition'),
  blackstone: uiArt.find('blackstone'),
  warToken: uiArt.find('warToken'),
  raidTicket: uiArt.find('raid-ticket'),
  machineOfWar: uiArt.find('mow'),
};

const manifest = {
  base: `${CODEX}/static/media/`,
  bundle,
  fetchedAt: new Date().toISOString(),
  assets: assets.size,
  units: record('units', units),
  unitAbilities,
  upgrades: record('upgrades', upgrades),
  items: record('items', items),
  orbs,
  badges,
  ranks,
  rarities,
  stars: record('stars', stars),
  shards: record('shards', shards),
  factions,
  damageTypes,
  attacks: record('attacks', attacks),
  campaigns,
  ui: record('ui', ui),
};

await mkdir(dirname(out), { recursive: true });
const json = JSON.stringify(manifest);
await writeFile(out, json, 'utf8');

const inlineCount = JSON.stringify(manifest).match(/"data:image\//g)?.length ?? 0;
console.log(`wrote ${out} (${(Buffer.byteLength(json) / 1024).toFixed(0)} KB)`);
console.log(`  from ${bundle}, ${assets.size} resolved assets, ${inlineCount} inlined`);
for (const [label, { found, total }] of Object.entries(stats)) {
  console.log(`  ${label.padEnd(12)} ${found}/${total}`);
}
const count = (o) => Object.values(o).reduce((n, r) => n + Object.keys(r).length, 0);
console.log(`  ${'abilities'.padEnd(12)} ${Object.keys(unitAbilities).length}/${Object.keys(db.units).length} units`);
console.log(`  ${'ranks'.padEnd(12)} ${Object.keys(ranks).length}/20`);
console.log(`  ${'rarities'.padEnd(12)} ${Object.keys(rarities).length}/6`);
console.log(`  ${'orbs'.padEnd(12)} ${count(orbs)}`);
console.log(`  ${'badges'.padEnd(12)} ${count(badges)}`);
console.log(`  ${'factions'.padEnd(12)} ${Object.keys(factions).length}`);
console.log(`  ${'damageTypes'.padEnd(12)} ${Object.keys(damageTypes).length}/${Object.keys(db.pierceByDamageProfile).length}`);
console.log(`  ${'campaigns'.padEnd(12)} ${Object.keys(campaigns).length}`);
