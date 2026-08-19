/**
 * Validates a real Tacticus API response against the shapes declared in
 * src/types. Reports three classes of drift:
 *
 *   - missing   : a field the types mark required is absent
 *   - unknown   : a field the API sent that the types don't declare
 *   - enum      : a value outside a declared union
 *
 * Usage:
 *   node test/validate-response.mjs player.json          # validate a saved body
 *   TACTICUS_API_KEY=<key> node test/validate-response.mjs --live
 */

import { readFileSync } from 'node:fs';

const RARITY = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
const ALLIANCE = ['Imperial', 'Xenos', 'Chaos'];
const CAMPAIGN_TYPE = ['Standard', 'Mirror', 'Elite', 'EliteMirror', 'Extremis'];
const SLOT = ['Slot1', 'Slot2', 'Slot3'];

/** shape: [requiredKeys, optionalKeys, { key: allowedValues }] */
const S = {
  PlayerResponse: [['player', 'metaData'], [], {}],
  PlayerMetaData: [['configHash', 'lastUpdatedOn', 'scopes'], ['apiKeyExpiresOn'], {}],
  PlayerDetails: [['name', 'powerLevel'], [], {}],
  Player: [['details', 'units', 'inventory', 'progress'], [], {}],
  Unit: [
    ['id', 'progressionIndex', 'xp', 'xpLevel', 'rank', 'abilities', 'upgrades', 'items', 'shards', 'mythicShards'],
    ['name', 'faction', 'grandAlliance'],
    { grandAlliance: ALLIANCE },
  ],
  Ability: [['id', 'level'], [], {}],
  UnitItem: [['slotId', 'level', 'id'], ['name', 'rarity'], { slotId: SLOT, rarity: RARITY }],
  Inventory: [
    ['items', 'upgrades', 'shards', 'mythicShards', 'xpBooks', 'abilityBadges', 'components', 'forgeBadges', 'orbs', 'resetStones'],
    ['requisitionOrders'],
    {},
  ],
  Item: [['id', 'amount'], ['name', 'level'], {}],
  Upgrade: [['id', 'amount'], ['name'], {}],
  Shard: [['id', 'amount'], ['name'], {}],
  XpBook: [['id', 'rarity', 'amount'], [], { rarity: RARITY }],
  AbilityBadge: [['rarity', 'amount'], ['name'], { rarity: RARITY }],
  ForgeBadge: [['name', 'rarity', 'amount'], [], { rarity: RARITY }],
  Component: [['name', 'grandAlliance', 'amount'], [], { grandAlliance: ALLIANCE }],
  Orb: [['rarity', 'amount'], [], { rarity: RARITY }],
  RequisitionOrders: [['regular', 'blessed'], [], {}],
  Token: [['current', 'max', 'regenDelayInSeconds'], ['nextTokenInSeconds'], {}],
  Progress: [['campaigns', 'legendaryEvents'], ['arena', 'guildRaid', 'onslaught', 'salvageRun'], {}],
  CampaignProgress: [['id', 'name', 'type', 'battles'], [], { type: CAMPAIGN_TYPE }],
  CampaignLevel: [['battleIndex', 'attemptsLeft', 'attemptsUsed'], [], {}],
  LegendaryEvent: [['id', 'lanes', 'currentCurrency', 'currentShards', 'currentClaimedChestIndex'], ['currentPoints', 'currentEvent'], {}],
  LELane: [['id', 'name', 'battleConfigs', 'progress'], [], {}],
  LEBattleConfig: [['numEnemies', 'objectives', 'disallowedFactions'], [], {}],
  LEBattleObjective: [['objectiveType', 'objectiveTarget', 'score'], [], {}],
  LEBattleProgress: [['objectivesCleared', 'highScore', 'encounterPoints'], [], {}],
  LECurrentEvent: [['hasUsedAdForExtraTokenToday', 'extraCurrencyPerPayout'], ['run', 'tokens'], {}],
  GuildResponse: [['guild'], [], {}],
  Guild: [['guildId', 'guildTag', 'name', 'level', 'members', 'guildRaidSeasons'], [], {}],
  GuildMember: [['userId', 'role', 'level'], ['lastActivityOn'], { role: ['MEMBER', 'OFFICER', 'CO_LEADER', 'LEADER'] }],
  GuildRaidResponse: [['season', 'seasonConfigId', 'entries'], [], {}],
  Raid: [
    ['userId', 'tier', 'set', 'encounterIndex', 'remainingHp', 'maxHp', 'encounterType', 'unitId', 'type', 'rarity', 'damageDealt', 'damageType', 'startedOn', 'heroDetails', 'globalConfigHash'],
    ['completedOn', 'machineOfWarDetails'],
    { encounterType: ['SideBoss', 'Boss'], damageType: ['Bomb', 'Battle'], rarity: RARITY },
  ],
  PublicHeroDetail: [['unitId', 'power'], [], {}],
};

const problems = [];
const seen = new Set();

function check(kind, node, path) {
  if (node === null || typeof node !== 'object') return;
  seen.add(kind);
  const shape = S[kind];
  if (!shape) return;
  const [required, optional, enums] = shape;
  const declared = new Set([...required, ...optional]);

  for (const key of required) {
    if (!(key in node)) problems.push(`missing  ${path}.${key}  (required by ${kind})`);
  }
  for (const key of Object.keys(node)) {
    if (!declared.has(key)) problems.push(`unknown  ${path}.${key} = ${JSON.stringify(node[key])?.slice(0, 60)}  (not declared on ${kind})`);
  }
  for (const [key, allowed] of Object.entries(enums)) {
    const v = node[key];
    if (v !== undefined && v !== null && !allowed.includes(v)) {
      problems.push(`enum     ${path}.${key} = ${JSON.stringify(v)}  (not in ${kind}.${key})`);
    }
  }
}

