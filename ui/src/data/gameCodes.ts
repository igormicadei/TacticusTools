/**
 * Redemption codes: where they come from, and what the player has done with
 * each one.
 *
 * The two are deliberately separate. `isActive` on a {@link GameCode} is
 * Tacticus Codex's own claim about whether the game still accepts it — it
 * says nothing about whether *this* player has redeemed it, which the source
 * has no notion of at all. That half lives only in this browser.
 */

import { requirementIcon, uiIcon } from './icons.ts';

import type { GameCode, GameCodeReward } from '@lib/types/gameCodes.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

/* -------------------------------------------------------------------------- */
/* Sourcing                                                                   */
/* -------------------------------------------------------------------------- */

let fallbackPending: Promise<GameCode[]> | undefined;

/**
 * The snapshot bundled with the site, fetched once per session and memoised
 * the same way `loadGameData` treats `gamedata.json`.
 */
function loadFallbackCodes(): Promise<GameCode[]> {
  fallbackPending ??= fetch(`${import.meta.env.BASE_URL}codes.snapshot.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ gameCodes?: GameCode[] }>) : { gameCodes: [] }))
    .then((data) => (Array.isArray(data.gameCodes) ? data.gameCodes : []))
    .catch(() => []);
  return fallbackPending;
}

/**
 * Every known code, from the freshest source available.
 *
 * The relay appends `gameCodes` to every player refresh once it is updated to
 * do so (see `relay/cloudflare-worker.js`) — that is the live path, as fresh
 * as the last time the player data was refreshed. Until that relay is
 * deployed, or on the rare refresh where its own fetch of Tacticus Codex
 * failed, this falls back to the snapshot bundled with the site
 * (`scripts/snapshot-codes.mjs`), so the feature has something to show either
 * way rather than nothing.
 */
export async function resolveGameCodes(player: PlayerResponse | undefined): Promise<GameCode[]> {
  if (player?.gameCodes && player.gameCodes.length > 0) return player.gameCodes;
  return loadFallbackCodes();
}

/* -------------------------------------------------------------------------- */
/* Local state: what the player has done with a code                         */
/* -------------------------------------------------------------------------- */

type Action = 'used' | 'dismissed';

const STATE_KEY = 'tacticus-tools:codes-state';
const SEEN_KEY = 'tacticus-tools:codes-seen';

function readActions(): Record<string, Action> {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Action>) : {};
  } catch {
    return {};
  }
}

function writeActions(value: Record<string, Action>): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(value));
  } catch {
    /* Private mode, or storage disabled — the choice still holds for this render. */
  }
}

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeSeen(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    /* Private mode, or storage disabled — the choice still holds for this render. */
  }
}

export const codesStore = {
  /** What this player did with this code, if anything. */
  action(id: string): Action | undefined {
    return readActions()[id];
  },
  markUsed(id: string): void {
    const actions = readActions();
    actions[id] = 'used';
    writeActions(actions);
  },
  /**
   * There is no endpoint this app can call to flag a code as expired on
   * Tacticus Codex — that action exists on their site, but only for a
   * visitor signed into their own account there, which this app has no way
   * to be. So "dismiss" is local-only: the card leaves this player's list,
   * same as marking it used, without claiming to have told anyone anything.
   */
  markDismissed(id: string): void {
    const actions = readActions();
    actions[id] = 'dismissed';
    writeActions(actions);
  },
  undo(id: string): void {
    const actions = readActions();
    delete actions[id];
    writeActions(actions);
  },
  isSeen(id: string): boolean {
    return readSeen().has(id);
  },
  /** Called when the notification bell is opened: clears its own badge. */
  markAllSeen(ids: readonly string[]): void {
    const seen = readSeen();
    for (const id of ids) seen.add(id);
    writeSeen(seen);
  },
};

/** Codes still worth acting on: active in-game, and not used or dismissed. */
export function outstandingCodes(codes: readonly GameCode[]): GameCode[] {
  return codes.filter((c) => c.isActive && !codesStore.action(c.id));
}

/** Outstanding codes the player has not had the bell tell them about yet. */
export function unseenCodes(codes: readonly GameCode[]): GameCode[] {
  return outstandingCodes(codes).filter((c) => !codesStore.isSeen(c.id));
}

/* -------------------------------------------------------------------------- */
/* Reward display                                                            */
/* -------------------------------------------------------------------------- */

/** `"raid-ticket"` / `"ability badge"` -> `"Raid Ticket"` / `"Ability Badge"`. */
function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface RewardDisplay {
  label: string;
  icon?: string | undefined;
}

/**
 * How to show one reward line.
 *
 * `shards` and `upgrade`/`upgrades` name a unit or a material by a lowercase
 * string Tacticus Codex writes for its own page, not one of this project's
 * ids — so it is matched against {@link GameDatabase} by name by way of a
 * proper icon and the game's own capitalisation, and only falls back to the
 * raw string when nothing matches. Every other reward type is Tacticus
 * Codex's own vocabulary for a currency this app has no further data on, so it
 * is shown as Tacticus Codex names it, with an icon only where this project
 * already has an unambiguous one — a wrong icon would mislead about which
 * currency this is, which no icon at all does not.
 */
export function describeReward(reward: GameCodeReward, db: GameDatabase): RewardDisplay {
  const n = reward.quantity;

  if (reward.type === 'shards' && reward.name) {
    const unit = Object.values(db.units).find(
      (u) => u.name.toLowerCase() === reward.name.toLowerCase(),
    );
    return {
      label: `${n}x ${unit?.name ?? titleCase(reward.name)}`,
      icon: requirementIcon(`shard:${unit?.id ?? '__generic__'}`),
    };
  }

  if ((reward.type === 'upgrade' || reward.type === 'upgrades') && reward.name) {
    const upgrade = Object.values(db.upgrades).find(
      (u) => u.name.toLowerCase() === reward.name.toLowerCase(),
    );
    return {
      label: `${n}x ${upgrade?.name ?? titleCase(reward.name)}`,
      icon: upgrade ? requirementIcon(`upgrade:${upgrade.id}`) : undefined,
    };
  }

  const UNAMBIGUOUS_ICONS: Record<string, string> = {
    gold: 'gold',
    energy: 'energy',
    requisition: 'requisition',
    blackstone: 'blackstone',
    'raid-ticket': 'raidTicket',
  };
  const icon = UNAMBIGUOUS_ICONS[reward.type] ? uiIcon(UNAMBIGUOUS_ICONS[reward.type]!) : undefined;

  if (reward.type === 'books') {
    const rarity = reward.subType ? `${titleCase(reward.subType)} ` : '';
    return { label: `${n}x ${rarity}XP Book${n === 1 ? '' : 's'}` };
  }
  if (reward.type === 'token' && reward.subType) {
    return { label: `${n}x ${titleCase(reward.subType)} Token${n === 1 ? '' : 's'}` };
  }
  if (reward.name) {
    return { label: `${n}x ${titleCase(reward.name)}`, icon };
  }
  return { label: `${n}x ${titleCase(reward.type)}`, icon };
}
