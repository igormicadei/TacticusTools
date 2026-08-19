import { copyFileSync } from 'node:fs';
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
  build: { outDir: 'dist', sourcemap: true },
});
