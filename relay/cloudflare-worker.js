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
 * ALLOWED_ORIGINS below decides who may use it. It can also be set as a Worker
 * variable (Settings -> Variables) as a comma-separated list, which overrides
 * this list without editing code.
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
    'Access-Control-Allow-Headers': 'X-API-KEY, Accept',
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
      return json(
        {
          ok: true,
          relay: 'tacticus',
          usage: 'GET /api/v1/player with an X-API-KEY header',
          allowedOrigins: allowedOrigins(env),
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
