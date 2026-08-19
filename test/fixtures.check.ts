/**
 * Compile-time verification that a payload built from the OpenAPI document's
 * own examples satisfies the declared response types. This file emits nothing;
 * `npm run typecheck` failing here means the types drifted from the spec.
 */

import type {
  ApiErrorBody,
  GuildRaidResponse,
  GuildResponse,
  PlayerResponse,
} from '../src/index.js';
import { toDate } from '../src/index.js';

const player: PlayerResponse = {
  player: {
    details: { name: 'player123', powerLevel: 10 },
    units: [
      {
        id: 'ultraEliminatorSgt',
        name: 'Certus',
        faction: 'Ultramarines',
        grandAlliance: 'Imperial',
        progressionIndex: 5,
        xp: 4552,
        xpLevel: 6,
        rank: 10,
        abilities: [{ id: 'MortisRound', level: 35 }],
        upgrades: [0, 4],
        items: [
          {
            slotId: 'Slot1',
            level: 2,
            id: 'I_Crit_R002',
            name: 'Sanctified Bolt Pistol',
            rarity: 'Rare',
          },
        ],
        shards: 100,
        mythicShards: 100,
      },
      // Only the required fields — every optional one must stay optional.
      {
        id: 'minimalUnit',
        progressionIndex: 0,
        xp: 0,
        xpLevel: 1,
        rank: 0,
        abilities: [],
        upgrades: [],
        items: [],
        shards: 0,
        mythicShards: 0,
      },
    ],
    inventory: {
      items: [{ id: 'I_Crit_U008', name: 'Aspect Shuriken Pistol', level: 1, amount: 6 }],
      upgrades: [{ id: 'upgDmgC008', name: 'Otherworldly Energy', amount: 2 }],
      shards: [{ id: 'ultraEliminatorSgt', name: 'Certus Shards', amount: 162 }],
      mythicShards: [{ id: 'ultraEliminatorSgt', amount: 3 }],
      xpBooks: [{ id: 'xpUncommon', rarity: 'Uncommon', amount: 164 }],
      abilityBadges: {
        Imperial: [{ name: 'Epic Imperial Badges', rarity: 'Epic', amount: 10 }],
        Xenos: [{ rarity: 'Common', amount: 1 }],
      },
      components: [{ name: 'Xenos Components', grandAlliance: 'Xenos', amount: 60 }],
      forgeBadges: [{ name: 'Uncommon Forge Badges', rarity: 'Uncommon', amount: 10 }],
      orbs: {
        Chaos: [{ rarity: 'Uncommon', amount: 10 }],
      },
      requisitionOrders: { regular: 10, blessed: 20 },
      resetStones: 1,
    },
    progress: {
      campaigns: [
        {
          id: 'campaign2',
          name: 'Fall of Cadia',
          type: 'Standard',
          battles: [{ battleIndex: 10, attemptsLeft: 2, attemptsUsed: 3 }],
        },
      ],
      arena: { tokens: { current: 1, max: 3, nextTokenInSeconds: 3000, regenDelayInSeconds: 43200 } },
      guildRaid: {
        tokens: { current: 1, max: 3, regenDelayInSeconds: 43200 },
        bombTokens: { current: 0, max: 1, regenDelayInSeconds: 86400 },
      },
      onslaught: {},
      salvageRun: { tokens: { current: 2, max: 2, regenDelayInSeconds: 3600 } },
      legendaryEvents: [
        {
          id: 'bloodDante',
          lanes: [
            {
              id: 1,
              name: 'Alpha',
              battleConfigs: [
                {
                  numEnemies: 5,
                  objectives: [{ objectiveType: 'Kill', objectiveTarget: 'All', score: 100 }],
                  disallowedFactions: ['Ultramarines'],
                },
              ],
              progress: [{ objectivesCleared: [0, 1], highScore: 900, encounterPoints: 12 }],
            },
          ],
          currentPoints: 40,
          currentCurrency: 120,
          currentShards: 30,
          currentClaimedChestIndex: 2,
          currentEvent: {
            run: 1,
            tokens: { current: 1, max: 3, regenDelayInSeconds: 43200 },
            hasUsedAdForExtraTokenToday: false,
            extraCurrencyPerPayout: 5,
          },
        },
      ],
    },
  },
  metaData: {
    configHash: '6070bc3fe1238ab5b2269efd75639b55',
    apiKeyExpiresOn: 1766067907,
    lastUpdatedOn: 0,
    scopes: ['Player'],
  },
};

// Observed live: a non-expiring key sends an explicit `null`, not an omission.
const nonExpiringKey: PlayerResponse['metaData'] = {
  configHash: '75ac12095df2ed41b1d9325b8f350700',
  apiKeyExpiresOn: null,
  lastUpdatedOn: 1787136934,
  scopes: ['Player'],
};

// Observed live: `Extremis` is a real campaign type absent from the spec enum,
// and two campaigns can share an id, differing only by type.
const eventCampaigns: PlayerResponse['player']['progress']['campaigns'] = [
  { id: 'eventCampaign6', name: '', type: 'Standard', battles: [] },
  { id: 'eventCampaign6', name: '', type: 'Extremis', battles: [] },
];

// Observed live: error bodies carry an undocumented numeric `code`.
const forbidden: ApiErrorBody = { type: 'FORBIDDEN', code: 2 };

const guild: GuildResponse = {
  guild: {
    guildId: 'e2b03cf8-93c0-4d01-ba66-abcdef62d65c',
    guildTag: 'ABCDE',
    name: 'Tacticus guild',
    level: 5,
    members: [
      { userId: 'a6977954-4da1-4218-b939-accdef523bc4', role: 'LEADER', level: 35, lastActivityOn: 1766067907 },
      { userId: 'b6977954-4da1-4218-b939-accdef523bc4', role: 'MEMBER', level: 12 },
    ],
    guildRaidSeasons: [68, 69],
  },
};

const guildRaid: GuildRaidResponse = {
  season: 69,
  seasonConfigId: 'season69',
  entries: [
    {
      userId: 'a6977954-4da1-4218-b939-accdef523bc4',
      tier: 0,
      set: 0,
      encounterIndex: 0,
      remainingHp: 12500,
      maxHp: 18000,
      encounterType: 'Boss',
      unitId: 'GuildBoss1Boss1TyranTervigonLeviathan',
      type: 'TervigonLeviathan',
      rarity: 'Common',
      damageDealt: 2000,
      damageType: 'Battle',
      startedOn: 1766067907,
      completedOn: '2026-01-01T00:00:00Z',
      heroDetails: [{ unitId: 'ultraEliminatorSgt', power: 5700 }],
      machineOfWarDetails: { unitId: 'someMachine', power: 4200 },
      globalConfigHash: '5ef79f82bafac0e91746e0ff3ecb83c8',
    },
  ],
};

// Both timestamp representations must normalise.
const started: Date | undefined = toDate(guildRaid.entries[0]?.startedOn);
const ended: Date | undefined = toDate(guildRaid.entries[0]?.completedOn);

export const fixtures = {
  player,
  nonExpiringKey,
  eventCampaigns,
  forbidden,
  guild,
  guildRaid,
  started,
  ended,
};
