/**
 * Enum values as words, for fields that are often absent.
 *
 * The database leaves a rarity or an alliance off a row it has no value for,
 * and the library's own name functions take a number. Rather than every call
 * site inventing a guard, missing means missing here and says so.
 */

import { GRAND_ALLIANCE_NAMES, RANK_NAMES, RARITY_NAMES } from '../../dist/gamedata/index.js';

const label = (names: readonly string[]) => (value: number | undefined): string | undefined =>
  value === undefined || value < 0 ? undefined : (names[value] ?? undefined);

export const allianceName = label(GRAND_ALLIANCE_NAMES);
export const rarityLabel = label(RARITY_NAMES);
export const rankLabel = label(RANK_NAMES);
