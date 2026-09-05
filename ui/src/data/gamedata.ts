/**
 * Loads the game-database snapshot that ships with the bundle.
 *
 * The database is built in Node (`scripts/snapshot-gamedata.mjs`) and served as
 * a static file, so the app needs no server and no runtime API access.
 */

import { GAME_DATABASE_SCHEMA_VERSION } from '@lib/gamedata/types.js';
import type { GameDatabase } from '@lib/gamedata/types.js';

import { t } from '../i18n/locale.ts';

let pending: Promise<GameDatabase> | undefined;

/**
 * Fetch the snapshot once per session and memoise it.
 *
 * The file name carries no content hash, so a browser will happily serve the
 * copy it cached from the previous deploy against freshly deployed code. When
 * the schema has moved on, that pairing crashes wherever the new code reads a
 * section the old snapshot does not have. Two defences:
 *
 * - The schema version rides in the query string, so the URL itself changes
 *   whenever the shape does and a stale entry can never match.
 * - The version is checked on arrival, so a mismatch that slips through — a
 *   proxy ignoring the query, a service worker — is reported here rather than
 *   surfacing as `undefined is not an object` deep inside a component.
 */
export function loadGameData(): Promise<GameDatabase> {
  pending ??= (async () => {
    const url = `${import.meta.env.BASE_URL}gamedata.json?v=${GAME_DATABASE_SCHEMA_VERSION}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(t('err.gamedataLoad', { status: response.status }));
    }

    const db = (await response.json()) as GameDatabase;
    if (db.schemaVersion !== GAME_DATABASE_SCHEMA_VERSION) {
      throw new Error(
        t('err.schemaMismatch', {
          have: db.schemaVersion,
          want: GAME_DATABASE_SCHEMA_VERSION,
        }),
      );
    }
    return db;
  })();
  return pending;
}
