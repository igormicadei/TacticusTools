import type { FarmingCost } from '@lib/gamedata/requirements.js';

import { localNumber } from '../i18n/game.ts';
import { t, tn } from '../i18n/locale.ts';

/**
 * Energy as a whole number, for display.
 *
 * The library keeps it exact so that a total and the rows beneath it are the
 * same arithmetic; rounding belongs here, once, at the last moment. Values
 * below one still round up: "0 ⚡" beside something you have not got yet reads
 * as free, which is the one thing it is not.
 */
export function energyLabel(energy: number): string {
  return localNumber(energy < 1 ? Math.ceil(energy) : Math.round(energy));
}

/**
 * What a plan still costs, in the three units that answer different questions.
 *
 * The chip this replaced read "5 items missing", which was a count of copies of
 * the *named* requirements — neither the slots the game shows you nor the drops
 * you would actually go and farm, and smaller than both. Someone reading it
 * planned around a number that meant nothing they could act on.
 *
 * - Slots is the work in the game's own terms, and the one that does not move
 *   when your inventory does.
 * - Drops is the work at a campaign screen: every recipe resolved down to what
 *   a node really drops.
 * - Energy is what those drops cost at the cheapest node open to you.
 */
export function PlanCost({ cost }: { cost: FarmingCost }) {
  if (cost.slots === 0 && cost.copies === 0) {
    return <span className="chip ok-chip">{t('cost.nothingLeft')}</span>;
  }
  return (
    <>
      {cost.slots > 0 && (
        <span className="chip" title={t('cost.slotsHint')}>
          {tn(cost.slots, 'cost.slots', 'cost.slotsPlural')}
        </span>
      )}
      {cost.copies > 0 && (
        <span className="chip" title={t('cost.toFarmHint', { distinct: cost.distinct })}>
          {tn(cost.copies, 'cost.toFarm', 'cost.toFarmPlural')}
        </span>
      )}
      {cost.energy > 0 && (
        <span className="chip energy" title={t('cost.energyHint')}>
          {t('cost.energy', { n: energyLabel(cost.energy) })}
        </span>
      )}
      {/* Said out loud rather than folded in: an item with no open node is not
          cheap, it is unavailable, and adding nothing for it would read as the
          energy figure being complete when it is not. */}
      {cost.unpriced > 0 && (
        <span className="chip warn" title={t('cost.unpricedHint')}>
          {t('cost.unpriced', { n: cost.unpriced })}
        </span>
      )}
    </>
  );
}
