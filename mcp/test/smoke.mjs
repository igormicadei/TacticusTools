/*
 * Every tool, over a real stdio connection.
 *
 * The server is spawned as the client would spawn it and driven through the
 * SDK, so what is exercised is the protocol surface rather than the handlers
 * called directly: a tool whose schema will not serialise, or whose name is
 * misspelled in the registration, fails here and nowhere else.
 *
 * The store is a scratch directory seeded with a copy of the roster, so nothing
 * touches whatever the caller keeps in ~/.tacticus-tools.
 */
import { mkdtemp, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

const dir = await mkdtemp(join(tmpdir(), 'tacticus-mcp-'));
await copyFile(join(REPO, 'player.json'), join(dir, 'player.json'));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(HERE, '..', 'dist', 'server.js')],
  env: { ...process.env, TACTICUS_TOOLS_DATA: dir },
});
const client = new Client({ name: 'smoke', version: '0' });
await client.connect(transport);

let failures = 0;
const seen = new Set();
const check = (ok, what, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** Call a tool and parse its JSON, failing the run if it reported an error. */
async function call(name, args = {}) {
  seen.add(name);
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? '';
  if (result.isError) throw new Error(`${name}: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} returned something that is not JSON: ${text.slice(0, 120)}`);
  }
}

const { tools } = await client.listTools();
console.log(`\n${tools.length} tools advertised\n`);
const undescribed = tools.filter((t) => !t.description || t.description.length <= 40);
check(
  undescribed.length === 0,
  'every tool describes itself',
  undescribed.map((t) => t.name).join(', ') || undefined,
);

console.log('game database');
const info = await call('game_info');
check(info.counts.units > 50 && info.counts.battles > 1000, 'game_info counts the database', `${info.counts.units} units, ${info.counts.battles} battles`);
const units = await call('list_units', { search: 'tigurius' });
check(units.units.length === 1, 'list_units finds one by name');
const unit = await call('get_unit', { unitId: units.units[0].id });
check(unit.ranks.length > 0 && unit.ranks[0].upgrades.length > 0, 'get_unit carries the rank tables');
const upgrades = await call('list_upgrades', { craftedOnly: true, limit: 5 });
check(upgrades.upgrades.every((u) => u.source === 'craft'), 'list_upgrades filters to forged materials');
const campaigns = await call('list_campaigns');
check(campaigns.campaigns.length > 20, 'list_campaigns lists them all');
const octarius = campaigns.campaigns.find((c) => c.name === 'Octarius Elite');
check(octarius?.playedBy?.faction === 'Orks', 'the derived side reaches the tool', JSON.stringify(octarius?.playedBy));
const nodes = await call('campaign_nodes', { campaignId: 'elite3', node: 5 });
check(nodes.battles[0]?.slots === 3, 'campaign_nodes returns one node');

console.log('\nplayer');
const summary = await call('player_summary');
check(summary.units > 0, 'player_summary reads the stored roster', `${summary.name}, ${summary.units} units`);
const roster = await call('list_roster', { limit: 5 });
check(roster.units.length === 5 && roster.units[0].effectiveHealth > 0, 'list_roster computes stats');
const one = await call('get_roster_unit', { unit: roster.units[0].name, againstArmour: 100 });
check(one.attacks.length > 0, 'get_roster_unit resolves attacks');
check(
  one.attacks.every((a) => a.throughArmour <= a.total.mid),
  'armour never increases the damage that lands',
);
const section = await call('player_section', { path: 'player.inventory.upgrades' });
check(Array.isArray(section.value), 'player_section reaches a branch by path');
const paths = await call('player_section');
check(paths.paths.includes('player.progress'), 'player_section lists the branches');
const held = await call('holdings', { limit: 5 });
check(held.holdings[0].amount > 0, 'holdings reads the inventory');

