/**
 * The published game, as the database has it: units, upgrades and campaign
 * nodes. Nothing here depends on a roster — these answers are the same for
 * every player.
 */

import { z } from 'zod';

import {
  RARITY_NAMES,
  campaignSides,
  itemSource,
  rankName,
} from '../../../dist/gamedata/index.js';

import { allianceName, rarityLabel } from '../labels.js';
import { db } from '../context.js';
import type { Registrar } from '../register.js';

export function registerGameTools(tool: Registrar): void {
  tool(
    'game_info',
    'What the loaded game database covers: its schema version, where it came from, when it was captured, and how much of each thing it holds.',
    {},
    async () => {
      const database = await db();
      return {
        schemaVersion: database.schemaVersion,
        fetchedAt: database.fetchedAt,
        sources: database.sources,
        counts: {
          units: Object.keys(database.units).length,
          upgrades: Object.keys(database.upgrades).length,
          items: Object.keys(database.items).length,
          abilities: Object.keys(database.abilities).length,
          traits: Object.keys(database.traits).length,
          campaigns: Object.keys(database.campaigns).length,
          battles: Object.values(database.campaigns).reduce(
            (n, campaign) => n + Object.keys(campaign.battles).length,
            0,
          ),
        },
      };
    },
  );

  tool(
    'list_units',
    'Every unit the game publishes, with its faction and alliance. Filters are substring matches on the name or faction; this is the catalogue, not the player\'s roster — use list_roster for that.',
    {
      search: z.string().optional().describe('Substring of the name, id or faction'),
      faction: z.string().optional(),
      alliance: z.enum(['Imperial', 'Xenos', 'Chaos']).optional(),
      limit: z.number().int().min(1).max(500).default(200),
    },
    async ({ search, faction, alliance, limit }) => {
      const database = await db();
      const wanted = search?.trim().toLowerCase();
      const rows = Object.values(database.units)
        .filter((unit) => {
          if (faction && unit.factionId?.toLowerCase() !== faction.toLowerCase()) return false;
          if (alliance && allianceName(unit.grandAlliance) !== alliance) return false;
          if (!wanted) return true;
          return [unit.id, unit.name, unit.fullName, unit.factionId]
            .some((field) => field?.toLowerCase().includes(wanted));
        })
        .map((unit) => ({
          id: unit.id,
          name: unit.name,
          faction: unit.factionId,
          alliance: allianceName(unit.grandAlliance),
          baseRarity: rarityLabel(unit.baseRarity),
          isMachineOfWar: unit.isMachineOfWar ?? false,
        }));
      return { total: rows.length, units: rows.slice(0, limit) };
    },
  );

  tool(
    'get_unit',
    'One unit in full: its weapons, traits, abilities, and the upgrade slots each rank asks for — the table every rank-up cost is read from.',
    { unitId: z.string().describe('Unit id, e.g. ultraTigurius') },
    async ({ unitId }) => {
      const database = await db();
      const unit = database.units[unitId];
      if (!unit) throw new Error(`No unit "${unitId}" in the database. Try list_units.`);
      return {
        ...unit,
        alliance: allianceName(unit.grandAlliance),
        ranks: unit.ranks.map((rank) => ({
          rank: rank.rank,
          rankName: rankName(rank.rank),
          upgrades: rank.upgrades.map((slot, index) => ({
            slot: index + 1,
            upgradeId: slot.upgradeId,
            name: database.upgrades[slot.upgradeId]?.name ?? slot.upgradeId,
            amount: slot.amount,
            statType: slot.statType,
            statIncrease: slot.statIncrease,
          })),
        })),
      };
    },
  );

  tool(
    'list_upgrades',
    'Upgrade materials, with what they are forged from and whether a campaign node drops them directly.',
    {
      search: z.string().optional().describe('Substring of the name or id'),
      rarity: z.enum(RARITY_NAMES).optional(),
      craftedOnly: z.boolean().default(false).describe('Only materials that are forged rather than dropped'),
      limit: z.number().int().min(1).max(500).default(100),
    },
    async ({ search, rarity, craftedOnly, limit }) => {
      const database = await db();
      const wanted = search?.trim().toLowerCase();
      const rows = Object.values(database.upgrades)
        .filter((upgrade) => {
          if (rarity && rarityLabel(upgrade.rarity) !== rarity) return false;
          if (wanted && !`${upgrade.id} ${upgrade.name}`.toLowerCase().includes(wanted)) return false;
          const source = itemSource({ kind: 'upgrade', key: `upgrade:${upgrade.id}` }, database);
          return !craftedOnly || source.kind === 'craft';
        })
        .map((upgrade) => {
          const source = itemSource({ kind: 'upgrade', key: `upgrade:${upgrade.id}` }, database);
          return {
            id: upgrade.id,
            name: upgrade.name,
            rarity: rarityLabel(upgrade.rarity),
            source: source.kind,
            recipe:
              source.kind === 'craft'
                ? source.recipe.map((part) => ({ id: part.id, name: part.name, amount: part.amount }))
                : undefined,
            farmableAt: source.kind === 'farm' ? source.nodes.length : 0,
          };
        });
      return { total: rows.length, upgrades: rows.slice(0, limit) };
    },
  );

  tool(
    'list_campaigns',
    'Every campaign, with the side it is fought from. The faction and alliance are derived — no table publishes who a node permits — so a campaign with no opposite side is reported as unrestricted.',
    {},
    async () => {
      const database = await db();
      const sides = campaignSides(database);
      return {
        campaigns: Object.values(database.campaigns).map((campaign) => {
          const side = sides.get(campaign.id);
          return {
            id: campaign.id,
            name: campaign.name,
            type: campaign.type,
            energyCost: campaign.energyCost,
            dailyBattleCount: campaign.dailyBattleCount,
            nodes: Object.keys(campaign.battles).length,
            playedBy: side ? { faction: side.faction, alliance: allianceName(side.alliance) } : undefined,
          };
        }),
      };
    },
  );

  tool(
    'campaign_nodes',
    'Nodes of one campaign: team slots, enemies, the material or shards they drop, and the published base drop rates. Rates are the chance before the Mercy counter — see farm_targets for what a copy actually costs.',
    {
      campaignId: z.string().describe('Campaign id, e.g. campaign1 or elite3'),
      node: z.number().int().optional().describe('One node number, or every node when omitted'),
    },
    async ({ campaignId, node }) => {
      const database = await db();
      const campaign = database.campaigns[campaignId];
      if (!campaign) throw new Error(`No campaign "${campaignId}". Try list_campaigns.`);
      const battles = Object.values(campaign.battles)
        .filter((battle) => node === undefined || battle.nodeNumber === node)
        .sort((a, b) => a.nodeNumber - b.nodeNumber)
        .map((battle) => ({
          key: battle.key,
          node: battle.nodeNumber,
          slots: battle.slots,
          enemies: battle.enemiesTotal,
          enemyFactions: battle.enemyFactions,
          enemySummary: battle.enemySummary,
          rewardUpgradeId: battle.rewardUpgradeId,
          rewardShardUnitId: battle.rewardShardUnitId,
          dropRates: battle.dropRates,
          energyCost: campaign.energyCost,
        }));
      return { campaign: campaign.name, energyCost: campaign.energyCost, battles };
    },
  );
}
