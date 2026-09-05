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
const LANG = process.env.LANG_UNDER_TEST ?? 'pt';
await page.evaluate(
  ([p, plans, teams, lang]) => {
    localStorage.setItem('tacticus-tools:player', p);
    localStorage.setItem('tacticus-tools:fetchedAt', String(Date.now()));
    localStorage.setItem('tacticus-tools:plans', plans);
    localStorage.setItem('tacticus-tools:teams', teams);
    // Portuguese is the default; set explicitly so a run is reproducible and
    // so the English layout can be measured too.
    localStorage.setItem('tacticus-tools:lang', lang);
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
    LANG,
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
  ['upgrades', '#/upgrades'],
  ['badges', '#/badges'],
  ['player', '#/player'],
];

const report = [];
const broken = [];

/*
 * English left showing on a Portuguese page.
 *
 * Every earlier check read the source, and each one had a blind spot the next
 * one found — text on its own line, text beside an interpolation, a label built
 * in the library. This reads the rendered page instead, which has no blind
 * spots by construction: whatever is on screen is what it sees.
 *
 * The word list is deliberately short and made only of English function words
 * that cannot appear inside a Warhammer name. Unit, faction, ability and item
 * names stay English on purpose, so "Storm Of Wrath" and "Box of Ammo" must not
 * trip it — which rules out "of" and every other word a name might contain.
 */
const ENGLISH_TELLS = [
  'the', 'with', 'your', 'you', 'already', 'nothing', 'every', 'needs',
  'missing', 'slots', 'level to', 'rank up', 'steps left',
];

/*
 * Text the app does not own, and must not be judged for.
 *
 * Unit, faction, ability and item names stay English deliberately — "The
 * Phoenix Ascendant" is what the player's own game calls it. Trait and ability
 * descriptions come verbatim from the game data, which publishes only English.
 * And a shell command is a shell command. Each of these is read off the page by
 * the class it renders under, so the scan looks only at what the app wrote.
 */
const NOT_OURS = '.item-name, .name, .unit-name, .desc, .cmd, .use-unit, .card-title-cell';
const leaks = new Map();
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

  if (LANG === 'pt') {
    const text = await page.evaluate((skip) => {
      // Clone so the page itself is untouched, then drop the parts whose words
      // belong to the game rather than to the app.
      const copy = document.body.cloneNode(true);
      for (const el of copy.querySelectorAll(skip)) el.remove();
      return copy.innerText;
    }, NOT_OURS);
    for (const tell of ENGLISH_TELLS) {
      const re = new RegExp(`(^|[^\\p{L}])${tell}([^\\p{L}]|$)`, 'iu');
      if (!re.test(text)) continue;
      // Report the phrase around it, so a finding names something findable.
      const at = text.search(new RegExp(`(^|[^\\p{L}])${tell}([^\\p{L}]|$)`, 'iu'));
      const snippet = text.slice(Math.max(0, at - 40), at + 60).replace(/\s+/g, ' ').trim();
      const list = leaks.get(name) ?? [];
      list.push(`"${tell}" in …${snippet}…`);
      leaks.set(name, list);
    }
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
if (LANG === 'pt') {
  const total = [...leaks.values()].reduce((n, l) => n + l.length, 0);
  if (total === 0) {
    console.log('no English left on the Portuguese pages');
  } else {
    console.log(`\n${total} English phrase(s) still showing in Portuguese:`);
    for (const [route, found] of leaks) {
      for (const one of found.slice(0, 3)) console.log(`  ${route}: ${one}`);
    }
  }
}
if (broken.length > 0) {
  console.error(`${broken.length} route(s) never rendered: ${broken.join(', ')} — build with BASE_PATH set to match the deploy path`);
}

await browser.close();
server.close();

// A page that scrolls sideways is a defect, not a note, so this exits non-zero.
const leaked = [...leaks.values()].reduce((n, l) => n + l.length, 0);
process.exit(bad.length === 0 && broken.length === 0 && leaked === 0 ? 0 : 1);
