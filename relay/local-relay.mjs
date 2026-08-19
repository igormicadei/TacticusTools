/**
 * A relay you run on your own machine.
 *
 * CORS is a rule browsers apply to pages, not a network restriction: your
 * machine can call the Tacticus API perfectly well — `curl` does — but a page
 * cannot read the response because the API sends no CORS headers and refuses
 * the preflight a custom header forces.
 *
 * This closes that gap without any hosted service. It runs locally, forwards
 * the call, and adds the headers a browser needs. Your API key stays on your
 * machine: it goes from your browser to 127.0.0.1 and out to the API.
 *
 * Usage:
 *   node relay/local-relay.mjs            # listens on 127.0.0.1:8787
 *   PORT=9000 node relay/local-relay.mjs
 *
 * Then set the relay URL in the app's Player data page to
 * http://localhost:8787
 */

import { createServer } from 'node:http';

const PORT = Number(process.env['PORT'] ?? 8787);
const API_ORIGIN = 'https://api.tacticusgame.com';

/** Only the read-only Tacticus endpoints are proxied. */
const ALLOWED_PATHS = /^\/api\/v1\/(player|guild|guildRaid(\/\d+)?)$/;

function corsHeaders(request) {
  return {
    // Bound to whoever asked, so a stray page cannot silently reuse the relay
    // without the browser having told us its origin.
    'Access-Control-Allow-Origin': request.headers.origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'X-API-KEY, Accept',
    'Access-Control-Max-Age': '86400',
    // Chrome's Private Network Access check: a page on a public origin
    // (a GitHub Pages site) reaching a loopback address must be granted this
    // explicitly, or the preflight fails.
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin',
  };
}

const server = createServer(async (request, response) => {
  const cors = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors);
    return response.end();
  }
  if (request.method !== 'GET') {
    response.writeHead(405, { ...cors, 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ type: 'METHOD_NOT_ALLOWED' }));
  }

  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!ALLOWED_PATHS.test(url.pathname)) {
    response.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    return response.end(
      JSON.stringify({ type: 'NOT_FOUND', detail: 'Path not proxied by this relay.' }),
    );
  }

  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey !== 'string' || apiKey === '') {
    response.writeHead(403, { ...cors, 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ type: 'FORBIDDEN', detail: 'Missing X-API-KEY.' }));
  }

  try {
    const upstream = await fetch(`${API_ORIGIN}${url.pathname}`, {
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
    });
    const body = await upstream.text();
    console.log(`${new Date().toISOString()}  ${url.pathname} -> ${upstream.status}`);
    response.writeHead(upstream.status, {
      ...cors,
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch (error) {
    console.error('upstream failed:', error);
    response.writeHead(502, { ...cors, 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ type: 'UPSTREAM_UNREACHABLE' }));
  }
});

// Loopback only: nothing outside this machine can reach the relay.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Tacticus relay listening on http://localhost:${PORT}`);
  console.log('Set that as the relay URL on the app\'s Player data page.');
});
