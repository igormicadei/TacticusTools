/**
 * Equipment as a catalogue: which units could ever wear a given piece, and
 * which pieces a given unit could ever wear.
 *
 * "Could ever" rather than "can right now" — this ignores a unit's present
 * rarity (which caps what it may equip *today*, see {@link EquipmentPool} in
 * `teams.ts`) and answers the catalogue question instead: put every rarity of
 * this item on the table, which units are eligible for any of them at all?
 * That is what a player planning ahead of a farm actually wants to know.
 */

import type { GameDatabase, ItemDefinition, UnitDefinition } from './types.js';

/**
 * Whether `unit` could ever equip `item`, by slot category and by whatever
 * restriction the item carries.
 *
 * A character-bound Relic names its units outright in `allowedUnits`; only
 * when that list is empty does the faction restriction in `allowedFactions`
 * apply on its own. Empty in both means unrestricted.
 */
export function itemFitsUnit(item: ItemDefinition, unit: UnitDefinition): boolean {
  if (!unit.itemSlots.includes(item.itemType)) return false;
  if (item.allowedUnits.length > 0) return item.allowedUnits.includes(unit.id);
  if (item.allowedFactions.length > 0) {
    return unit.factionId !== undefined && item.allowedFactions.includes(unit.factionId);
  }
  return true;
}

/** Every unit an item could ever be equipped on, across the whole database. */
export function compatibleUnits(item: ItemDefinition, db: GameDatabase): UnitDefinition[] {
  return Object.values(db.units).filter((unit) => itemFitsUnit(item, unit));
}

/** Every item a unit could ever equip, across all three of its slots. */
export function itemsForUnit(unit: UnitDefinition, db: GameDatabase): ItemDefinition[] {
  return Object.values(db.items).filter((item) => itemFitsUnit(item, unit));
}

/**
 * Every item that fits one specific slot of a unit — the options worth
 * offering when planning what to put there.
 *
 * `slotId` is `"Slot1"`/`"Slot2"`/`"Slot3"`; unlike {@link itemsForUnit} this
 * also fixes the category to what that particular slot asks for, since a
 * unit's Defense slot is stuck on Block *or* Defensive and cannot take the
 * other even though both are "equippable by this unit" in general.
 */
export function itemOptionsForSlot(
  unit: UnitDefinition,
  slotId: string,
  db: GameDatabase,
): ItemDefinition[] {
  const slotIndex = Number(slotId.replace(/\D+/g, '')) - 1;
  const wanted = unit.itemSlots[slotIndex];
  if (!wanted) return [];
  return Object.values(db.items).filter(
    (item) => item.itemType === wanted && itemFitsUnit(item, unit),
  );
}
