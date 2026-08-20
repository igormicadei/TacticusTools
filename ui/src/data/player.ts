/**
 * Player data: credentials, storage and fetching.
 *
 * The app keeps the API key in the browser and fetches the roster itself. It
 * cannot call the game API directly, though — measured against the live service,
 * a preflight from any origin is answered `403 Invalid CORS request`, no
 * `access-control-allow-origin` is sent, and the key is accepted only as the
 * `X-API-KEY` header, which is what forces the preflight. A relay under the
 * user's control closes that gap; see `relay/` in the repository.
 *
 * Everything is stored in `localStorage`: the key, the relay URL, and the last
 * roster fetched, so the app works offline and across reloads.
 */

import type { PlayerResponse } from '@lib/types/player.js';

const KEYS = {
  player: 'tacticus-tools:player',
  apiKey: 'tacticus-tools:apiKey',
  relay: 'tacticus-tools:relay',
  relayKey: 'tacticus-tools:relayKey',
  fetchedAt: 'tacticus-tools:fetchedAt',
} as const;

/** Path of the roster endpoint, appended to the relay's base URL. */
export const PLAYER_PATH = '/api/v1/player';

/** Direct API origin. Reachable from Node or a relay, never from a browser page. */
export const TACTICUS_API_ORIGIN = 'https://api.tacticusgame.com';

/**
 * Relay used when the user has not set one.
 *
 * Baked in at build time from `VITE_DEFAULT_RELAY` so a fresh browser — a phone,
 * a cleared cache — needs only the API key. An explicitly saved relay always
 * wins over this.
 */
export const DEFAULT_RELAY_URL = (import.meta.env['VITE_DEFAULT_RELAY'] ?? '')
  .trim()
  .replace(/\/+$/, '');

export interface Credentials {
  apiKey: string | undefined;
  /** Base URL of a relay, e.g. `https://tacticus-relay.someone.workers.dev`. */
  relayUrl: string | undefined;
  /**
   * The relay's own secret, when it requires one. Distinct from the Tacticus
   * key: this one only proves you are allowed to use the relay.
   *
   * Never baked into the build — it would be readable by anyone loading the
   * public page, which is the opposite of what it is for.
   */
  relayKey: string | undefined;
}

/** Thrown when imported or fetched data is not a usable player payload. */
export class InvalidPlayerDataError extends Error {}

/** Thrown when a fetch fails, with a message aimed at the person reading it. */
export class PlayerFetchError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'PlayerFetchError';
    this.status = status;
  }
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                    */
/* -------------------------------------------------------------------------- */

const read = (key: string): string | undefined => localStorage.getItem(key) ?? undefined;

const write = (key: string, value: string | undefined): void => {
  if (value === undefined || value === '') localStorage.removeItem(key);
  else localStorage.setItem(key, value);
};

export const storage = {
  readCredentials(): Credentials {
    return {
      apiKey: read(KEYS.apiKey),
      relayUrl: read(KEYS.relay) ?? (DEFAULT_RELAY_URL || undefined),
      relayKey: read(KEYS.relayKey),
    };
  },
  writeCredentials({ apiKey, relayUrl, relayKey }: Credentials): void {
    write(KEYS.apiKey, apiKey?.trim());
    // Trailing slashes would double up against PLAYER_PATH.
    write(KEYS.relay, relayUrl?.trim().replace(/\/+$/, ''));
    write(KEYS.relayKey, relayKey?.trim());
  },
  clearCredentials(): void {
    write(KEYS.apiKey, undefined);
    write(KEYS.relay, undefined);
    write(KEYS.relayKey, undefined);
  },
  readPlayer(): PlayerResponse | undefined {
    const raw = read(KEYS.player);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as PlayerResponse;
    } catch {
      // A corrupt entry should read as "nothing stored", not crash the app.
      write(KEYS.player, undefined);
      return undefined;
    }
  },
  writePlayer(response: PlayerResponse): void {
    write(KEYS.player, JSON.stringify(response));
    write(KEYS.fetchedAt, String(Date.now()));
  },
  clearPlayer(): void {
    write(KEYS.player, undefined);
    write(KEYS.fetchedAt, undefined);
  },
  readFetchedAt(): number | undefined {
    const raw = read(KEYS.fetchedAt);
    const value = raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : undefined;
  },
};

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Validate the parts the views rely on.
 *
 * Deliberately shallow: enough to reject the wrong file or a truncated paste
 * with a clear message, without duplicating the library's response validator.
 */
