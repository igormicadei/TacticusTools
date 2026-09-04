/**
 * Does the app tell the three relay failures apart?
 *
 * The interesting one is Cloudflare's 1027: an edge error with no CORS headers,
 * which reaches the page as the same opaque TypeError as "no such host". This
 * stands up a fake relay that reproduces each shape exactly and reads back what
 * the app decided to say.
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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };
const app = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(BASE)) return res.writeHead(404).end('nope');
  path = path.slice(BASE.length) || 'index.html';
  try { const b = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(200, { 'content-type': 'text/html' }); res.end(await readFile(join(ROOT, 'index.html'))); }
});
await new Promise((r) => app.listen(8194, r));

// The fake relay. `mode` decides which failure it acts out.
let mode = 'edge-1027';
const relay = createServer((req, res) => {
  if (mode === 'edge-1027') {
    // Exactly Cloudflare's shape: a real reply, HTML, and no CORS headers.
    res.writeHead(429, { 'content-type': 'text/html' });
    res.end('<html><body>Error 1027 — daily request limit exceeded</body></html>');
    return;
  }
  if (mode === 'ok') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify({ player: { units: [], inventory: { shards: [], upgrades: [], items: [] } } }));
    return;
  }
  res.destroy();
});
await new Promise((r) => relay.listen(8193, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
await page.goto(`http://127.0.0.1:8194${BASE}`);
await page.evaluate(() => {
  localStorage.setItem('tacticus-tools:apiKey', 'test-key');
  localStorage.setItem('tacticus-tools:relay', 'http://127.0.0.1:8193');
});

const problems = [];
const cases = [
  // The reply must name the limit and the reset, and must not read as breakage.
  ['over daily limit (answers, no CORS)', 'edge-1027', /daily request limit|100,000 a day/i, /00:00 UTC/],
  // And the genuinely-unreachable case must not blame the limit for it.
  ['relay gone (nothing answers)', 'dead', /Nothing answered at all/i, /^(?!.*daily request limit).*$/s],
];
for (const [label, m, ...expected] of cases) {
  mode = m;
  await page.goto(`http://127.0.0.1:8194${BASE}#/player`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Fetch roster|Refresh roster/ }).first().click();
  await page.waitForTimeout(2500);
  const msg = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.error, .warn, .empty, p, div')]
      .map((e) => e.textContent?.trim() ?? '')
      .find((t) => /relay|browser blocked|Could not reach/i.test(t) && t.length < 700);
    return el ?? '(no message found)';
  });
  console.log(`\n--- ${label} ---\n${msg}\n`);
  for (const pattern of expected) {
    if (!pattern.test(msg)) problems.push(`${label}: message did not match ${pattern}`);
  }
}

// Turn the relay healthy again: the fake payload is not a real roster, so the
// app should now fail on the data rather than on the network.
mode = 'ok';
await page.goto(`http://127.0.0.1:8194${BASE}#/player`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Fetch roster|Refresh roster/ }).first().click();
await page.waitForTimeout(2500);
console.log('--- relay healthy (reaches the data layer) ---');
console.log(await page.evaluate(() => {
  const t = [...document.querySelectorAll('p, div')].map((e) => e.textContent?.trim() ?? '')
    .find((x) => /units|inventory|player|roster/i.test(x) && x.length < 300);
  return t ?? '(no message)';
}));

await browser.close(); app.close(); relay.close();

if (problems.length > 0) {
  console.log(`\n\u2717 ${problems.length} problem(s):`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('\n\u2713 the three relay failures are told apart and explained');
process.exit(0);
