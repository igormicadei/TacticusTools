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
 *
 * `expect` is what the game displayed; `state` is the unit as it stood when the
 * screen was read. The figures only mean anything in that state — ranking up
 * consumes the upgrades and moves every stat with them — so a case whose unit
 * has since advanced is skipped rather than failed. Re-transcribe from a fresh
 * screen to re-arm it.
 */
const CASES = [
  {
    unitId: 'orksWarboss',
    label: 'Gulgortz — Epic, Stone I, no rank upgrades applied',
    state: { rank: 0, progressionIndex: 9, upgrades: 0 },
    expect: {
      health: 160,
      damage: 41,
      armour: 41,
      tierStarLevel: 1,
      itemBonuses: { critChance: 35, critDmg: 43, blockChance: 34, blockDmg: 103 },
    },
  },
  {
    unitId: 'blackHaarken',
    label: 'Haarken — Epic, Iron II, five of six rank upgrades applied',
    state: { rank: 4, progressionIndex: 11, upgrades: 5 },
    expect: {
      health: 479,
      damage: 55,
      armour: 92,
      tierStarLevel: 3,
      itemBonuses: { critChance: 37, critDmg: 98, blockChance: 20, blockDmg: 138 },
    },
  },
];

let failures = 0;
let skipped = 0;
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
  const was = testCase.state;
  if (
    was &&
    (unit.rank !== was.rank ||
      unit.progressionIndex !== was.progressionIndex ||
      unit.upgrades.length !== was.upgrades)
  ) {
    console.log(
      `    SKIP — the unit has moved on: recorded at rank ${was.rank}, ` +
        `${was.upgrades}/6 applied, ${was.progressionIndex} progression; ` +
        `now rank ${unit.rank}, ${unit.upgrades.length}/6, ${unit.progressionIndex}`,
    );
    skipped += 1;
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
      ` x${stats.starMultiplier.toFixed(2)} (${stats.starLevel} cumulative stars)` +
      ` + upgrades ${stats.rankUpgrades.health}/${stats.rankUpgrades.damage}/${stats.rankUpgrades.armour}` +
      ` (${stats.rankUpgradesApplied}/${stats.rankUpgradesAvailable} applied)`,
  );
  check('health', stats.health, testCase.expect.health);
  check('damage', stats.damage, testCase.expect.damage);
  check('armour', stats.armour, testCase.expect.armour);
  if (testCase.expect.tierStarLevel !== undefined) {
    check('stars shown', stats.tierStarLevel, testCase.expect.tierStarLevel);
  }
  for (const [key, value] of Object.entries(testCase.expect.itemBonuses)) {
    check(key, stats.itemBonuses[key], value);
  }
}

const note = skipped > 0 ? ` (${skipped} case(s) skipped — the unit has moved on)` : '';
console.log(
  failures === 0
    ? `\n✓ derived stats match the game${note}`
    : `\n✗ ${failures} mismatch(es) against the game${note}`,
);
process.exit(failures === 0 ? 0 : 1);
