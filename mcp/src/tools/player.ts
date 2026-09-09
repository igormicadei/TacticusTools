/**
 * The player's own data: the roster as the game reports it, the stats the
 * library derives from it, and the call that goes and gets a fresh copy.
 */

import { z } from 'zod';

import { bestDamageThrough, damageThrough, rankName } from '../../../dist/gamedata/index.js';

import { db, findUnit, forgetPlayer, player } from '../context.js';
import { rarityLabel } from '../labels.js';
import { fetchPlayerText } from '../fetch.js';
import type { Registrar } from '../register.js';
import { dataDir, store } from '../store.js';

/** One roster unit, flattened to what a reader usually wants to see first. */
const summarise = (unit: import('../../../dist/gamedata/index.js').RosterUnit) => ({
  id: unit.id,
  name: unit.name,
  faction: unit.factionId,
  alliance: unit.alliance,
  rank: unit.effective.rank,
  rankName: rankName(unit.effective.rank),
  rarity: rarityLabel(unit.stats?.rarity),
  xpLevel: unit.effective.xpLevel,
  progressionIndex: unit.effective.progressionIndex,
  stars: unit.stats?.tierStarLevel,
  starLevel: unit.stats?.starLevel,
  health: unit.stats?.health,
  damage: unit.stats?.damage,
  armour: unit.stats?.armour,
  effectiveHealth: Math.round(unit.effectiveHealth),
  effectiveDamage: Math.round(unit.effectiveDamage),
});