console.log('\ncalculations');
const stats = await call('unit_stats', { unit: roster.units[0].name, rank: 9 });
check(stats.asked.health > 0, 'unit_stats answers a hypothetical');
const preview = await call('plan_preview', { unit: roster.units[0].name, rank: roster.units[0].rank + 1 });
check(preview.steps.length > 0 && preview.cost.energy >= 0, 'plan_preview resolves and costs', `${preview.steps.length} steps, ${Math.round(preview.cost.energy)} energy`);
const candidates = await call('energy_candidates', { limit: 3 });
check(candidates.candidates.length > 0, 'energy_candidates ranks the slots');
check(
  candidates.candidates.every((c) => c.energy >= 0 && c.toFarm.length >= 0),
  'every candidate carries its shopping list',
);
const mercy = await call('drop_rate_math', { baseRate: 0.4281 });
check(mercy.runsPerDropWithMercy < mercy.runsPerDropIfPlainRoll, 'the Mercy counter reaches the tool', `${mercy.runsPerDropWithMercy} vs ${mercy.runsPerDropIfPlainRoll}`);
const anyUpgrade = upgrades.upgrades[0];
const farm = await call('farm_targets', { itemId: anyUpgrade.id, copies: 2 });
check(farm.targets.length > 0, 'farm_targets flattens the recipe', `${anyUpgrade.name} → ${farm.targets.length} base materials`);
check(farm.targets.every((t) => t.via !== undefined), 'each target names the chain it serves');
const uses = await call('material_uses', { itemId: farm.targets[0].name ? anyUpgrade.id : anyUpgrade.id });
check(Array.isArray(uses), 'material_uses inverts the rank tables');
const badges = await call('badge_costs');
check(Array.isArray(badges), 'badge_costs answers');
const squad = await call('recommend_team', { battleKey: 'elite3_05' });
check(squad.squad.length > 0 && squad.takes === 'Orks', 'recommend_team honours who the node takes', `${squad.squad.map((s) => s.unit).join(', ')}`);
check(squad.squad.every((s) => s.faction === 'Orks'), 'and every pick is one of them');

console.log('\nwriting');
const saved = await call('save_plan', { unit: roster.units[0].name, rank: roster.units[0].rank + 2, priority: 'damage' });
check(saved.saved && saved.steps.length > 0, 'save_plan stores and validates', saved.saved);
const plans = await call('list_plans');
check(plans.plans.length === 1, 'list_plans reads it back');
const steps = await call('plan_steps', { planId: saved.saved });
check(steps.steps.length > 0 && steps.total.energy >= 0, 'plan_steps costs the saved plan');
const replaced = await call('save_plan', { planId: saved.saved, unit: roster.units[0].name, rank: roster.units[0].rank + 3 });
check(replaced.replaced === true, 'save_plan replaces by id');
const line = await call('timeline');
check(line.bundles.length > 0, 'timeline orders the saved plans');
const team = await call('save_team', { name: 'Probe', members: roster.units.slice(0, 3).map((u) => u.name), battleKey: 'campaign1_10' });
check(team.saved && team.members.length === 3, 'save_team resolves names to ids');
const teams = await call('list_teams');
check(teams.teams[0].memberIds.length === 3, 'list_teams reads it back');
const layout = await call('optimise_equipment', { teamId: team.saved });
check(Array.isArray(layout.moves), 'optimise_equipment answers', `${layout.moves.length} moves`);
check(
  layout.moves.every((m) => m.takeOff === undefined || m.takeOff.unit),
  'a piece taken off a team-mate names them',
);
check((await call('delete_plan', { planId: saved.saved })).remaining === 0, 'delete_plan removes it');
check((await call('delete_team', { teamId: team.saved })).remaining === 0, 'delete_team removes it');

console.log('\nfailure paths');
const missing = await client.callTool({ name: 'get_roster_unit', arguments: { unit: 'Nobody At All' } });
check(missing.isError === true && /list_roster/.test(missing.content[0].text), 'an unknown unit fails with advice', missing.content[0].text.slice(0, 60));
const noKey = await client.callTool({ name: 'refresh_roster', arguments: {} });
check(noKey.isError === true && /TACTICUS_API_KEY/.test(noKey.content[0].text), 'refresh_roster explains a missing key');
seen.add('refresh_roster');

// The store must be the scratch directory, and the roster must be untouched.
const after = await readFile(join(dir, 'player.json'), 'utf8');
check(after === (await readFile(join(REPO, 'player.json'), 'utf8')), 'nothing rewrote the roster');

const unexercised = tools.map((t) => t.name).filter((name) => !seen.has(name));
check(unexercised.length === 0, 'every advertised tool was exercised', unexercised.join(', ') || 'all of them');

await client.close();
await rm(dir, { recursive: true, force: true });
console.log(failures ? `\n✗ ${failures} check(s) failed` : `\n✓ ${tools.length} tools, all exercised over stdio`);
process.exit(failures ? 1 : 0);
