import http from 'node:http';
import { TacticusClient, TacticusApiError, toDate } from '../dist/index.js';

const playerBody = {
  player: {
    details: { name: 'player123', powerLevel: 10 },
    units: [{ id: 'u', progressionIndex: 0, xp: 0, xpLevel: 1, rank: 0, abilities: [], upgrades: [], items: [], shards: 0, mythicShards: 0 }],
    inventory: { items: [], upgrades: [], shards: [], mythicShards: [], xpBooks: [], abilityBadges: {}, components: [], forgeBadges: [], orbs: {}, resetStones: 1 },
    progress: { campaigns: [], legendaryEvents: [] },
  },
  metaData: { configHash: 'abc', lastUpdatedOn: 1766067907, scopes: ['Player'] },
};

const server = http.createServer((req, res) => {
  const key = req.headers['x-api-key'];
  if (key !== 'test-key') { res.writeHead(403, {'content-type':'application/json'}); return res.end(JSON.stringify({type:'FORBIDDEN'})); }
  if (req.url === '/api/v1/player') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify(playerBody)); }
  if (req.url === '/api/v1/guild') { res.writeHead(404, {'content-type':'application/json'}); return res.end(JSON.stringify({type:'NOT_FOUND'})); }
  if (req.url === '/api/v1/guildRaid/68') { res.writeHead(500, {'content-type':'application/json'}); return res.end(JSON.stringify({type:'UNKNOWN_ERROR'})); }
  res.writeHead(404); res.end('{}');
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const client = new TacticusClient({ apiKey: 'test-key', baseUrl });
const { player, metaData } = await client.getPlayer();
console.log('200 parsed ->', player.details.name, '| scopes', metaData.scopes, '| units', player.units.length);

try { await client.getGuild(); } catch (e) {
  console.log('404 ->', e instanceof TacticusApiError, e.status, e.type, 'retryable:', e.retryable);
}
try { await client.getGuildRaid(68); } catch (e) {
  console.log('500 ->', e instanceof TacticusApiError, e.status, e.type, 'retryable:', e.retryable);
}
const bad = new TacticusClient({ apiKey: 'wrong', baseUrl });
try { await bad.getPlayer(); } catch (e) {
  console.log('403 ->', e instanceof TacticusApiError, e.status, e.type, 'retryable:', e.retryable);
}
try { client.getGuildRaid(-1); } catch (e) { console.log('validation ->', e.constructor.name, e.message); }
console.log('toDate(number) ->', toDate(1766067907).toISOString());
console.log('toDate(iso)    ->', toDate('2026-01-01T00:00:00Z').toISOString());
console.log('toDate(undef)  ->', toDate(undefined));
server.close();
