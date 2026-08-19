/**
 * Minimal CORS relay for the Tacticus API.
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
 * Deploy (free tier is ample — this is a handful of requests per day):
 *   npm create cloudflare@latest -- tacticus-relay
 *   # replace src/index.js with this file, then:
 *   npx wrangler deploy
 *
 * Then set ALLOWED_ORIGINS below, or as a Worker variable, so only your own
 * page can use it.
 */

/** Origins permitted to use this relay. `*` allows any — prefer naming yours. */
const ALLOWED_ORIGINS = [
  'https://igormicadei.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
];

const API_ORIGIN = 'https://api.tacticusgame.com';

/** Only these paths are proxied, so the relay cannot be used against anything else. */
const ALLOWED_PATHS = /^\/api\/v1\/(player|guild|guildRaid(\/\d+)?)$/;

function corsHeaders(origin, env) {
  const allowed = (env?.ALLOWED_ORIGINS ?? ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const allow = allowed.includes('*')
    ? '*'
    : allowed.includes(origin)
      ? origin
      : undefined;
  if (!allow) return undefined;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'X-API-KEY, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const cors = corsHeaders(origin, env);
    if (!cors) {
      return new Response('Origin not allowed by this relay.', { status: 403 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') {
      return new Response('Only GET is proxied.', { status: 405, headers: cors });
    }

    const url = new URL(request.url);
    if (!ALLOWED_PATHS.test(url.pathname)) {
      return new Response(
        JSON.stringify({ type: 'NOT_FOUND', detail: 'Path not proxied by this relay.' }),
        { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const apiKey = request.headers.get('X-API-KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ type: 'FORBIDDEN', detail: 'Missing X-API-KEY.' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const upstream = await fetch(`${API_ORIGIN}${url.pathname}`, {
      method: 'GET',
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  },
};
