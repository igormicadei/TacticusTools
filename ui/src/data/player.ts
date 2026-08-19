/**
 * Player data storage.
 *
 * The Tacticus API sends no CORS headers — a preflight from a browser origin is
 * answered `403 Invalid CORS request` — so a static page cannot fetch a roster
 * directly. The user supplies their `/api/v1/player` response instead and it is
 * kept in `localStorage`.
 *
 * {@link PlayerSource} keeps that decision in one place: if the roster ever
 * becomes reachable from a browser (an API change, or a proxy the user runs),
 * an HTTP-backed source slots in without touching the views.
 */

import type { PlayerResponse } from '@lib/types/player.js';

const STORAGE_KEY = 'tacticus-tools:player';

export interface PlayerSource {
  read(): PlayerResponse | undefined;
  write(response: PlayerResponse): void;
  clear(): void;
}

/** Thrown when imported text is not a usable player payload. */
export class InvalidPlayerDataError extends Error {}

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

  const body = parsed as Partial<PlayerResponse>;
  const player = body?.player;
  if (!player || typeof player !== 'object') {
    throw new InvalidPlayerDataError(
      'No "player" object found. Paste the whole response from /api/v1/player.',
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

export const localPlayerSource: PlayerSource = {
  read() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as PlayerResponse;
    } catch {
      // A corrupt entry should behave as "not imported yet", not crash the app.
      localStorage.removeItem(STORAGE_KEY);
      return undefined;
    }
  },
  write(response) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(response));
  },
  clear() {
    localStorage.removeItem(STORAGE_KEY);
  },
};
