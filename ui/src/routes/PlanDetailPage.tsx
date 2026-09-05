import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { rankName, rarityName } from '@lib/gamedata/enums.js';
import {
  currentState,
  markProgress,
  projectedStats,
  projectedStatsAt,
  resolvePlan,
} from '@lib/gamedata/plan.js';
import { computeUnitStats, type ComputedUnitStats } from '@lib/gamedata/stats.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { PlanRoadmap } from '../components/PlanRoadmap.tsx';
import { StepItems } from '../components/StepItems.tsx';
import { plansStore } from '../data/plans.ts';
import { unitIcon } from '../data/icons.ts';
import { Icon, useIcons } from '../components/Icon.tsx';
import { describeTarget, PlanForm } from './PlansPage.tsx';
import { ProjectedStats } from '../components/ProjectedStats.tsx';
import { localRank, localStepLabel, localStepReason } from '../i18n/game.ts';
import { t } from '../i18n/locale.ts';

export function PlanDetailPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const { planId = '' } = useParams();
  const [editing, setEditing] = useState(false);
  // Bumped on save so the stored plan is re-read after an edit.
  const [revision, setRevision] = useState(0);
  const stored = useMemo(() => plansStore.get(planId), [planId, revision]);
  const units = useMemo(
    () => [...player.player.units].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id)),
    [player],
  );
  const unit = stored
    ? player.player.units.find((u) => u.id === stored.unitId)
    : undefined;

  // Plans saved before origins existed have no starting point to measure
  // against, so they adopt one the first time they are opened and track
  // progress from there.
  useEffect(() => {
    if (!stored || !unit || stored.origin) return;
    plansStore.update(stored.id, { origin: currentState(unit, db) });
    setRevision((v) => v + 1);
  }, [stored, unit, db]);

  if (!stored || !unit) {
    return (
      <>
        <Link to="/plans" className="back">
          {t('nav.backPlans')}
        </Link>
        <div className="empty">{t('plan.gone')}</div>
      </>
    );
  }

  const live = currentState(unit, db);
  // Resolving from where the plan started keeps finished steps on the page,
  // marked done, instead of letting them disappear as the unit advances.
  const plan = markProgress(resolvePlan(unit, stored.target, db, stored.origin), live);
  const left = plan.steps.filter((s) => !s.done).length;
  const now = computeUnitStats(unit, db);
  const then = projectedStats(unit, plan, db);

  /*
   * Attributes at each point along the plan.
   *
   * Each step's `after` state already carries the accumulation — it is the unit
   * as it stands once that step and everything before it is done — so this is a
   * lookup per step rather than a running sum, and cannot drift from the
   * plan's own arithmetic. The "before" of the first step is where the unit
   * stands today.
   */
  const { statsBefore, statsAfter } = useMemo(() => {
    const before = new Map<number, ComputedUnitStats | undefined>();
    const after = new Map<number, ComputedUnitStats | undefined>();
    let previous = now;
    for (const step of plan.steps) {
      const at = projectedStatsAt(unit, step.after, db);
      before.set(step.order, previous);
      after.set(step.order, at);
      previous = at;
    }
    return { statsBefore: before, statsAfter: after };
  }, [unit, plan, db, now]);

  return (
    <>
      <Link to="/plans" className="back">
        {t('nav.backPlans')}
      </Link>

      <div className="detail-head">
        <Icon src={unitIcon(unit.id)} alt="" size={72} className="portrait ornate" />
        <div>
          <h1>{stored.name || unit.name || unit.id}</h1>
          <div className="muted">Target: {describeTarget(stored.target)}</div>
        </div>
        <div className="row wrap" style={{ marginLeft: 'auto' }}>
          <Link className="chip" to={`/units/${encodeURIComponent(unit.id)}`}>
            {t('nav.viewUnit')}
          </Link>
          <span className="chip">
            {left === 0
              ? t('common.complete')
              : t('common.stepsLeft', { n: left, total: plan.steps.length })}
          </span>
          <button className="small" onClick={() => setEditing((v) => !v)}>
            {editing ? t('common.cancel') : t('common.editPlan')}
          </button>
        </div>
      </div>

      {editing && (
        <PlanForm
          db={db}
          units={units}
          plan={stored}
          onSaved={() => {
            setEditing(false);
            setRevision((v) => v + 1);
          }}
        />
      )}

      {plan.blocked && <div className="notice error">{plan.blocked}</div>}
      {plan.notes.map((n) => (
        <div className="notice" key={n}>
          {n}
        </div>
      ))}

      <section className="panel" style={{ marginBottom: 16 }}>
        <h3>{t('plan.afterPlan')}</h3>
        <div className="stat-grid">
          <Delta label={t('common.rarity')} from={rarityName(plan.current.rarity ?? 0)} to={rarityName(plan.final.rarity ?? 0)} />
          <Delta label={t('common.rank')} from={rankName(plan.current.rank)} to={rankName(plan.final.rank)} />
          <Delta label={t('common.level')} from={plan.current.xpLevel} to={plan.final.xpLevel} />
          <Delta label={t('common.active')} from={plan.current.activeAbilityLevel} to={plan.final.activeAbilityLevel} />
          <Delta label={t('common.passive')} from={plan.current.passiveAbilityLevel} to={plan.final.passiveAbilityLevel} />
        </div>

        {now && then && (
          <>
            <h3 style={{ marginTop: 20 }}>{t('plan.attributes')}</h3>
            <div className="stat-grid">
              <Delta label={t('common.health')} from={now.health} to={then.health} />
              <Delta label={t('common.damage')} from={now.damage} to={then.damage} />
              <Delta label={t('common.armour')} from={now.armour} to={then.armour} />
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              {t('plan.projected', {
                rank: localRank(plan.final.rank),
                stars: then.starLevel ?? 0,
                multiplier: then.starMultiplier.toFixed(2),
              })}
            </p>
          </>
        )}
      </section>

      <section className="panel">
        <h3>{t('plan.orderOfWork')}</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          {t('plan.orderBlurb')}
        </p>
        <PlanRoadmap steps={plan.steps} />

        {plan.steps.length > 0 && (
          <div className="table-wrap">
            <table className="steps stacked">
              <thead>
                <tr>
                  <th>{t('common.step')}</th>
                  <th>{t('common.fromTo')}</th>
                  <th>{t('common.why')}</th>
                  <th>{t('proj.afterStep')}</th>
                </tr>
              </thead>
              <tbody>
                {plan.steps.map((s) => (
                  <tr key={s.order} className={s.done ? 'done' : ''}>
                    <td data-label="" className="card-title-cell">
                      <span className="step-order muted">{s.done ? '✓' : s.order}</span>
                      {localStepLabel(s)}
                    </td>
                    <td data-label={t('common.fromTo')} className="muted">
                      {s.from} → {s.to}
                    </td>
                    <td data-label={t('common.why')} className="muted small">
                      {localStepReason(s) ?? '—'}
                    </td>
                    <td data-label={t('proj.afterStep')} className="small">
                      {/* Against the step before it, not against today, so the
                          column reads as a running total rather than repeating
                          the whole plan's gain on every row. */}
                      <ProjectedStats
                        from={statsBefore.get(s.order)}
                        to={statsAfter.get(s.order)}
                        compact
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <StepItems unit={unit} plan={plan} db={db} player={player} />
    </>
  );
}

function Delta({
  label,
  from,
  to,
}: {
  label: string;
  from: string | number;
  to: string | number;
}) {
  const changed = String(from) !== String(to);
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 15 }}>
        {changed ? (
          <>
            <span className="muted">{from}</span>{' '}
            <span style={{ color: 'var(--accent)' }}>→ {to}</span>
          </>
        ) : (
          <span>{to}</span>
        )}
      </div>
    </div>
  );
}
