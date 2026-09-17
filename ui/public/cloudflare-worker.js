/**
 * CORS relay for the Tacticus API — paste this whole file into a Cloudflare
 * Worker.
 *
 * The API sends no CORS headers and answers a browser preflight with
 * `403 Invalid CORS request`, so a page cannot call it directly — no origin is
 * allowlisted, and the key is only accepted as the `X-API-KEY` header, which
 * forces the preflight. This forwards the call server-side and adds the headers
 * a browser needs.
 *
 * It stores nothing. The key arrives on each request from the caller's browser
 * and is passed straight through.
 *
 * Deploy with no tooling, from a phone if need be: paste this whole file into
 * workers.cloudflare.com/playground and hit Deploy. A Worker is executed code,
 * not a static asset — uploading this file to a static-hosting flow would serve
 * it as text instead of running it.
 *
 * It uses only Request/Response and tolerates being called without `env`, so it
 * also runs unchanged on Deno Deploy and similar runtimes.
 *
 * Open the Worker's URL in a browser afterwards: it answers with a small JSON
 * health object, which confirms it is live.
 *
 * `GET /api/v1/player` also carries a `gameCodes` array in its response,
 * fetched from Tacticus Codex's public, unauthenticated redemption-code list
 * (tacticuscodex.com — a community-run site, not Snowprint's) and appended
 * alongside `player`/`metaData`. That fetch is best-effort: if Tacticus Codex
 * is slow or unreachable, the player response is still returned, just without
 * `gameCodes`, rather than failing the whole refresh over a third party. It is
 * also edge-cached for a few minutes (`CODES_CACHE_SECONDS` below), since
 * codes change a handful of times a day at most and there is no reason to ask
 * a community-run API fresh on every single player refresh.
 *
 * Two controls decide who may use it:
 *
 * - ALLOWED_ORIGINS, a comma-separated list, settable as a Worker variable.
 *   Useful against other *pages* calling it, but not against a scripted client,
 *   which can send whatever Origin it likes.
 * - RELAY_KEY, an optional secret you invent and set as a Worker variable. When
 *   set, every proxied request must carry it as the X-Relay-Key header.
 *
 * Running without RELAY_KEY is a reasonable choice, not a mistake, and is what
 * this relay expects by default. The reason is that the alternative is usually
 * worse: a key is only a lock while it stays secret, and the obvious way to
 * avoid typing it into every browser — baking it into the app — publishes it,
 * since a static site has no server side and any credential the page sends is
 * readable by whoever holds the page. A published key is an unlocked door that
 * looks locked. Set RELAY_KEY only if you are willing to enter it by hand.
 *
 * What a key does *not* protect is worth being clear about, because it decides
 * how much any of this matters. This relay forwards the caller's own API key
 * and never stores it, so a stranger using your relay reads their own account,
 * not yours. It can only ever reach the Tacticus API: the upstream host is
 * hard-coded and only the three read-only endpoints are forwarded. What they
 * can spend is your request quota — on the Workers free plan, 100,000 a day,
 * after which Cloudflare answers with its own 1027 page until 00:00 UTC rather
 * than billing you.
 */

/** Origins permitted to use this relay. `*` allows any — prefer naming yours. */
const ALLOWED_ORIGINS = [
  'https://igormicadei.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
];

/** Hard-coded: this relay cannot be pointed at any other host. */
const API_ORIGIN = 'https://api.tacticusgame.com';

/** Only these paths are proxied, so the relay cannot be used against anything else. */
const ALLOWED_PATHS = /^\/api\/v1\/(player|guild|guildRaid(\/\d+)?)$/;

/**
 * Tacticus Codex's public redemption-code list — a community-run site, not
 * Snowprint's, and not the Tacticus API. No key of any kind guards it.
 */
const CODES_ORIGIN = 'https://api.tacticuscodex.com';
const CODES_PATH = '/api/gamecode';

/**
 * How long a code list is served from Cloudflare's edge cache before this
 * Worker asks Tacticus Codex again.
 *
 * Codes change a handful of times a day at most, so asking on every single
 * player refresh — which happens on every app open and tab focus — would just
 * be load on someone else's community-run API for no fresher an answer.
 */
const CODES_CACHE_SECONDS = 900;

/**
 * Fetch Tacticus Codex's code list, best-effort.
 *
 * `undefined` on any failure — a timeout, a non-200, a body that is not the
 * JSON shape expected — so the caller can fall back to returning the player
 * response without `gameCodes` rather than failing the whole refresh over a
 * third party this relay does not control.
 */
