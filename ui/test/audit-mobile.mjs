/**
 * Measures horizontal overflow at phone width on every route.
 *
 * Screenshots alone miss this: a page that scrolls sideways looks fine until
 * you scroll, and the offending element is rarely the one you photographed. So
 * this asks the browser directly — is the document wider than the viewport, and
 * which elements have content wider than their own box.
 *
 * Every disclosure it can find gets opened first, twice over, because the long
 * content is what is hidden: a recipe two levels deep is where the rows
 * actually crumple.
 *
 * Usage:
 *   npm run build && node test/audit-mobile.mjs ../player.json
 *   WIDTH=320 node test/audit-mobile.mjs        # a smaller phone
 *   DIST=dist OUT=.shots node test/audit-mobile.mjs
 *
 * Exits non-zero when any route scrolls sideways, so it can gate a change.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DIST ?? join(HERE, '..', 'dist');
// Read the base off the build rather than assuming it. A bundle built without
// BASE_PATH asks for /assets/..., every asset 404s, and the audit measures ten
// blank pages and calls them clean — which is exactly the report you must not
// trust. Serving whatever base the build actually used keeps the two in step.
const INDEX = await readFile(join(ROOT, 'index.html'), 'utf8');
const BASE = (INDEX.match(/(?:src|href)="(\/[^"]*\/)assets\//)?.[1]) ?? '/';
const PORT = Number(process.env.PORT ?? 8191);
const OUT = process.env.OUT ?? join(HERE, '..', '.mobile-audit');
const WIDTH = Number(process.env.WIDTH ?? 390);
const HEIGHT = Number(process.env.HEIGHT ?? 844);
await mkdir(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(BASE)) return res.writeHead(404).end('nope');
  path = path.slice(BASE.length) || 'index.html';
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(await readFile(join(ROOT, 'index.html')));
  }
});
await new Promise((r) => server.listen(PORT, r));

const playerPath = process.argv[2] ?? join(HERE, '..', '..', 'player.json');
const player = await readFile(playerPath, 'utf8');
const proxy = process.env.HTTPS_PROXY
  ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' }
  : undefined;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  ...(proxy ? { proxy } : {}),
});
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
page.setDefaultTimeout(30000);

// Codex art through Node, as elsewhere: the sandbox aborts the browser's own
// image loads in bulk and a missing portrait changes a row's width.
const cache = new Map();
await page.route('https://www.tacticuscodex.com/**', async (route) => {
  const url = route.request().url();
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then(async (r) => ({ status: r.status, type: r.headers.get('content-type') ?? 'image/png', body: Buffer.from(await r.arrayBuffer()) })).catch(() => undefined));
  }
  const hit = await cache.get(url);
  if (!hit) return route.abort();
  await route.fulfill({ status: hit.status, contentType: hit.type, body: hit.body });
});

await page.goto(`http://127.0.0.1:${PORT}${BASE}`);
const roster = JSON.parse(player).player.units;
await page.evaluate(
  ([p, plans, teams]) => {
    localStorage.setItem('tacticus-tools:player', p);
    localStorage.setItem('tacticus-tools:fetchedAt', String(Date.now()));
    localStorage.setItem('tacticus-tools:plans', plans);
    localStorage.setItem('tacticus-tools:teams', teams);
  },
  [
    player,
    JSON.stringify(
      roster.slice(0, 3).map((u, i) => ({
        id: `probe-${i}`,
        unitId: u.id,
        target: { rank: Math.min(19, u.rank + 3), xpLevel: u.xpLevel + 6 },
        createdAt: Date.now() - i,
      })),
    ),
    JSON.stringify([
      {
        id: 'probe-team',
        name: 'Probe squad',
        memberIds: roster.slice(0, 5).map((u) => u.id),
        capRarity: 2,
        battleKey: 'campaign1_30',
        createdAt: Date.now(),
      },
    ]),
  ],
);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

/**
 * Everything the page is doing wrong horizontally, straight from layout.
 *
 * `scrollWidth > clientWidth` on the document is the symptom the user sees.
 * The per-element sweep finds the cause: an element wider than its own box that
 * is not itself scrollable is pushing the page out.
 */