export function registerPlayerTools(tool: Registrar): void {
  tool(
    'player_summary',
    'Who the stored roster belongs to, how big it is, and when it was captured.',
    {},
    async () => {
      const { player: response, roster } = await player();
      return {
        name: response.player.details.name,
        powerLevel: response.player.details.powerLevel,
        units: roster.length,
        gameDataAsOf: response.metaData?.lastUpdatedOn
          ? new Date(response.metaData.lastUpdatedOn * 1000).toISOString()
          : undefined,
        storedAt: dataDir(),
      };
    },
  );

  tool(
    'list_roster',
    'The player\'s units with their computed stats. "Effective" health and damage account for armour and crit the way a battle does, which is what makes two units comparable.',
    {
      search: z.string().optional().describe('Substring of the name, id or faction'),
      alliance: z.enum(['Imperial', 'Xenos', 'Chaos']).optional(),
      minRank: z.number().int().min(0).max(16).optional(),
      sortBy: z
        .enum(['name', 'rank', 'health', 'damage', 'armour', 'effectiveHealth', 'effectiveDamage'])
        .default('effectiveHealth'),
      limit: z.number().int().min(1).max(200).default(50),
    },
    async ({ search, alliance, minRank, sortBy, limit }) => {
      const { roster } = await player();
      const wanted = search?.trim().toLowerCase();
      const rows = roster
        .filter((unit) => {
          if (alliance && unit.alliance !== alliance) return false;
          if (minRank !== undefined && unit.effective.rank < minRank) return false;
          if (!wanted) return true;
          return `${unit.id} ${unit.name} ${unit.factionId}`.toLowerCase().includes(wanted);
        })
        .map(summarise);
      rows.sort((a, b) =>
        sortBy === 'name' ? a.name.localeCompare(b.name) : (b[sortBy] ?? 0) - (a[sortBy] ?? 0),
      );
      return { total: rows.length, units: rows.slice(0, limit) };
    },
  );

  tool(
    'get_roster_unit',
    'One of the player\'s units in full: stats, equipment, the upgrade slots filled at its current rank, and every attack it can make with the damage each lands after a given armour.',
    {
      unit: z.string().describe('Unit id or name'),
      againstArmour: z.number().min(0).default(0).describe('Armour to resolve the attacks against'),
    },
    async ({ unit: wanted, againstArmour }) => {
      const { roster } = await player();
      const database = await db();
      const unit = findUnit(roster, wanted);
      const definition = database.units[unit.id];
      const rank = definition?.ranks.find((r) => r.rank === unit.effective.rank);
      return {
        ...summarise(unit),
        traits: unit.traits,
        items: unit.effective.items,
        cappedFromRoster: unit.isCapped,
        slotsAtThisRank: (rank?.upgrades ?? []).map((slot, index) => ({
          slot: index + 1,
          upgradeId: slot.upgradeId,
          name: database.upgrades[slot.upgradeId]?.name ?? slot.upgradeId,
          statType: slot.statType,
          statIncrease: slot.statIncrease,
          filled: (unit.effective.upgrades ?? []).includes(index),
        })),
        attacks: [...unit.normalAttacks, ...unit.abilityAttacks].map((attack) => ({
          label: attack.label,
          source: attack.source,
          damageProfile: attack.damageProfile,
          hits: attack.hits,
          perHit: attack.perHit,
          total: attack.total,
          pierceRatio: attack.pierceRatio,
          canCrit: attack.canCrit !== false,
          throughArmour: Math.round(damageThrough(attack, againstArmour)),
        })),
        bestThroughArmour: {
          normal: Math.round(bestDamageThrough(unit.normalAttacks, againstArmour)),
          ability: Math.round(bestDamageThrough(unit.abilityAttacks, againstArmour)),
        },
      };
    },
  );

  tool(
    'player_section',
    'Any branch of the stored API response, by dotted path — player.inventory, player.progress.campaigns, metaData. Omit the path to see what branches exist.',
    {
      path: z.string().optional().describe('Dotted path, e.g. player.inventory.upgrades'),
    },
    async ({ path }) => {
      const { player: response } = await player();
      if (!path) {
        const branches = (value: unknown, prefix = ''): string[] =>
          value !== null && typeof value === 'object' && !Array.isArray(value)
            ? Object.entries(value).flatMap(([key, child]) => {
                const here = prefix ? `${prefix}.${key}` : key;
                return [here, ...(prefix.split('.').length < 2 ? branches(child, here) : [])];
              })
            : [];
        return { paths: branches(response) };
      }
      let node: unknown = response;
      for (const part of path.split('.')) {
        if (node === null || typeof node !== 'object') {
          throw new Error(`"${path}" does not exist in the stored response — "${part}" has no children.`);
        }
        node = (node as Record<string, unknown>)[part];
      }
      if (node === undefined) throw new Error(`"${path}" does not exist in the stored response.`);
      return { path, value: node };
    },
  );

  tool(
    'holdings',
    'What the player holds, keyed the way every requirement is keyed — upgrade:<id>, badge:<alliance>:<rarity>, shard:<unitId>, xp. This is the map every shortfall is measured against.',
    {
      search: z.string().optional().describe('Substring of the key or the item name'),
      limit: z.number().int().min(1).max(500).default(100),
    },
    async ({ search, limit }) => {
      const { owned } = await player();
      const database = await db();
      const wanted = search?.trim().toLowerCase();
      const rows = [...owned]
        .filter(([, amount]) => amount > 0)
        .map(([key, amount]) => ({
          key,
          name: key.startsWith('upgrade:')
            ? (database.upgrades[key.slice('upgrade:'.length)]?.name ?? key)
            : key,
          amount,
        }))
        .filter((row) => !wanted || `${row.key} ${row.name}`.toLowerCase().includes(wanted))
        .sort((a, b) => b.amount - a.amount);
      return { total: rows.length, holdings: rows.slice(0, limit) };
    },
  );

  tool(
    'refresh_roster',
    'Fetch the roster from the Tacticus API and store it, replacing what was there. Needs TACTICUS_API_KEY in the server\'s environment; TACTICUS_RELAY_URL is used when set. Returns what changed rather than the whole response.',
    {},
    async () => {
      const before = await store.readPlayerText();
      const text = await fetchPlayerText();
      await store.writePlayerText(text);
      forgetPlayer();

      const now = JSON.parse(text) as { player: { details: { name: string; powerLevel: number }; units: unknown[] } };
      const previous = before
        ? (JSON.parse(before) as { player?: { details?: { powerLevel?: number }; units?: unknown[] } })
        : undefined;
      return {
        stored: `${dataDir()}/player.json`,
        name: now.player.details.name,
        units: now.player.units.length,
        powerLevel: now.player.details.powerLevel,
        changed: {
          powerLevel: (now.player.details.powerLevel ?? 0) - (previous?.player?.details?.powerLevel ?? 0),
          units: now.player.units.length - (previous?.player?.units?.length ?? 0),
          bytes: text.length - (before?.length ?? 0),
        },
        firstFetch: before === undefined,
      };
    },
  );
}
