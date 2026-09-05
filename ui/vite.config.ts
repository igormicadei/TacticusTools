import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Publish the relay worker alongside the app.
 *
 * Setting the relay up from a phone means copying its source out of the repo,
 * which is painful in a mobile browser. Serving it from the deployed site lets
 * the Player data page offer it with a copy button. Copied at build time rather
 * than committed twice, so the two cannot drift.
 */
function publishRelaySource(): Plugin {
  return {
    name: 'publish-relay-source',
    buildStart() {
      copyFileSync(
        fileURLToPath(new URL('../relay/cloudflare-worker.js', import.meta.url)),
        fileURLToPath(new URL('./public/cloudflare-worker.js', import.meta.url)),
      );
    },
  };
}

/**
 * Stamp the service worker with this build's identity.
 *
 * The stamp names the cache, so a deploy starts from an empty one and the
 * previous cache is deleted on activate. Without it the worker would keep
 * whatever it cached under a fixed name and serve last week's app to someone
 * who has done nothing wrong.
 *
 * Derived from the bundle's own contents rather than the clock, so rebuilding
 * without changing anything does not needlessly evict a good cache.
 */
function stampServiceWorker(): Plugin {
  return {
    name: 'stamp-service-worker',
    generateBundle(_options, bundle) {
      // Read from `sw.src.js`, not `public/`: anything in `public/` is copied
      // to the output verbatim, which would put an unstamped copy alongside
      // the stamped one and leave which of them wins to file ordering.
      const source = readFileSync(
        fileURLToPath(new URL('./sw.src.js', import.meta.url)),
        'utf8',
      );
      const emitted = Object.keys(bundle).sort();
      const fingerprint = createHash('sha256')
        .update(emitted.join('\n'))
        .update(source)
        .digest('hex')
        .slice(0, 12);
      // Only what the page needs to start: the entry script and stylesheet.
      // Sourcemaps are stripped from the deploy anyway, and precaching them
      // would double the install for something no visitor reads.
      const precache = emitted
        .filter((name) => /^assets\/.*\.(js|css)$/.test(name))
        .map((name) => `\${BASE}${name}`);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: source
          .replace('__BUILD_STAMP__', fingerprint)
          .replace('__PRECACHE__', `[${precache.map((p) => `\`${p}\``).join(', ')}]`),
      });
    },
  };
}

/**
 * Write the web app manifest at build time.
 *
 * It cannot be a static file in `public/`: `start_url`, `scope` and every icon
 * path depend on `BASE_PATH`, which is only known here. A manifest whose scope
 * does not match where the app is served is not merely wrong, it makes the app
 * uninstallable, and the failure is silent — the browser simply never offers.
 */
function writeManifest(base: string): Plugin {
  return {
    name: 'write-manifest',
    generateBundle() {
      const icon = (file: string, size: string, purpose?: string) => ({
        src: `${base}icons/${file}`,
        sizes: size,
        type: 'image/png',
        ...(purpose ? { purpose } : {}),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify(
          {
            name: 'Tacticus Tools',
            short_name: 'Tacticus',
            description:
              'Roster, plans, teams and upgrades for Warhammer 40,000: Tacticus.',
            // The app speaks Portuguese by default, so the install prompt and
            // the launcher entry should too.
            lang: 'pt-BR',
            dir: 'ltr',
            start_url: base,
            scope: base,
            display: 'standalone',
            orientation: 'portrait',
            // Matches the app background, so the splash screen does not flash
            // white before the first paint.
            background_color: '#0a1220',
            theme_color: '#0a1220',
            categories: ['games', 'utilities'],
            icons: [
              icon('icon-192.png', '192x192', 'any'),
              icon('icon-512.png', '512x512', 'any'),
              icon('icon-maskable-512.png', '512x512', 'maskable'),
            ],
          },
          null,
          2,
        ),
      });
    },
  };
}

/**
 * A cache key for the icon manifest, derived from its own bytes.
 *
 * `icons.json` maps our names onto Codex's emitted filenames, and Codex
 * rebuilds those filenames whenever the game updates. A browser holding the
 * previous copy therefore asks for art that no longer exists: the text is fine
 * and every picture is missing, which looks like our bug and is fixed only by a
 * hard refresh the visitor has no reason to try. Hashing the file means the URL
 * changes exactly when the mapping does — not on every deploy, which would
 * throw away a good cache for nothing.
 */
function iconsVersion(): string {
  try {
    const bytes = readFileSync(fileURLToPath(new URL('./public/icons.json', import.meta.url)));
    return createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  } catch {
    return 'none';
  }
}

/**
 * The app is a fully static bundle: no server at runtime, no API calls at
 * runtime. The game database ships as `public/gamedata.json` and player data is
 * imported by the user, so the build works unchanged on GitHub Pages.
 *
 * `BASE_PATH` sets the deploy sub-path (GitHub Pages serves project sites from
 * `/<repo>/`). Default `/` keeps `npm run dev` and root deploys working.
 *
 * `VITE_DEFAULT_RELAY` bakes in a relay URL so a fresh browser needs only the
 * API key. Anything the user saves themselves takes precedence.
 */
export default defineConfig({
  base: process.env['BASE_PATH'] ?? '/',
  plugins: [
    react(),
    publishRelaySource(),
    writeManifest(process.env['BASE_PATH'] ?? '/'),
    stampServiceWorker(),
  ],
  resolve: {
    alias: {
      // Domain types and enum helpers are shared with the Node library rather
      // than duplicated. Type imports erase; the helpers are small pure functions.
      '@lib': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  define: { __ICONS_VERSION__: JSON.stringify(iconsVersion()) },
  build: { outDir: 'dist', sourcemap: true },
});
