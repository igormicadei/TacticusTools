/**
 * Fetches every endpoint and prints a short summary.
 *
 *   TACTICUS_API_KEY=<your-key> npx tsx examples/fetch-all.ts
 *
 * Or, after `npm run build`, port this to plain JS against `dist/`.
 */

import { TacticusClient, TacticusApiError, fromUnixSeconds, toDate } from '../src/index.js';

const apiKey = process.env['TACTICUS_API_KEY'];
if (!apiKey) {
  console.error('Set TACTICUS_API_KEY in the environment.');
  process.exit(1);
}

const client = new TacticusClient({ apiKey });

async function main(): Promise<void> {
  const { player, metaData } = await client.getPlayer();
  console.log(`Player   : ${player.details.name} (power ${player.details.powerLevel})`);
  console.log(`Units    : ${player.units.length}`);
  console.log(`Scopes   : ${metaData.scopes.join(', ')}`);
  console.log(`Refreshed: ${fromUnixSeconds(metaData.lastUpdatedOn)?.toISOString() ?? 'never'}`);

  try {
    const { guild } = await client.getGuild();
    console.log(`\nGuild    : [${guild.guildTag}] ${guild.name} (level ${guild.level})`);
    console.log(`Members  : ${guild.members.length}`);
    console.log(`Seasons  : ${guild.guildRaidSeasons.join(', ')}`);

    const raid = await client.getGuildRaid();
    const damage = raid.entries.reduce((sum, entry) => sum + entry.damageDealt, 0);
    console.log(`\nRaid     : season ${raid.season} (${raid.seasonConfigId})`);
    console.log(`Entries  : ${raid.entries.length}, total damage ${damage.toLocaleString()}`);

    const latest = raid.entries.at(-1);
    if (latest) {
      console.log(`Latest   : ${latest.type} @ ${toDate(latest.startedOn)?.toISOString() ?? '?'}`);
    }
  } catch (error) {
    if (error instanceof TacticusApiError && error.type === 'NOT_FOUND') {
      console.log('\nNo guild data (player is not in a guild, or the key lacks guild scope).');
      return;
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  if (error instanceof TacticusApiError) {
    console.error(`API error ${error.status} ${error.type ?? ''} on ${error.path}`);
    console.error(error.retryable ? 'This one is retryable.' : 'This one is not retryable.');
    process.exit(1);
  }
  throw error;
});