const OVERFLOW = () =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const viewport = doc.clientWidth;
    const culprits = [];
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const box = el.getBoundingClientRect();
      // A form field scrolls its own value natively, without asking for
      // overflow-x, so a value longer than the field is not a layout fault —
      // it is what every text input on the web does. The rule below is about
      // content that is wider than its box and has no way to scroll.
      if (el.matches('input, textarea, select')) continue;
      const scrolls = ['auto', 'scroll'].includes(style.overflowX);
      // Something inside a deliberate horizontal scroller is not a fault: the
      // nav strip and the roadmap SVG are both meant to be swiped.
      let inScroller = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(p).overflowX)) { inScroller = true; break; }
      }
      if (inScroller) continue;
      // Two separate faults: sticking out past the viewport, and holding
      // content wider than itself without being able to scroll it.
      const pastViewport = box.right > viewport + 1 || box.left < -1;
      const burstsItsBox = !scrolls && el.scrollWidth > el.clientWidth + 1;
      if (!pastViewport && !burstsItsBox) continue;
      const name =
        el.tagName.toLowerCase() +
        (el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
          : '');
      culprits.push({
        name,
        right: Math.round(box.right),
        width: Math.round(box.width),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        past: pastViewport,
        bursts: burstsItsBox,
        text: (el.textContent ?? '').trim().slice(0, 40),
      });
    }
    return {
      viewport,
      docScrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      culprits,
    };
  });

const routes = [
  ['units', '#/units'],
  ['unit-detail', `#/units/${encodeURIComponent(roster[0].id)}`],
  ['plans', '#/plans'],
  ['plan-detail', '#/plans/probe-0'],
  ['timeline', '#/plans/timeline'],
  ['teams', '#/teams'],
  ['team-detail', '#/teams/probe-team'],
  ['items', '#/items'],
  ['badges', '#/badges'],
  ['player', '#/player'],
];

const report = [];
const broken = [];
for (const [name, hash] of routes) {
  await page.goto(`http://127.0.0.1:${PORT}${BASE}${hash}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);

  // Open whatever the page hides behind a disclosure, since that is where the
  // long content lives — a recipe two levels deep is the whole complaint.
  for (const selector of ['.item-head', '.bundle-head']) {
    const rows = page.locator(selector);
    const count = Math.min(await rows.count(), 3);
    for (let i = 0; i < count; i += 1) {
      await rows.nth(i).click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(250);
    }
  }
  // And once more, to reach a second level of recipe.
  const nested = page.locator('.item-list.nested .item-head');
  const nestedCount = Math.min(await nested.count(), 3);
  for (let i = 0; i < nestedCount; i += 1) {
    await nested.nth(i).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1200);

  // A page that failed to render has nothing to overflow, so it would pass
  // silently. Insist on the shell before believing any measurement.
  const rendered = await page.evaluate(() => document.querySelectorAll('.topbar').length > 0);
  if (!rendered) {
    console.error(`${name.padEnd(13)} DID NOT RENDER — the app never mounted, measurements below are meaningless`);
    broken.push(name);
  }

  const result = await OVERFLOW();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);

  // Screenshot the whole scroll height, so nothing below the fold goes unseen.
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });

  const overflows = result.docScrollWidth > result.viewport + 1;
  report.push({ name, ...result, height, overflows });
  console.log(
    `${name.padEnd(13)} ${overflows ? 'OVERFLOWS' : 'fits     '} ` +
      `doc ${String(result.docScrollWidth).padStart(4)} / ${result.viewport}  ` +
      `height ${String(height).padStart(5)}  culprits ${result.culprits.length}`,
  );
  for (const c of result.culprits.slice(0, 6)) {
    console.log(
      `    ${c.past ? 'past-viewport' : 'bursts-box  '} ${c.name.padEnd(34)} ` +
        `right ${String(c.right).padStart(5)} scroll ${c.scrollWidth}/${c.clientWidth}  "${c.text}"`,
    );
  }
}

console.log('\n=== summary ===');
const bad = report.filter((r) => r.overflows);
console.log(bad.length === 0 ? 'every route fits the viewport' : `${bad.length} route(s) scroll sideways: ${bad.map((r) => r.name).join(', ')}`);
const totalCulprits = report.reduce((n, r) => n + r.culprits.length, 0);
console.log(`${totalCulprits} element(s) over-wide across ${report.length} routes`);
if (broken.length > 0) {
  console.error(`${broken.length} route(s) never rendered: ${broken.join(', ')} — build with BASE_PATH set to match the deploy path`);
}

await browser.close();
server.close();

// A page that scrolls sideways is a defect, not a note, so this exits non-zero.
process.exit(bad.length === 0 && broken.length === 0 ? 0 : 1);