async function fetchGameCodes() {
  try {
    const upstream = await fetch(`${CODES_ORIGIN}${CODES_PATH}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: CODES_CACHE_SECONDS, cacheEverything: true },
      signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) return undefined;
    const data = await upstream.json();
    return Array.isArray(data?.gameCodes) ? data.gameCodes : undefined;
  } catch {
    return undefined;
  }
}

/** Constant-time compare, so a wrong key cannot be found byte by byte. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function allowedOrigins(env) {
  return (env?.ALLOWED_ORIGINS ?? ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function corsHeaders(origin, env) {
  const allowed = allowedOrigins(env);
  const allow = allowed.includes('*')
    ? '*'
    : allowed.includes(origin)
      ? origin
      : undefined;
  if (!allow) return undefined;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'X-API-KEY, X-Relay-Key, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body, status, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // A health check, so the Worker URL can be opened in a browser to confirm
    // the deploy worked before wiring it into the app.
    if (url.pathname === '/' || url.pathname === '/health') {
      const guarded = Boolean(env?.RELAY_KEY);
      return json(
        {
          ok: true,
          relay: 'tacticus',
          usage: 'GET /api/v1/player with an X-API-KEY header',
          requiresRelayKey: guarded,
          allowedOrigins: allowedOrigins(env),
          // Stated rather than warned about: keyless is the expected posture,
          // and what it exposes is the request quota, not the account. Anyone
          // reaching this endpoint already knows the URL, so saying so plainly
          // costs nothing and saves the owner guessing at their own config.
          access: guarded
            ? 'A relay key is required, in addition to the origin allowlist.'
            : 'Open to the allowed origins above. Callers still need their own ' +
              'Tacticus API key, and only the three read-only endpoints are proxied.',
        },
        200,
        { 'Access-Control-Allow-Origin': '*' },
      );
    }

    const origin = request.headers.get('Origin') ?? '';
    const cors = corsHeaders(origin, env);
    if (!cors) {
      // Answered with a wildcard so the page can actually read the reason
      // rather than seeing an opaque network failure. Nothing is proxied.
      return json(
        {
          type: 'ORIGIN_NOT_ALLOWED',
          detail: `This relay does not allow ${origin || 'requests without an Origin'}.`,
          allowedOrigins: allowedOrigins(env),
        },
        403,
        { 'Access-Control-Allow-Origin': '*' },
      );
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') {
      return new Response('Only GET is proxied.', { status: 405, headers: cors });
    }

    if (!ALLOWED_PATHS.test(url.pathname)) {
      return new Response(
        JSON.stringify({ type: 'NOT_FOUND', detail: 'Path not proxied by this relay.' }),
        { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    // The relay's own secret, checked before anything is forwarded.
    if (env?.RELAY_KEY) {
      const presented = request.headers.get('X-Relay-Key') ?? '';
      if (!timingSafeEqual(presented, env.RELAY_KEY)) {
        return json(
          {
            type: 'RELAY_KEY_INVALID',
            detail: presented
              ? 'The relay key is wrong.'
              : 'This relay requires a relay key. Set it on the Player data page.',
          },
          401,
          cors,
        );
      }
    }

    const apiKey = request.headers.get('X-API-KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ type: 'FORBIDDEN', detail: 'Missing X-API-KEY.' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const isPlayer = url.pathname === '/api/v1/player';

    // Kicked off alongside the player request rather than after it: the two
    // origins are unrelated, so there is no reason to pay their latencies one
    // after the other only to then staple the results together.
    const [upstream, gameCodes] = await Promise.all([
      fetch(`${API_ORIGIN}${url.pathname}`, {
        method: 'GET',
        headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
        // The response below says no-store, but that governs the caller's cache,
        // not Cloudflare's own edge cache in front of this subrequest. Without
        // this a refresh can be answered with a roster minutes old.
        cf: { cacheTtl: 0, cacheEverything: false },
      }),
      isPlayer ? fetchGameCodes() : Promise.resolve(undefined),
    ]);

    const body = await upstream.text();
    const merged = mergeGameCodes(body, upstream.ok ? gameCodes : undefined);
    return new Response(merged, {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  },
};

/**
 * Stitches `gameCodes` onto a player response body, when there is anything to
 * stitch — otherwise returns `body` exactly as it arrived.
 *
 * Reparsing and re-serialising a response nobody asked to have touched is the
 * one thing to avoid here: a body that fails to parse as JSON, or a call
 * where the codex fetch came back empty, is returned byte-for-byte so this
 * enrichment can never be the reason a player response looks different from
 * what the Tacticus API actually sent.
 */
function mergeGameCodes(body, gameCodes) {
  if (!gameCodes) return body;
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify({ ...parsed, gameCodes });
  } catch {
    return body;
  }
}
