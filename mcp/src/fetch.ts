/**
 * Getting a fresh roster out of the Tacticus API.
 *
 * The web app has to send this through a relay: the API sends no CORS headers,
 * so a browser refuses to read the reply. Nothing here is a browser, so the
 * call goes straight to the API and a relay is only used when one is
 * configured — someone pointing this at their own Worker should not have it
 * ignored.
 */

import { apiKey, relayUrl } from './store.js';

const TACTICUS_API = 'https://api.tacticusgame.com';
const PLAYER_PATH = '/api/v1/player';

export async function fetchPlayerText(): Promise<string> {
  const key = apiKey();
  const base = relayUrl() ?? TACTICUS_API;

  let response: Response;
  try {
    response = await fetch(`${base}${PLAYER_PATH}`, {
      headers: { 'X-API-KEY': key, Accept: 'application/json' },
    });
  } catch (error) {
    throw new Error(
      `Could not reach ${base}. ${base === TACTICUS_API ? 'Check the network.' : 'Check TACTICUS_RELAY_URL.'} (${String(error)})`,
    );
  }

  if (!response.ok) {
    const body = (await response
      .text()
      .then((text) => JSON.parse(text) as { type?: string; detail?: string })
      .catch(() => undefined));
    if (response.status === 403) {
      throw new Error(
        'The API rejected that key (403). Check TACTICUS_API_KEY, and that it carries the Player scope.',
      );
    }
    throw new Error(
      `The request failed (${response.status})` +
        (body?.type ? ` (${body.type})` : '') +
        (body?.detail ? ` — ${body.detail}` : ''),
    );
  }

  const text = await response.text();
  // Store nothing that is not a roster: a relay's error page written over the
  // stored file would leave every later call failing to parse it.
  let parsed: { player?: { units?: unknown } };
  try {
    parsed = JSON.parse(text) as { player?: { units?: unknown } };
  } catch {
    throw new Error(`${base} answered with something that is not JSON.`);
  }
  if (!Array.isArray(parsed.player?.units)) {
    throw new Error(`${base} answered without a player.units array — that is not a roster.`);
  }
  return text;
}
