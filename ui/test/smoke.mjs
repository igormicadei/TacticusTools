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

// Not `networkidle`: the roster loads a few hundred icons from Codex, so the
// network is never quiet, and none of the assertions below depend on artwork.
// The selector waits that follow are what actually gate them.
await p.goto('http://localhost:4173/#/units', { waitUntil: 'domcontentloaded' });
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

// A plan's item list: rows open independently, including the recipe rows nested
// inside an item's own expansion. These once shared a single "which row is
// open" slot, so opening an ingredient closed the item that rendered it and the
// click looked like it did nothing.
const planned = JSON.parse(player).player.units.find((u) => u.rank > 0 && u.rank < 18);
if (planned) {
  await p.evaluate(
    ([id, target]) =>
      localStorage.setItem(
        'tacticus-tools:plans',
        JSON.stringify([{ id: 'smoke', unitId: id, target, createdAt: Date.now() }]),
      ),
    [planned.id, { rank: Math.min(planned.rank + 2, 19) }],
  );
  await p.goto('http://localhost:4173/#/plans/smoke', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.item-row', { timeout: 15000 });

  const rows = p.locator('.step-block').last().locator('> ul > .item-row > button');
  const openable = await rows.count();
  if (openable >= 2) {
    await rows.nth(0).click();
    await rows.nth(1).click();
    await p.waitForTimeout(200);
    const open = await p
      .locator('.step-block')
      .last()
      .locator('> ul > .item-row > button[aria-expanded=true]')
      .count();
    console.log(`PLAN ITEMS: opened 2 of ${openable} rows, ${open} stayed open`);
    if (open !== 2) errors.push(`PLAN: opening a second row closed the first (${open} open)`);
  }

  // Drill into a recipe: the ingredient must open while its item stays open.
  const craft = p.locator('.item-list.nested > .item-row > button').first();
  if ((await craft.count()) > 0) {
    const before = await p.locator('.item-list.nested').count();
    await craft.click();
    await p.waitForTimeout(200);
    const still = await p.locator('.item-list.nested').count();
    console.log(`PLAN RECIPE: ingredient opened, ${still} nested list(s) still mounted`);
    if (still < before) errors.push('PLAN: opening an ingredient collapsed its parent item');
  }
  await p.screenshot({ path: `${S}/ui-plan.png`, fullPage: true });
}

console.log('\nconsole errors:', errors.length ? errors.slice(0, 6) : 'none');
if (errors.length) process.exitCode = 1;
await b.close();
