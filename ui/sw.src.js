/**
 * Offline support, and the fetch handler Chrome requires before it will offer
 * to install the app.
 *
 * The trap this is written to avoid is the well-known one: a service worker
 * that serves its cache first for everything pins the user to whatever build
 * they first visited, forever, with no symptom except that fixes never arrive.
 * So the strategy is split by what the URL actually promises.
 *
 * - Assets under `assets/` carry a content hash in the filename. The name
 *   changes whenever the bytes do, so they can be cached forever and served
 *   from cache without a network round trip.
 * - Everything else — the HTML shell, `gamedata.json`, `icons.json` — keeps its
 *   name across deploys, so the network is asked first and the cache is only
 *   the fallback. Online, that means always current; offline, it still works.
 *
 * The cache name carries the build stamp, so a new deploy starts from an empty
 * cache and the old one is deleted on activate rather than lingering.
 *
 * This file is served verbatim from `public/`, so it cannot be given the
 * BASE_PATH at build time and works out its own scope from where it was
 * loaded — which is what the browser uses for the registration anyway.
 */

const BASE = new URL('./', self.location.href).pathname;

/** Both replaced at build time. */
const BUILD = '__BUILD_STAMP__';
/**
 * The bundle's own hashed filenames, which only the build knows.
 *
 * Declared after BASE, and it has to stay that way: the injected list is a
 * template literal reading BASE, so hoisting this above it puts BASE in its
 * temporal dead zone and the whole worker fails to evaluate. The browser
 * reports that as "ServiceWorker script evaluation failed" and then simply
 * never offers to install the app — no console error on the page, nothing.
 */
const ASSETS = __PRECACHE__;
const CACHE = `tacticus-tools-${BUILD}`;

/**
 * The least that has to be present for the app to start with no network.
 *
 * The hashed assets have to be named here rather than left to the fetch
 * handler to pick up. On a first visit the page has already requested its own
 * script and stylesheet by the time this worker registers, so those requests
 * never pass through it and nothing caches them — the app would then look
 * installable, install, and fail to start on the first flight. Naming them at
 * build time is the only way this worker can know what they are called.
 *
 * The game database is deliberately *not* here: 3 MB would turn installing
 * into a long silent download on mobile data. It lands in the cache the first
 * time the app asks for it, which is the first time it is opened.
 */
const SHELL = [BASE, `${BASE}index.html`, `${BASE}manifest.webmanifest`, ...ASSETS];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually, so one 404 cannot fail the whole install.
      await Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => undefined)),
      );
      // Take over as soon as the new build is ready. Paired with clients.claim
      // below this is what stops a fix from waiting for every tab to close.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('tacticus-tools-') && name !== CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

/** Content-hashed by the bundler: the name is a promise that the bytes are fixed. */
const immutable = (url) => url.pathname.startsWith(`${BASE}assets/`);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only GET, and only this app: a POST is not cacheable and another origin's
  // response is not ours to keep.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  if (immutable(url)) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  // Everything else: network first, cache as the fallback.
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
        return response;
      } catch {
        const hit = await caches.match(request);
        if (hit) return hit;
        // A navigation that misses still has somewhere to go: the shell, which
        // is what a hash-routed app needs for any route anyway.
        if (request.mode === 'navigate') {
          const shell = await caches.match(`${BASE}index.html`);
          if (shell) return shell;
        }
        throw new Error('offline and not cached');
      }
    })(),
  );
});
