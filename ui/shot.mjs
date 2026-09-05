import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';
const ROOT = 'dist';
const INDEX = await readFile(join(ROOT, 'index.html'), 'utf8');
const BASE = INDEX.match(/(?:src|href)="(\/[^"]*\/)assets\//)?.[1] ?? '/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const app = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(BASE)) return res.writeHead(404).end('nope');
  path = path.slice(BASE.length) || 'index.html';
  try { const b = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(200, { 'content-type': 'text/html' }); res.end(await readFile(join(ROOT, 'index.html'))); }
});
await new Promise((r) => app.listen(8184, r));
await mkdir('.crops', { recursive: true });
const player = await readFile('../player.json', 'utf8');
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--disable-background-networking'], ...(proxy ? { proxy } : {}) });
const page = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
const cache = new Map();
await page.route('https://www.tacticuscodex.com/**', async (route) => {
  const url = route.request().url();
  if (!cache.has(url)) cache.set(url, fetch(url).then(async (r) => ({ status: r.status, type: r.headers.get('content-type') ?? 'image/png', body: Buffer.from(await r.arrayBuffer()) })).catch(() => undefined));
  const hit = await cache.get(url);
  if (!hit) return route.abort();
  await route.fulfill({ status: hit.status, contentType: hit.type, body: hit.body });
});
await page.goto(`http://127.0.0.1:8184${BASE}`);
await page.evaluate(([p, lang]) => {
  localStorage.setItem('tacticus-tools:player', p);
  localStorage.setItem('tacticus-tools:fetchedAt', String(Date.now()));
  localStorage.setItem('tacticus-tools:lang', lang);
}, [player, process.env.LANG_UNDER_TEST ?? 'en']);
await page.goto(`http://127.0.0.1:8184${BASE}#/plans`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /New plan|Novo plano/ }).first().click();
await page.waitForTimeout(1200);
// Pick a star rung and see what the preview says.
const starSelect = page.locator('label', { hasText: /^Stars|^Estrelas/ }).locator('select');
const options = await starSelect.locator('option').allTextContents();
console.log('star options:', options.slice(0, 6).join(' | '));
await starSelect.selectOption({ index: 1 });
await page.waitForTimeout(1200);
await page.screenshot({ path: '.crops/form.png', fullPage: true });
console.log('form text:', (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').slice(0, 700));
await browser.close(); app.close();
