/**
 * Writes a static snapshot of Tacticus Codex's redemption-code list.
 *
 * The live path is the relay (`relay/cloudflare-worker.js`), which appends a
 * fresh `gameCodes` array to every `/api/v1/player` response — see that
 * file's own comment. This snapshot exists for what happens before that: a
 * relay a player has not yet redeployed, or a relay whose own fetch of
 * Tacticus Codex failed. Either way the app falls back to this file rather
 * than showing nothing, so it is worth keeping current even though the relay
 * is the source of truth going forward.
 *
 * Usage:
 *   node scripts/snapshot-codes.mjs
 *   node scripts/snapshot-codes.mjs --out path.json
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const out = flag('--out') ?? 'ui/public/codes.snapshot.json';

const response = await fetch('https://api.tacticuscodex.com/api/gamecode', {
  headers: { Accept: 'application/json' },
});
if (!response.ok) {
  throw new Error(`Tacticus Codex answered ${response.status}`);
}
const data = await response.json();
if (!Array.isArray(data.gameCodes)) {
  throw new Error('Response had no gameCodes array — the endpoint may have changed shape.');
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ gameCodes: data.gameCodes }, null, 2));
console.log(`Wrote ${data.gameCodes.length} codes to ${out}`);