export function parsePlayerResponse(text: string): PlayerResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidPlayerDataError('That is not valid JSON.');
  }
  return assertPlayerResponse(parsed);
}

export function assertPlayerResponse(value: unknown): PlayerResponse {
  const body = value as Partial<PlayerResponse>;
  const player = body?.player;
  if (!player || typeof player !== 'object') {
    throw new InvalidPlayerDataError(
      'No "player" object found — expected the response from /api/v1/player.',
    );
  }
  if (!Array.isArray(player.units)) {
    throw new InvalidPlayerDataError('The "player" object has no "units" array.');
  }
  if (!player.inventory || !Array.isArray(player.inventory.shards)) {
    throw new InvalidPlayerDataError('The "player" object has no inventory shards.');
  }
  return body as PlayerResponse;
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Fetch the roster using the stored key.
 *
 * With no relay configured this calls the API directly, which a browser will
 * block; the failure is reported with the reason rather than a bare network
 * error. It is still attempted so the app starts working on its own if the API
 * ever begins sending CORS headers.
 */
export async function fetchPlayer(credentials: Credentials): Promise<PlayerResponse> {
  const apiKey = credentials.apiKey?.trim();
  if (!apiKey) throw new PlayerFetchError('No API key saved.');

  const base = credentials.relayUrl?.trim().replace(/\/+$/, '') || TACTICUS_API_ORIGIN;
  const direct = base === TACTICUS_API_ORIGIN;

  let response: Response;
  try {
    response = await fetch(`${base}${PLAYER_PATH}`, {
      // The whole point of a refresh is to reach the game, so no cache — the
      // browser's, a proxy's, or a service worker's — may answer for it.
      cache: 'no-store',
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json',
        ...(credentials.relayKey?.trim()
          ? { 'X-Relay-Key': credentials.relayKey.trim() }
          : {}),
      },
    });
  } catch {
    throw new PlayerFetchError(
      direct
        ? 'The browser blocked the request. This is a browser rule, not a limit on your ' +
          'machine — the API sends no CORS headers, so a page cannot read its reply. Run ' +
          '`node relay/local-relay.mjs` and set http://localhost:8787 as the relay URL.'
        : `Could not reach the relay at ${base}. Check the URL, and that the relay is running.`,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { type?: string; detail?: string }
      | undefined;

    // The relay explains its own refusals; pass that through rather than
    // reporting a generic failure the user cannot act on.
    if (body?.type === 'RELAY_KEY_INVALID') {
      throw new PlayerFetchError(
        body.detail ?? 'The relay rejected the relay key.',
        response.status,
      );
    }
    if (body?.type === 'ORIGIN_NOT_ALLOWED') {
      throw new PlayerFetchError(
        body.detail ?? 'The relay refused this site. Add this origin to its allowed list.',
        response.status,
      );
    }
    if (response.status === 403) {
      throw new PlayerFetchError(
        'The API rejected that key (403). Check it, and that it has the Player scope.',
        403,
      );
    }
    throw new PlayerFetchError(
      `Request failed: HTTP ${response.status}` +
        (body?.type ? ` (${body.type})` : '') +
        (body?.detail ? ` — ${body.detail}` : '') +
        '.',
      response.status,
    );
  }

  return assertPlayerResponse(await response.json());
}
