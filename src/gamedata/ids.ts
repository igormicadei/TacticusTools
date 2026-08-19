/**
 * Identifier normalization.
 *
 * The canonical convention for the whole database is **the one the Tacticus API
 * itself uses**: `ultraEliminatorSgt`, `upgDmgU019`, `I_Crit_R001`,
 * `MortisRound`, `campaign1`. Source-specific spellings (Codex display names,
 * `gameInfo` slugs, two different battle-location formats) are converted here
 * and never leak into the normalized database.
 */

/** A unit id in API form, e.g. `ultraEliminatorSgt`. */
export type UnitId = string;
/** An upgrade material id, e.g. `upgDmgU019`. */
export type UpgradeId = string;
/** An equippable item id, e.g. `I_Crit_R001`. */
export type ItemId = string;
/** An ability id, e.g. `MortisRound`. */
export type AbilityId = string;
/** A campaign id in API form, e.g. `campaign1`, `elite2`, `eventExtremis1`. */
export type CampaignId = string;
/** An NPC id, e.g. `necroNpc1Warrior`. */
export type NpcId = string;

/**
 * A battle node, normalized away from the source spelling.
 *
 * Sources disagree on how to reference the same node:
 * - Codex `battledata.locationId`: `campaign1_01`      (campaign, node)
 * - `gameInfo` `upgrades[].battles`: `campaign2_2_53`  (campaign, campaign number, node)
 * - `gameInfo` `upgrades[].battlesCE`: `eventExtremis1_1012_03B` (event id, suffixed node)
 *
 * All three collapse to `{ campaignId, nodeNumber }`, which makes the two id
 * spaces joinable — they share no raw strings at all.
 */
export interface BattleRef {
  campaignId: CampaignId;
  /** 1-based node number as the game displays it. */
  nodeNumber: number;
  /**
   * 0-based index, matching `CampaignProgress.battles[].battleIndex` in the
   * player API. Always `nodeNumber - 1`.
   */
  battleIndex: number;
  /**
   * Node suffix for variant nodes (`03B` -> `"B"`), otherwise absent.
   * Event campaigns use these; standard campaigns do not.
   */
  variant?: string;
}

/** Stable string key for a {@link BattleRef}, for use as a map key. */
export function battleKey(ref: Pick<BattleRef, 'campaignId' | 'nodeNumber'> & { variant?: string }): string {
  return `${ref.campaignId}_${String(ref.nodeNumber).padStart(2, '0')}${ref.variant ?? ''}`;
}

/**
 * Parse any source battle-location string into a {@link BattleRef}.
 *
 * Two-part forms are `campaign_node`; three-part forms carry a redundant middle
 * segment (the campaign's own number, or an event config id) which is dropped.
 * Returns `undefined` rather than throwing, so a malformed reference in a
 * 10k-entry source skips that row instead of failing the whole load.
 */
export function parseBattleRef(location: string): BattleRef | undefined {
  const parts = location.split('_');
  if (parts.length < 2 || parts.length > 3) return undefined;

  const campaignId = parts[0];
  const nodeRaw = parts[parts.length - 1];
  if (!campaignId || !nodeRaw) return undefined;

  const matched = /^(\d+)([A-Za-z]*)$/.exec(nodeRaw);
  if (!matched?.[1]) return undefined;

  const nodeNumber = Number(matched[1]);
  if (!Number.isInteger(nodeNumber) || nodeNumber < 1) return undefined;

  const variant = matched[2] ? matched[2] : undefined;
  return {
    campaignId,
    nodeNumber,
    battleIndex: nodeNumber - 1,
    ...(variant ? { variant } : {}),
  };
}

/**
 * NPC ids used by Codex battle data that `gameInfo` spells differently.
 *
 * Codex's tutorial-era short names cover the basic Necron enemies of the first
 * campaign, so they account for a disproportionate share of unresolved rows.
 * Extend this table as new mismatches surface — `npcAliasCoverage` in the
 * loader reports what is still unresolved.
 */
export const NPC_ID_ALIASES: Readonly<Record<string, NpcId>> = {
  necroWarrior: 'necroNpc1Warrior',
  necroFlayedOne: 'necroNpc2FlayedOne',
};

/** Resolve a source NPC id to its canonical `gameInfo` id. */
export function canonicalNpcId(id: string): NpcId {
  return NPC_ID_ALIASES[id] ?? id;
}

/**
 * Codex refers to shard rewards as lowercase display text (`"certus shards"`)
 * rather than a unit id. Strip the suffix so the remainder can be resolved
 * against the unit name index.
 */
export function parseShardReward(reward: string): string | undefined {
  const matched = /^(.*?)\s+shards?$/i.exec(reward.trim());
  return matched?.[1]?.trim() || undefined;
}
