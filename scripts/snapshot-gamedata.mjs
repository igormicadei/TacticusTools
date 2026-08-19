/**
 * Writes a static game-database snapshot for the UI to fetch.
 *
 * The browser cannot run the loader (it reads the filesystem) and does not need
 * every section, so this builds the database in Node and serialises a subset.
 *
 * Usage:
 *   node scripts/snapshot-gamedata.mjs                  # slim, for the units UI
 *   node scripts/snapshot-gamedata.mjs --full           # every section
 *   node scripts/snapshot-gamedata.mjs --out path.json
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { loadGameDatabase } from '../dist/gamedata/index.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const full = args.includes('--full');
const out = flag('--out') ?? 'ui/public/gamedata.json';

/** Sections the units view never reads; together they are most of the bytes. */
const HEAVY_UNUSED = ['campaigns', 'npcs'];

const db = await loadGameDatabase({ refresh: args.includes('--refresh') });

const snapshot = { ...db };
if (!full) {
  for (const key of HEAVY_UNUSED) snapshot[key] = Array.isArray(db[key]) ? [] : {};
  snapshot.slim = true;
}

const json = JSON.stringify(snapshot);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, json, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`wrote ${out} (${kb(Buffer.byteLength(json))}${full ? ', full' : ', slim'})`);
console.log(`  gameInfo ${db.sources.gameInfoVersion} | schema v${db.schemaVersion}`);
console.log(`  ${db.stats.units} units, ${db.stats.items} items, ${db.stats.abilities} abilities, ${db.stats.upgrades} upgrades`);
