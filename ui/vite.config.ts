import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The app is a fully static bundle: no server at runtime, no API calls at
 * runtime. The game database ships as `public/gamedata.json` and player data is
 * imported by the user, so the build works unchanged on GitHub Pages.
 *
 * `BASE_PATH` sets the deploy sub-path (GitHub Pages serves project sites from
 * `/<repo>/`). Default `/` keeps `npm run dev` and root deploys working.
 */
export default defineConfig({
  base: process.env['BASE_PATH'] ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      // Domain types and enum helpers are shared with the Node library rather
      // than duplicated. Type imports erase; the helpers are small pure functions.
      '@lib': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
