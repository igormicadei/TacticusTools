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
  fetchedAt: 'tacticus-tools:fetchedAt',
} as const;

/** Path of the roster endpoint, appended to the relay's base URL. */
export const PLAYER_PATH = '/api/v1/player';

/** Direct API origin. Reachable from Node or a relay, never from a browser page. */
export const TACTICUS_API_ORIGIN = 'https://api.tacticusgame.com';

/**
 * The relay the app talks to, baked in at build time from `VITE_DEFAULT_RELAY`.
 *
 * There is no field for this any more: a fresh browser needs only the Tacticus
 * key, which is the whole point. Publishing the URL is the cost, and it buys
 * less for an attacker than it looks — the relay carries no key of its own, so
 * a stranger reaching it still needs their own Tacticus key to get anything,
 * and gets their own account when they do. The origin allowlist keeps other
 * websites out. What is genuinely spendable is the request allowance.
 *
 * A value in storage still wins, which is the escape hatch: point a browser at
 * a local relay, or at a replacement if this URL ever changes, without a
 * rebuild. Nothing in the UI writes it — set it from the console.
 */
export const DEFAULT_RELAY_URL = (import.meta.env['VITE_DEFAULT_RELAY'] ?? '')
  .trim()
  .replace(/\/+$/, '');


export interface Credentials {
  apiKey: string | undefined;
  /** Base URL of a relay, e.g. `https://tacticus-relay.someone.workers.dev`. */
  relayUrl: string | undefined;
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
    };
  },
  writeCredentials({ apiKey, relayUrl }: Credentials): void {
    write(KEYS.apiKey, apiKey?.trim());
    // Trailing slashes would double up against PLAYER_PATH.
    write(KEYS.relay, relayUrl?.trim().replace(/\/+$/, ''));
  },
  clearCredentials(): void {
    write(KEYS.apiKey, undefined);
    write(KEYS.relay, undefined);
    // Written by an older build that had a relay-key field. Cleared here so
    // "forget" means forgotten rather than "forgotten except for that".
    write('tacticus-tools:relayKey', undefined);
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
 * Hours until the Workers free plan resets, which it does at 00:00 UTC.
 *
 * Rounded up, and never below one: "wait 0 hours" reads as a bug when the
 * thing is plainly still refusing to answer.
 */
function hoursUntilUtcMidnight(now = new Date()): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - now.getTime()) / 3_600_000));
}

/**
 * Tell "the relay answered but the browser would not show us" from "nothing
 * answered at all".
 *
 * When a Workers account passes its daily free-tier allowance, Cloudflare
 * serves its own 1027 page from the edge — before the worker runs, and so
 * without any of the CORS headers the worker would have added. The browser
 * therefore refuses to hand the response to the page, and `fetch` rejects with
 * the same opaque TypeError it throws for a bad hostname or no network. Three
 * quite different problems, one indistinguishable symptom, and the advice for
 * each is different.
 *
 * A `no-cors` request separates them. It cannot read the reply — that is the
 * point of the mode — but it resolves whenever something replied, and rejects
 * when nothing did. So: main request failed, probe succeeded, means a server is
 * there and answering without CORS headers, which for this relay means the edge
 * turned it away rather than the worker handling it.
 *
 * Not proof. A worker that throws before returning gives the same shape, and so
 * would an unrelated proxy in front of it. The message below says the likely
 * cause and leaves room for the other one rather than asserting a diagnosis.
 */
async function relayAnsweredWithoutCors(base: string): Promise<boolean> {
  try {
    await fetch(`${base}/health`, { mode: 'no-cors', cache: 'no-store' });
    return true;
  } catch {
    return false;
  }
}

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
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
    });
  } catch {
    if (direct) {
      throw new PlayerFetchError(
        'The browser blocked the request. This is a browser rule, not a limit on your ' +
          'machine — the API sends no CORS headers, so a page cannot read its reply. Run ' +
          '`node relay/local-relay.mjs` and set http://localhost:8787 as the relay URL.',
      );
    }
    // Something is there, answering without CORS headers: on a Cloudflare relay
    // that is what running out of the day's free requests looks like from here.
    if (await relayAnsweredWithoutCors(base)) {
      throw new PlayerFetchError(
        `The relay answered, but not in a way the browser will show a page. The usual ` +
          `cause is the free hosting tier's daily request limit — Cloudflare Workers ` +
          `allow 100,000 a day and then serve their own error page until the count ` +
          `resets at 00:00 UTC, about ${hoursUntilUtcMidnight()}h from now. Nothing is ` +
          `broken and nothing is being charged; it starts working again on its own. ` +
          `If it is still refusing after the reset, open ${base}/health in a browser — ` +
          `a relay that is running answers there with a small JSON object.`,
      );
    }
    throw new PlayerFetchError(
      `Could not reach the relay at ${base}. Nothing answered at all, so check the URL, ` +
        `your connection, and that the relay is still deployed.`,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { type?: string; detail?: string }
      | undefined;

    // The relay explains its own refusals; pass that through rather than
    // reporting a generic failure the user cannot act on.
    if (body?.type === 'RELAY_KEY_INVALID') {
      // The app stopped sending a relay key, so this means the Worker still has
      // RELAY_KEY set. Say that, since the fix is one variable in a dashboard
      // and the relay's own wording ("set it on the Player data page") now
      // points at a field that no longer exists.
      throw new PlayerFetchError(
        'The relay still requires a relay key, but this app no longer sends one. ' +
          'Delete the RELAY_KEY variable on the Worker (Settings → Variables) and ' +
          'it will start answering again.',
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
