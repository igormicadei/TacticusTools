/**
 * Renders the built app in a browser and asserts the roster views work.
 *
 * Usage:
 *   npm run build && npx vite preview --port 4173 &
 *   node test/smoke.mjs <path-to-player.json>
 *
 * Player data is seeded into localStorage before any app script runs, since a
 * hash-only navigation would not re-initialise React.
 */

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const playerPath = process.argv[2];
if (!playerPath) {
  console.error('Usage: node test/smoke.mjs <path-to-player.json>');
  process.exit(1);
}
const player = readFileSync(playerPath, 'utf8');
const S = process.env.SHOT_DIR ?? '.';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
// Seed before any app script runs; a hash change would not re-initialise React.
await ctx.addInitScript((raw) => localStorage.setItem('tacticus-tools:player', raw), player);
const p = await ctx.newPage();
const errors = [];
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await p.goto('http://localhost:4173/#/units', { waitUntil: 'networkidle' });
await p.waitForSelector('.card', { timeout: 30000 });
const groups = await p.locator('.group-head h2').allTextContents();
const cards = await p.locator('.card').count();
console.log('BY STATUS groups:', groups.join(' | '), '| cards:', cards);
await p.screenshot({ path: `${S}/ui-status.png`, fullPage: false });

// faction view
await p.getByRole('button', { name: 'By faction' }).click();
await p.waitForTimeout(400);
const fgroups = await p.locator('.group-head h2').allTextContents();
console.log('BY FACTION groups:', fgroups.length, '->', fgroups.slice(0,6).join(', '));
await p.screenshot({ path: `${S}/ui-faction.png`, fullPage: false });

// detail page for an owned unit
await p.getByRole('button', { name: 'By status' }).click();
await p.waitForTimeout(300);
const firstCard = p.locator('.card').first();
const unitName = await firstCard.locator('.name').textContent();
await firstCard.click();
await p.waitForSelector('.detail-head h1', { timeout: 15000 });
const panels = await p.locator('.panel h3').allTextContents();
console.log('DETAIL for', unitName, '-> panels:', panels.join(' | '));
await p.screenshot({ path: `${S}/ui-detail.png`, fullPage: true });

console.log('\nconsole errors:', errors.length ? errors.slice(0, 6) : 'none');
if (errors.length) process.exitCode = 1;
await b.close();