const each = (arr, kind, path) => (arr ?? []).forEach((v, i) => check(kind, v, `${path}[${i}]`));

function validatePlayer(d) {
  check('PlayerResponse', d, 'player');
  check('PlayerMetaData', d.metaData, 'metaData');
  const p = d.player ?? {};
  check('Player', p, 'player');
  check('PlayerDetails', p.details, 'player.details');

  (p.units ?? []).forEach((u, i) => {
    const at = `player.units[${i}]`;
    check('Unit', u, at);
    each(u.abilities, 'Ability', `${at}.abilities`);
    each(u.items, 'UnitItem', `${at}.items`);
  });

  const inv = p.inventory ?? {};
  check('Inventory', inv, 'player.inventory');
  each(inv.items, 'Item', 'inventory.items');
  each(inv.upgrades, 'Upgrade', 'inventory.upgrades');
  each(inv.shards, 'Shard', 'inventory.shards');
  each(inv.mythicShards, 'Shard', 'inventory.mythicShards');
  each(inv.xpBooks, 'XpBook', 'inventory.xpBooks');
  each(inv.components, 'Component', 'inventory.components');
  each(inv.forgeBadges, 'ForgeBadge', 'inventory.forgeBadges');
  if (inv.requisitionOrders) check('RequisitionOrders', inv.requisitionOrders, 'inventory.requisitionOrders');
  for (const [k, arr] of Object.entries(inv.abilityBadges ?? {})) {
    if (!ALLIANCE.includes(k)) problems.push(`enum     inventory.abilityBadges."${k}"  (not a grand alliance)`);
    each(arr, 'AbilityBadge', `inventory.abilityBadges.${k}`);
  }
  for (const [k, arr] of Object.entries(inv.orbs ?? {})) {
    if (!ALLIANCE.includes(k)) problems.push(`enum     inventory.orbs."${k}"  (not a grand alliance)`);
    each(arr, 'Orb', `inventory.orbs.${k}`);
  }

  const pr = p.progress ?? {};
  check('Progress', pr, 'player.progress');
  (pr.campaigns ?? []).forEach((c, i) => {
    check('CampaignProgress', c, `progress.campaigns[${i}]`);
    each(c.battles, 'CampaignLevel', `progress.campaigns[${i}].battles`);
  });
  for (const mode of ['arena', 'guildRaid', 'onslaught', 'salvageRun']) {
    const m = pr[mode];
    if (!m) continue;
    for (const tk of ['tokens', 'bombTokens']) {
      if (m[tk]) check('Token', m[tk], `progress.${mode}.${tk}`);
    }
  }
  (pr.legendaryEvents ?? []).forEach((le, i) => {
    const at = `progress.legendaryEvents[${i}]`;
    check('LegendaryEvent', le, at);
    (le.lanes ?? []).forEach((lane, j) => {
      check('LELane', lane, `${at}.lanes[${j}]`);
      (lane.battleConfigs ?? []).forEach((bc, k) => {
        check('LEBattleConfig', bc, `${at}.lanes[${j}].battleConfigs[${k}]`);
        each(bc.objectives, 'LEBattleObjective', `${at}.lanes[${j}].battleConfigs[${k}].objectives`);
      });
      each(lane.progress, 'LEBattleProgress', `${at}.lanes[${j}].progress`);
    });
    if (le.currentEvent) {
      check('LECurrentEvent', le.currentEvent, `${at}.currentEvent`);
      if (le.currentEvent.tokens) check('Token', le.currentEvent.tokens, `${at}.currentEvent.tokens`);
    }
  });
}

function validateGuild(d) {
  check('GuildResponse', d, 'guild');
  check('Guild', d.guild, 'guild');
  each(d.guild?.members, 'GuildMember', 'guild.members');
}

function validateGuildRaid(d) {
  check('GuildRaidResponse', d, 'guildRaid');
  (d.entries ?? []).forEach((e, i) => {
    check('Raid', e, `entries[${i}]`);
    each(e.heroDetails, 'PublicHeroDetail', `entries[${i}].heroDetails`);
    if (e.machineOfWarDetails) check('PublicHeroDetail', e.machineOfWarDetails, `entries[${i}].machineOfWarDetails`);
  });
}

function dispatch(body) {
  if (body?.player) return validatePlayer(body);
  if (body?.guild) return validateGuild(body);
  if (body?.entries) return validateGuildRaid(body);
  problems.push('unrecognised body: no player/guild/entries key');
}

const args = process.argv.slice(2);

if (args[0] === '--live') {
  const key = process.env.TACTICUS_API_KEY;
  if (!key) {
    console.error('Set TACTICUS_API_KEY to use --live.');
    process.exit(1);
  }
  for (const ep of ['player', 'guild', 'guildRaid']) {
    const res = await fetch(`https://api.tacticusgame.com/api/v1/${ep}`, {
      headers: { 'X-API-KEY': key, Accept: 'application/json' },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      console.log(`  ${ep}: HTTP ${res.status} ${body?.type ?? ''} — skipped`);
      continue;
    }
    console.log(`  ${ep}: HTTP 200 — validating`);
    dispatch(body);
  }
} else if (args[0]) {
  dispatch(JSON.parse(readFileSync(args[0], 'utf8')));
} else {
  console.error('Usage: node test/validate-response.mjs <file.json> | --live');
  process.exit(1);
}

console.log(`\nshapes exercised: ${[...seen].sort().join(', ') || '(none)'}`);
if (problems.length === 0) {
  console.log('\n✓ no drift: response conforms to src/types');
  process.exit(0);
}
console.log(`\n✗ ${problems.length} problem(s):`);
for (const p of problems) console.log('  ' + p);
process.exit(1);
