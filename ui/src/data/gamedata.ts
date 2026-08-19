/**
 * Loads the game-database snapshot that ships with the bundle.
 *
 * The database is built in Node (`scripts/snapshot-gamedata.mjs`) and served as
 * a static file, so the app needs no server and no runtime API access.
 */

import type { GameDatabase } from '@lib/gamedata/types.js';

let pending: Promise<GameDatabase> | undefined;

/** Fetch the snapshot once per session and memoise it. */
export function loadGameData(): Promise<GameDatabase> {
  pending ??= (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}gamedata.json`);
    if (!response.ok) {
      throw new Error(
        `Could not load gamedata.json (HTTP ${response.status}). ` +
          'Run `npm run gamedata:snapshot` from the repository root.',
      );
    }
    return (await response.json()) as GameDatabase;
  })();
  return pending;
}
