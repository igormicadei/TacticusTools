/**
 * Joins a player payload to the game database and derives the roster views.
 */

import { Rarity, rarityName } from '@lib/gamedata/enums.js';
import type { GameDatabase, UnitDefinition } from '@lib/gamedata/types.js';
import type { PlayerResponse, Unit } from '@lib/types/player.js';

/** Whether the player has the unit, has partial shards, or neither. */
export type OwnershipStatus = 'owned' | 'unlockable' | 'locked';

export interface RosterEntry {
  id: string;
  name: string;
  status: OwnershipStatus;
  definition: UnitDefinition | undefined;
  /** Present only when {@link RosterEntry.status} is `owned`. */
  unit: Unit | undefined;
  /** Shards held toward unlocking or ascending. */
  shards: number;
  mythicShards: number;
  factionId: string;
  /** Rarity implied by the unit's star level, for owned units. */
  rarity: Rarity | undefined;
  starLevel: number | undefined;
}

export interface RosterGroup<T extends string = string> {
  key: T;
  label: string;
  entries: RosterEntry[];
}

const STATUS_LABELS: Record<OwnershipStatus, string> = {
  owned: 'Available',
  unlockable: 'Shards collected',
  locked: 'Not started',
};

const STATUS_ORDER: OwnershipStatus[] = ['owned', 'unlockable', 'locked'];

/**
 * Build one entry per unit known to either side.
 *
 * Every unit in the database appears, so the roster shows what is *not* owned
 * as well as what is. Units the player owns but the database does not know are
 * still listed, using the name the API supplied.
 */
export function buildRoster(player: PlayerResponse, db: GameDatabase): RosterEntry[] {
  const owned = new Map<string, Unit>(player.player.units.map((u) => [u.id, u]));
  const shardsById = new Map<string, number>();
  for (const shard of player.player.inventory.shards) {
    shardsById.set(shard.id, (shardsById.get(shard.id) ?? 0) + shard.amount);
  }
  const mythicById = new Map<string, number>();
  for (const shard of player.player.inventory.mythicShards) {
    mythicById.set(shard.id, (mythicById.get(shard.id) ?? 0) + shard.amount);
  }

  const rarityByStar = new Map(
    db.progressionRequirements.map((r) => [r.progressionIndex, r.rarity]),
  );

  const ids = new Set([...Object.keys(db.units), ...owned.keys()]);
  const entries: RosterEntry[] = [];

  for (const id of ids) {
    const definition = db.units[id];
    const unit = owned.get(id);
    // Shards for an owned unit live on the unit itself; for one not yet
    // unlocked they sit in the inventory.
    const shards = unit ? unit.shards : (shardsById.get(id) ?? 0);
    const mythicShards = unit ? unit.mythicShards : (mythicById.get(id) ?? 0);

    const status: OwnershipStatus = unit
      ? 'owned'
      : shards > 0 || mythicShards > 0
        ? 'unlockable'
        : 'locked';

    entries.push({
      id,
      name: unit?.name ?? definition?.name ?? id,
      status,
      definition,
      unit,
      shards,
      mythicShards,
      factionId: unit?.faction ?? definition?.factionId ?? 'Unknown',
      rarity: unit ? rarityByStar.get(unit.progressionIndex) : undefined,
      starLevel: unit ? unit.progressionIndex : undefined,
    });
  }

  return entries;
}

const byName = (a: RosterEntry, b: RosterEntry) => a.name.localeCompare(b.name);

/** Owned units first, then partial shards, then untouched. */
export function groupByOwnership(entries: RosterEntry[]): RosterGroup<OwnershipStatus>[] {
  return STATUS_ORDER.map((key) => ({
    key,
    label: STATUS_LABELS[key],
    entries: entries.filter((e) => e.status === key).sort(sortWithinOwnership(key)),
  })).filter((group) => group.entries.length > 0);
}

/**
 * Within a group, lead with what the player is furthest along on: owned units by
 * power-ish progression, partial units by shards collected, locked ones by name.
 */
function sortWithinOwnership(status: OwnershipStatus) {
  if (status === 'owned') {
    return (a: RosterEntry, b: RosterEntry) =>
      (b.unit?.progressionIndex ?? 0) - (a.unit?.progressionIndex ?? 0) ||
      (b.unit?.rank ?? 0) - (a.unit?.rank ?? 0) ||
      byName(a, b);
  }
  if (status === 'unlockable') {
    return (a: RosterEntry, b: RosterEntry) => b.shards - a.shards || byName(a, b);
  }
  return byName;
}

/** Group by faction, ordered by how many the player already has. */
export function groupByFaction(entries: RosterEntry[]): RosterGroup[] {
  const byFaction = new Map<string, RosterEntry[]>();
  for (const entry of entries) {
    const list = byFaction.get(entry.factionId);
    if (list) list.push(entry);
    else byFaction.set(entry.factionId, [entry]);
  }

  return [...byFaction.entries()]
    .map(([key, list]) => ({
      key,
      label: humaniseFaction(key),
      entries: list.sort(
        (a, b) =>
          STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byName(a, b),
      ),
    }))
    .sort(
      (a, b) =>
        b.entries.filter((e) => e.status === 'owned').length -
          a.entries.filter((e) => e.status === 'owned').length ||
        a.label.localeCompare(b.label),
    );
}

/** `AdeptusMechanicus` -> `Adeptus Mechanicus`. */
export function humaniseFaction(factionId: string): string {
  return factionId.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

export function rarityLabel(rarity: Rarity | undefined): string {
  return rarity === undefined ? 'Unknown' : rarityName(rarity);
}

/** Roster-wide counts for the page header. */
export function summarise(entries: RosterEntry[]) {
  return {
    total: entries.length,
    owned: entries.filter((e) => e.status === 'owned').length,
    unlockable: entries.filter((e) => e.status === 'unlockable').length,
    locked: entries.filter((e) => e.status === 'locked').length,
  };
}
