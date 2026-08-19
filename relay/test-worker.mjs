/**
 * Exercises the relay worker without deploying it.
 *
 * Cloudflare workers run on standard Request/Response, which Node 22 provides,
 * so the module can be driven directly with a stubbed upstream fetch.
 *
 * Usage: node relay/test-worker.mjs
 */

import worker from './cloudflare-worker.js';

const realFetch = globalThis.fetch;
let lastUpstream;
globalThis.fetch = async (url, init) => {
  lastUpstream = { url: String(url), key: init?.headers?.['X-API-KEY'] };
  if (init?.headers?.['X-API-KEY'] !== 'good') {
    return new Response(JSON.stringify({ type: 'FORBIDDEN', code: 2 }), { status: 403 });
  }
  return new Response(JSON.stringify({ player: { units: [] } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

const ORIGIN = 'https://igormicadei.github.io';
const call = (path, { method='GET', origin=ORIGIN, key } = {}) =>
  worker.fetch(new Request(`https://relay.example.dev${path}`, {
    method, headers: { ...(origin ? { Origin: origin } : {}), ...(key ? { 'X-API-KEY': key } : {}) },
  }), {});

const show = async (label, res, extra='') => {
  const acao = res.headers.get('Access-Control-Allow-Origin');
  console.log(`  ${label.padEnd(42)} ${String(res.status).padEnd(4)} ACAO=${acao ?? '-'} ${extra}`);
};

console.log('=== worker behaviour ===');
await show('preflight, allowed origin', await call('/api/v1/player', { method:'OPTIONS' }));
await show('preflight, unknown origin', await call('/api/v1/player', { method:'OPTIONS', origin:'https://evil.example' }));
await show('GET without key', await call('/api/v1/player'));
await show('GET with bad key', await call('/api/v1/player', { key:'bad' }));
const ok = await call('/api/v1/player', { key:'good' });
await show('GET with good key', ok, `body=${(await ok.text()).slice(0,24)}…`);
await show('GET /guildRaid/68 (allowed path)', await call('/api/v1/guildRaid/68', { key:'good' }));
await show('GET /etc/passwd (not proxied)', await call('/etc/passwd', { key:'good' }));
await show('POST (not proxied)', await call('/api/v1/player', { method:'POST', key:'good' }));
console.log('\n  upstream actually called:', JSON.stringify(lastUpstream));

console.log('\n=== phone-setup helpers ===');
const health = await worker.fetch(new Request('https://relay.example.dev/'), {});
console.log('  GET /            ', health.status, await health.text());
const denied = await worker.fetch(
  new Request('https://relay.example.dev/api/v1/player', {
    headers: { Origin: 'https://someone-else.example', 'X-API-KEY': 'good' },
  }),
  {},
);
console.log('  disallowed origin', denied.status, 'ACAO=' + denied.headers.get('Access-Control-Allow-Origin'));
console.log('   body:', (await denied.text()).slice(0, 150));
const viaVar = await worker.fetch(
  new Request('https://relay.example.dev/api/v1/player', {
    headers: { Origin: 'https://custom.example', 'X-API-KEY': 'good' },
  }),
  { ALLOWED_ORIGINS: 'https://custom.example' },
);
console.log('  ALLOWED_ORIGINS variable override ->', viaVar.status);

globalThis.fetch = realFetch;
