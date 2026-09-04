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
  plugins: [react(), publishRelaySource()],
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
