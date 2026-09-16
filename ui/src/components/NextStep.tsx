import { useMemo, useState } from 'react';

import { allocateHoldings, farmingCost, ownedByKey, planCosts } from '@lib/gamedata/requirements.js';
import type { EvolutionPlan } from '@lib/gamedata/plan.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse, Unit } from '@lib/types/player.js';

import { ItemRow, toggleOpen } from './StepItems.tsx';
import { energyLabel } from './PlanCost.tsx';
import { localNumber, localStepLabel } from '../i18n/game.ts';
import { t } from '../i18n/locale.ts';

/**
 * The next thing to do on a plan, collapsed behind a toggle — the same
 * per-item detail the plan's own page shows for a step, scoped to just the
 * one step that comes next.
 *
 * Built for the Plans list, where a card has room to say what the step is but
 * not to lay out the whole route: opening it answers "what do I actually need
 * right now", priced and allocated exactly as the plan's own page would price
 * this same step — it *is* that step, not a separate estimate of it.
 */
export function NextStep({
  unit,
  plan,
  db,
  player,
}: {
  unit: Unit;
  plan: EvolutionPlan;
  db: GameDatabase;
  player: PlayerResponse;
}) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingOnly, setPendingOnly] = useState(false);

  const next = plan.steps.find((step) => !step.done);

  const { items, gold, energy } = useMemo(() => {
    if (!next) return { items: [], gold: 0, energy: 0 };
    const costs = planCosts(unit, { ...plan, steps: [next] }, db);
    const owned = ownedByKey(player, db);
    const allocated = allocateHoldings(costs, owned, db);
    const step = allocated[0];
    return {
      items: step?.items ?? [],
      gold: step?.gold ?? 0,
      energy: farmingCost(step?.items ?? [], db, player).energy,
    };
  }, [next, unit, plan, db, player]);

  if (!next) return null;

  const shown = pendingOnly ? items.filter((item) => !item.applied) : items;

  return (
    <div className="next-step">
      <div className="next-step-label">{t('si.nextStep')}</div>
      <button
        type="button"
        className="next-step-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
        <span className="step-num">{next.order}</span>
        {localStepLabel(next)}
        {gold > 0 && <span className="chip gold">{t('si.goldChip', { n: localNumber(gold) })}</span>}
        {energy > 0 && (
          <span className="chip energy" title={t('cost.energyHint')}>
            {t('cost.energy', { n: energyLabel(energy) })}
          </span>
        )}
      </button>
      {expanded && (
        <>
          {items.length > 0 && (
            <label className="switch" title={t('si.pendingOnlyHint')}>
              <input
                type="checkbox"
                checked={pendingOnly}
                onChange={(e) => setPendingOnly(e.target.checked)}
              />
              <span>{t('si.pendingOnly')}</span>
            </label>
          )}
          {shown.length === 0 ? (
            <p className="muted small" style={{ margin: '4px 0 0 30px' }}>
              {items.length === 0 ? t('si.noItems') : t('si.allApplied')}
            </p>
          ) : (
            <ul className="item-list">
              {shown.map((item) => (
                <ItemRow
                  key={`${item.key}:${item.applied ? 'a' : 'n'}`}
                  id={`${item.key}:${item.applied ? 'a' : 'n'}`}
                  item={item}
                  db={db}
                  player={player}
                  open={open}
                  onToggle={(id) => setOpen((current) => toggleOpen(current, id))}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
