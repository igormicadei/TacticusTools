import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';

import { rankName, rarityName } from '@lib/gamedata/enums.js';
import { projectedStats, resolvePlan } from '@lib/gamedata/plan.js';
import { computeUnitStats } from '@lib/gamedata/stats.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { PlanRoadmap } from '../components/PlanRoadmap.tsx';
import { plansStore } from '../data/plans.ts';
import { describeTarget } from './PlansPage.tsx';

export function PlanDetailPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  const { planId = '' } = useParams();
  const stored = useMemo(() => plansStore.get(planId), [planId]);
  const unit = stored
    ? player.player.units.find((u) => u.id === stored.unitId)
    : undefined;

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

  const plan = resolvePlan(unit, stored.target, db);
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
            {plan.steps.length === 0 ? 'Complete' : `${plan.steps.length} steps`}
          </span>
        </div>
      </div>

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
                <tr key={s.order}>
                  <td className="muted">{s.order}</td>
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
