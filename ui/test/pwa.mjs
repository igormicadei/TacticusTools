/**
 * Checks the app is actually installable, and that the worker serves it offline.
 *
 * Reading the manifest is not enough: the browser has its own opinion, and the
 * failure mode when it disagrees is silence — no prompt, no error, nothing to
 * see. So this drives a real Chromium, waits for the worker to control the
 * page, then cuts the network and asks for the app again.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const { chromium } = createRequire(join(HERE, '..', 'package.json'))('playwright');

const ROOT = process.env.DIST ?? join(HERE, '..', 'dist');
const INDEX = await readFile(join(ROOT, 'index.html'), 'utf8');
const BASE = INDEX.match(/(?:src|href)="(\/[^"]*\/)assets\//)?.[1] ?? '/';
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

/** Lets the test stand in a second build, to prove a redeploy reaches the user. */
let overrides = new Map();

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(BASE)) return res.writeHead(404).end('nope');
  path = path.slice(BASE.length) || 'index.html';
  try {
    const body = overrides.get(path) ?? (await readFile(join(ROOT, path)));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(await readFile(join(ROOT, 'index.html')));
  }
});
await new Promise((r) => server.listen(8189, r));

const problems = [];
const check = (ok, what) => { console.log(`${ok ? '  ok  ' : '  FAIL'}  ${what}`); if (!ok) problems.push(what); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
await page.goto(`http://127.0.0.1:8189${BASE}`, { waitUntil: 'load' });

/* ---- the manifest the browser actually resolved ------------------------- */
const manifestHref = await page.getAttribute('link[rel=manifest]', 'href');
check(!!manifestHref, 'the page links a manifest');
const manifest = await page.evaluate(async (href) => {
  const r = await fetch(href);
  return r.ok ? r.json() : undefined;
}, manifestHref);

check(!!manifest?.name, 'manifest has a name');
check(!!manifest?.short_name, 'manifest has a short_name');
check(!!manifest?.start_url, 'manifest has a start_url');
check(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest?.display), `display is app-like (${manifest?.display})`);
check(!!manifest?.background_color && !!manifest?.theme_color, 'manifest sets background and theme colours');
// The two sizes Chrome insists on, and a maskable so Android does not letterbox.
const sizes = (manifest?.icons ?? []).map((i) => i.sizes);
check(sizes.includes('192x192'), 'a 192x192 icon is declared');
check(sizes.includes('512x512'), 'a 512x512 icon is declared');
check((manifest?.icons ?? []).some((i) => (i.purpose ?? '').includes('maskable')), 'a maskable icon is declared');
// The scope has to contain the start_url or the install is refused.
check(
  manifest?.start_url?.startsWith(manifest?.scope ?? '\0'),
  `scope ${manifest?.scope} contains start_url ${manifest?.start_url}`,
);

/* ---- every declared icon really resolves -------------------------------- */
for (const icon of manifest?.icons ?? []) {
  const status = await page.evaluate(async (src) => (await fetch(src)).status, icon.src);
  check(status === 200, `${icon.src} serves (HTTP ${status})`);
}
const appleHref = await page.getAttribute('link[rel=apple-touch-icon]', 'href');
check(!!appleHref, 'an apple-touch-icon is linked');
if (appleHref) {
  const status = await page.evaluate(async (src) => (await fetch(src)).status, appleHref);
  check(status === 200, `apple-touch-icon serves (HTTP ${status})`);
}
check(!!(await page.getAttribute('meta[name=theme-color]', 'content')), 'theme-color meta is present');
check(!!(await page.getAttribute('meta[name=apple-mobile-web-app-capable]', 'content')), 'iOS standalone meta is present');

/* ---- the service worker, which is the part Chrome will not install without */
// `serviceWorker.ready` never settles when there is no registration, and
// `page.evaluate` has no timeout of its own — so an unregistered worker would
// hang this run rather than fail it. Bounded here so the failure is a report.
const controlled = await page.evaluate(async () => {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(undefined), 15000));
  const reg = await Promise.race([navigator.serviceWorker.ready, timeout]);
  const all = await navigator.serviceWorker.getRegistrations();
  return {
    ready: !!reg,
    scope: reg?.scope,
    active: !!reg?.active,
    registrations: all.map((r) => ({ scope: r.scope, state: r.active?.state ?? 'none' })),
  };
});
if (!controlled.ready) {
  console.log('    registrations seen:', JSON.stringify(controlled.registrations));
  // The app swallows registration failures on purpose, so ask again here and
  // report what it says rather than guessing at the reason.
  const why = await page.evaluate(async (base) => {
    try {
      const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
      return `registered: ${reg.scope}`;
    } catch (e) {
      return `register threw: ${String(e)}`;
    }
  }, BASE);
  console.log('    ', why);
  const swStatus = await page.evaluate(async (base) => {
    const r = await fetch(`${base}sw.js`);
    return `${r.status} ${r.headers.get('content-type')}`;
  }, BASE);
  console.log('     sw.js serves:', swStatus);
}
check(controlled.active, `a service worker is active (scope ${controlled.scope ?? 'none'})`);
// Registered is not the same as controlling: a first load registers, and only
// clients.claim puts the current page under it.
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
  .then(() => check(true, 'the worker controls the page'))
  .catch(() => check(false, 'the worker controls the page'));

/* ---- and it genuinely works with the server gone ------------------------ */
// Warm the two big unhashed files so the cache has them, as a real first visit would.
await page.evaluate(async (base) => {
  await Promise.all([fetch(`${base}gamedata.json`), fetch(`${base}icons.json`)]);
}, BASE);
await page.waitForTimeout(500);

// Playwright's own offline switch rather than killing the server: it is what
// the browser actually does on a lost connection, and a half-closed socket
// leaves a navigation hanging instead of failing.
await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
await page.waitForTimeout(3000);
const offline = await page.evaluate(() => ({
  mounted: document.querySelectorAll('.topbar').length > 0,
  nav: [...document.querySelectorAll('.topbar nav a')].map((a) => a.textContent?.trim()),
}));
check(offline.mounted, `the app still starts with the server gone (nav: ${offline.nav.join(', ')})`);

await context.setOffline(false);

/* ---- a redeploy has to reach a browser that already cached the old one --- */
/*
 * This is the failure a service worker invites: cache the shell, serve it
 * first, and every visitor is pinned to whatever build they saw first, with no
 * symptom except that fixes never arrive. The shell is fetched network-first
 * for exactly this reason, so standing in a new index.html and reloading must
 * produce the new one.
 */
overrides.set(
  'index.html',
  INDEX.replace('<div id="root"></div>', '<div id="root"></div><!--REDEPLOYED-->'),
);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const fresh = await page.evaluate(() => document.documentElement.innerHTML.includes('REDEPLOYED'));
check(fresh, 'a new build reaches a browser holding the old one in cache');

await browser.close();
server.close();

if (problems.length > 0) {
  console.log(`\n✗ ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('\n✓ installable, and works offline');
process.exit(0);
