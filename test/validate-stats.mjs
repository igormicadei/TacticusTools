/**
 * Checks derived unit stats against values read off the game's own character
 * screen. Each case is a screenshot transcribed by hand; add more as they are
 * captured.
 *
 * Usage:
 *   node test/validate-stats.mjs <player.json> [--raw <dir> | uses the cache]
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { buildGameDatabase, loadGameDatabase, computeUnitStats } from '../dist/gamedata/index.js';

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

const player = read(playerPath).player;

/**
 * Ground truth transcribed from in-game character screens.
 * `expect` holds what the game displays; `state` records the conditions so a
 * mismatch is diagnosable.
 */
const CASES = [
  {
    unitId: 'orksWarboss',
    label: 'Gulgortz — Epic, Stone I, 6 stars, level 15',
    expect: {
      health: 160,
      damage: 41,
      armour: 41,
      itemBonuses: { critChance: 35, critDmg: 43, blockChance: 34, blockDmg: 103 },
    },
  },
];

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(14)} expected ${expected}, got ${actual}`);
};

for (const testCase of CASES) {
  const unit = player.units.find((u) => u.id === testCase.unitId);
  console.log(`\n${testCase.label}`);
  if (!unit) {
    console.log('    SKIP — not in this player payload');
    continue;
  }
  const stats = computeUnitStats(unit, db);
  if (!stats) {
    console.log('    FAIL — no stat block for this rank');
    failures += 1;
    continue;
  }
  console.log(
    `    base ${stats.base.health}/${stats.base.damage}/${stats.base.armour}` +
      ` x${stats.starMultiplier.toFixed(2)} (${stats.starLevel} stars)`,
  );
  check('health', stats.health, testCase.expect.health);
  check('damage', stats.damage, testCase.expect.damage);
  check('armour', stats.armour, testCase.expect.armour);
  for (const [key, value] of Object.entries(testCase.expect.itemBonuses)) {
    check(key, stats.itemBonuses[key], value);
  }
}

console.log(
  failures === 0
    ? '\n✓ derived stats match the game'
    : `\n✗ ${failures} mismatch(es) against the game`,
);
process.exit(failures === 0 ? 0 : 1);
