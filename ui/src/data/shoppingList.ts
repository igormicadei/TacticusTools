/**
 * Every active plan's equipment targets, added up into one list.
 *
 * A plan's own page already prices its item targets on their own — this asks
 * the same question across every plan at once: what do all of them still
 * want, and what does the whole pile cost. Nothing here is a new formula;
 * `resolveItemTarget` still does the pricing, per target, exactly as it does
 * on a single plan's page.
 */

import type { Rarity } from '@lib/gamedata/enums.js';
import { resolveItemTarget, type ItemPlan, type ItemTarget } from '@lib/gamedata/itemPlan.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse, Unit } from '@lib/types/player.js';

import { readPlansSort, type StoredPlan } from './plans.ts';

export interface ShoppingListRow {
  planId: string;
  unitId: string;
  unitName: string;
  target: ItemTarget;
  plan: ItemPlan;
  /**
   * Set when this row's cost assumes a loose copy already sitting in the
   * inventory, rather than starting the item fresh at level 1.
   */
  fromLoose?: { level: number } | undefined;
}

export interface ShoppingListTotals {
  dust: number;
  gold: number;
  mythicDust: number;
  forgeBadges: Partial<Record<Rarity, number>>;
}

/** One inventory item id's loose copies, highest level first — the most useful to hand out. */
function looseByItem(player: PlayerResponse): Map<string, { level: number; amount: number }[]> {
  const map = new Map<string, { level: number; amount: number }[]>();
  for (const held of player.player.inventory.items) {
    const list = map.get(held.id) ?? [];
    list.push({ level: held.level ?? 1, amount: held.amount });
    map.set(held.id, list);
  }
  for (const list of map.values()) list.sort((a, b) => b.level - a.level);
  return map;
}

/**
 * Every active plan's item targets, priced and — optionally — netted against
 * loose stock already sitting in the inventory.
 *
 * Plans are read in the Plans list's own sort order (see
 * {@link readPlansSort}): when more than one plan targets the same item id
 * and nothing is worn yet, the loose copies on hand go to whichever plan
 * comes first in that order, so resorting the Plans list is how a player
 * decides who gets first claim on a shared, scarce item.
 */
export function buildShoppingList(
  plans: readonly StoredPlan[],
  units: readonly Unit[],
  db: GameDatabase,
  player: PlayerResponse,
  accountForInventory: boolean,
): { rows: ShoppingListRow[]; totals: ShoppingListTotals } {
  const unitById = new Map(units.map((u) => [u.id, u]));
  const sort = readPlansSort();
  const ordered = [...plans].sort((a, b) =>
    sort === 'name'
      ? (unitById.get(a.unitId)?.name ?? a.unitId).localeCompare(
          unitById.get(b.unitId)?.name ?? b.unitId,
        )
      : b.createdAt - a.createdAt,
  );

  const loose: Map<string, { level: number; amount: number }[]> = accountForInventory
    ? looseByItem(player)
    : new Map();
  const rows: ShoppingListRow[] = [];
  const totals: ShoppingListTotals = { dust: 0, gold: 0, mythicDust: 0, forgeBadges: {} };

  for (const stored of ordered) {
    const unit = unitById.get(stored.unitId);
    if (!unit || !stored.itemTargets) continue;
    for (const target of stored.itemTargets) {
      const worn = unit.items.some((i) => i.slotId === target.slotId);
      let plan: ItemPlan;
      let fromLoose: { level: number } | undefined;

      if (!worn && accountForInventory) {
        const bucket = loose.get(target.itemId);
        const best = bucket?.[0];
        if (best) {
          // A synthetic "current item" — the loose copy, as if it were already
          // worn — so the same ascension-chain pricing in `resolveItemTarget`
          // starts from what is actually on hand instead of level 1.
          const hypothetical: Unit = {
            ...unit,
            items: [...unit.items, { slotId: target.slotId, id: target.itemId, level: best.level }],
          };
          plan = resolveItemTarget(hypothetical, target, db);
          fromLoose = { level: best.level };
          best.amount -= 1;
          if (best.amount <= 0) bucket.shift();
        } else {
          plan = resolveItemTarget(unit, target, db);
        }
      } else {
        plan = resolveItemTarget(unit, target, db);
      }

      rows.push({
        planId: stored.id,
        unitId: unit.id,
        unitName: stored.name || unit.name || unit.id,
        target,
        plan,
        fromLoose,
      });

      totals.dust += plan.cost.dust;
      totals.gold += plan.cost.gold;
      totals.mythicDust += plan.cost.mythicDust;
      for (const [rarity, need] of Object.entries(plan.cost.forgeBadges)) {
        const r = Number(rarity) as Rarity;
        totals.forgeBadges[r] = (totals.forgeBadges[r] ?? 0) + (need ?? 0);
      }
    }
  }

  return { rows, totals };
}
