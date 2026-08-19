import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { rankName, rarityName } from '@lib/gamedata/enums.js';
import { currentState, markProgress, projectedStats, resolvePlan } from '@lib/gamedata/plan.js';
import { computeUnitStats } from '@lib/gamedata/stats.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { PlanRoadmap } from '../components/PlanRoadmap.tsx';
import { StepItems } from '../components/StepItems.tsx';
import { plansStore } from '../data/plans.ts';
import { describeTarget, PlanForm } from './PlansPage.tsx';

export function PlanDetailPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
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
          ← All plans
        </Link>
        <div className="empty">That plan no longer matches a unit in your roster.</div>
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

  return (
    <>
      <Link to="/plans" className="back">
        ← All plans
      </Link>

      <div className="detail-head">
        <div>
          <h1>{stored.name || unit.name || unit.id}</h1>
          <div className="muted">Target: {describeTarget(stored.target)}</div>
        </div>
        <div className="row wrap" style={{ marginLeft: 'auto' }}>
          <Link className="chip" to={`/units/${encodeURIComponent(unit.id)}`}>
            View unit
          </Link>
          <span className="chip">
            {left === 0 ? 'Complete' : `${left} of ${plan.steps.length} steps left`}
          </span>
          <button className="small" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : 'Edit plan'}
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
        <h3>After the plan</h3>
        <div className="stat-grid">
          <Delta label="Rarity" from={rarityName(plan.current.rarity ?? 0)} to={rarityName(plan.final.rarity ?? 0)} />
          <Delta label="Rank" from={rankName(plan.current.rank)} to={rankName(plan.final.rank)} />
          <Delta label="Level" from={plan.current.xpLevel} to={plan.final.xpLevel} />
          <Delta label="Active" from={plan.current.activeAbilityLevel} to={plan.final.activeAbilityLevel} />
          <Delta label="Passive" from={plan.current.passiveAbilityLevel} to={plan.final.passiveAbilityLevel} />
        </div>

        {now && then && (
          <>
            <h3 style={{ marginTop: 20 }}>Attributes</h3>
            <div className="stat-grid">
              <Delta label="Health" from={now.health} to={then.health} />
              <Delta label="Damage" from={now.damage} to={then.damage} />
              <Delta label="Armour" from={now.armour} to={then.armour} />
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Projected at {rankName(plan.final.rank)} with {then.starLevel ?? 0} stars
              (×{then.starMultiplier.toFixed(2)}), counting no rank upgrades applied —
              reaching a rank consumes the previous rank's, so a newly reached rank starts
              empty. Equipment is unchanged.
            </p>
          </>
        )}
      </section>

      <section className="panel">
        <h3>Order of work</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Each attribute is pushed as far as the current rarity allows before ascending, so
          nothing is farmed for a rank that is still gated.
        </p>
        <PlanRoadmap steps={plan.steps} />

        {plan.steps.length > 0 && (
          <table className="steps">
            <thead>
              <tr>
                <th>#</th>
                <th>Step</th>
                <th>From → to</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {plan.steps.map((s) => (
                <tr key={s.order} className={s.done ? 'done' : ''}>
                  <td className="muted">{s.done ? '✓' : s.order}</td>
                  <td>{s.label}</td>
                  <td className="muted">
                    {s.from} → {s.to}
                  </td>
                  <td className="muted small">{s.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
