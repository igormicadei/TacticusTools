import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { rankName, rarityName, Rarity } from '@lib/gamedata/enums.js';
import { currentState, markProgress, resolvePlan } from '@lib/gamedata/plan.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { plansStore, type StoredPlan } from '../data/plans.ts';

export function PlansPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  const navigate = useNavigate();
  const [plans, setPlans] = useState(() => plansStore.list());
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string>();

  const owned = useMemo(
    () => [...player.player.units].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id)),
    [player],
  );

  const remove = (id: string) => {
    plansStore.remove(id);
    setPlans(plansStore.list());
  };

  return (
    <>
      <div className="toolbar">
        <h2 style={{ margin: 0, fontSize: 18 }}>Evolution plans</h2>
        <span style={{ flex: 1 }} />
        <button
          className="primary"
          onClick={() => {
            setEditing(undefined);
            setCreating((v) => !v);
          }}
        >
          {creating ? 'Cancel' : 'New plan'}
        </button>
      </div>

      {creating && (
        <PlanForm db={db} units={owned} onSaved={(id) => navigate(`/plans/${id}`)} />
      )}

      {plans.length === 0 && !creating && (
        <div className="empty">
          No plans yet. Create one to work out what to level, rank and ascend, in order.
        </div>
      )}

      <div className="grid">
        {plans.map((stored) => {
          const unit = owned.find((u) => u.id === stored.unitId);
          if (!unit) return null;
          const plan = markProgress(
            resolvePlan(unit, stored.target, db, stored.origin),
            currentState(unit, db),
          );
          const left = plan.steps.filter((s) => !s.done).length;
          const done = left === 0;
          return (
            <div className="card" key={stored.id} style={{ '--status': done ? 'var(--status-owned)' : 'var(--status-unlockable)' } as React.CSSProperties}>
              <Link to={`/plans/${stored.id}`}>
                <div className="name">{stored.name || unit.name || unit.id}</div>
                <div className="sub">{describeTarget(stored.target)}</div>
                <div className="meta">
                  <span className="chip">
                    {done ? 'Complete' : `${left} of ${plan.steps.length} steps left`}
                  </span>
                  {plan.blocked && <span className="chip">Blocked</span>}
                </div>
              </Link>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="small"
                  onClick={() => {
                    setCreating(false);
                    setEditing((current) => (current === stored.id ? undefined : stored.id));
                  }}
                >
                  {editing === stored.id ? 'Cancel' : 'Edit'}
                </button>
                <button className="danger small" onClick={() => remove(stored.id)}>
                  Delete
                </button>
              </div>
              {editing === stored.id && (
                <PlanForm
                  db={db}
                  units={owned}
                  plan={stored}
                  onSaved={() => {
                    setEditing(undefined);
                    setPlans(plansStore.list());
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function describeTarget(target: {
  rarity?: number;
  rank?: number;
  xpLevel?: number;
  activeAbilityLevel?: number;
  passiveAbilityLevel?: number;
}): string {
  const parts: string[] = [];
  if (target.rarity !== undefined) parts.push(rarityName(target.rarity));
  if (target.rank !== undefined) parts.push(rankName(target.rank));
  if (target.xpLevel !== undefined) parts.push(`level ${target.xpLevel}`);
  if (target.activeAbilityLevel !== undefined) parts.push(`active ${target.activeAbilityLevel}`);
  if (target.passiveAbilityLevel !== undefined) parts.push(`passive ${target.passiveAbilityLevel}`);
  return parts.length > 0 ? parts.join(' · ') : 'No target set';
}

/**
 * Create or edit a plan.
 *
 * Editing reuses the same form so the two never drift apart; passing `plan`
 * seeds the fields from it and saves back over the same entry, keeping the
 * plan's id and the page that links to it.
 */
export function PlanForm({
  db,
  units,
  plan: existing,
  onSaved,
}: {
  db: GameDatabase;
  units: PlayerResponse['player']['units'];
  plan?: StoredPlan;
  onSaved: (id: string) => void;
}) {
  const field = (value: number | undefined) => (value === undefined ? '' : String(value));
  const [unitId, setUnitId] = useState(existing?.unitId ?? units[0]?.id ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [rarity, setRarity] = useState(field(existing?.target.rarity));
  const [rank, setRank] = useState(field(existing?.target.rank));
  const [xpLevel, setXpLevel] = useState(field(existing?.target.xpLevel));
  const [active, setActive] = useState(field(existing?.target.activeAbilityLevel));
  const [passive, setPassive] = useState(field(existing?.target.passiveAbilityLevel));

  const num = (v: string) => (v === '' ? undefined : Number(v));
  const target = {
    ...(rarity !== '' ? { rarity: Number(rarity) as Rarity } : {}),
    ...(rank !== '' ? { rank: Number(rank) as never } : {}),
    ...(xpLevel !== '' ? { xpLevel: num(xpLevel)! } : {}),
    ...(active !== '' ? { activeAbilityLevel: num(active)! } : {}),
    ...(passive !== '' ? { passiveAbilityLevel: num(passive)! } : {}),
  };
  const empty = Object.keys(target).length === 0;
  const unit = units.find((u) => u.id === unitId);
  const preview = unit && !empty ? resolvePlan(unit, target, db) : undefined;

  const maxLevel = Math.max(...db.rarityCaps.map((c) => c.maxLevel), 50);

  return (
    <section className="panel" style={{ marginBottom: 24 }}>
      <h3>{existing ? 'Edit plan' : 'New plan'}</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Set only what you care about. Anything else it depends on is worked out and added
        for you — an ability target pulls the character level with it, and level or rank
        targets pull rarity.
      </p>

      <div className="form-grid">
        <label>
          <span>Unit</span>
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            {units.map((u) => (
              <option value={u.id} key={u.id}>
                {u.name ?? u.id}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Name</span>
          <input
            type="text"
            placeholder="Unit name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label>
          <span>Rarity</span>
          <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
            <option value="">—</option>
            {[0, 1, 2, 3, 4, 5].map((r) => (
              <option value={r} key={r}>
                {rarityName(r)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Rank</span>
          <select value={rank} onChange={(e) => setRank(e.target.value)}>
            <option value="">—</option>
            {Array.from({ length: 20 }, (_, i) => (
              <option value={i} key={i}>
                {rankName(i)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Level</span>
          <input
            type="number" min={1} max={maxLevel} placeholder="—"
            value={xpLevel} onChange={(e) => setXpLevel(e.target.value)}
          />
        </label>

        <label>
          <span>Active ability</span>
          <input
            type="number" min={1} max={maxLevel} placeholder="—"
            value={active} onChange={(e) => setActive(e.target.value)}
          />
        </label>

        <label>
          <span>Passive ability</span>
          <input
            type="number" min={1} max={maxLevel} placeholder="—"
            value={passive} onChange={(e) => setPassive(e.target.value)}
          />
        </label>
      </div>

      {preview && (
        <p className="small" style={{ color: preview.blocked ? '#ffb4b4' : 'var(--text-dim)' }}>
          {preview.blocked
            ? preview.blocked
            : preview.steps.length === 0
              ? 'This unit already meets that target.'
              : `${preview.steps.length} steps — requires ${describeTarget(preview.resolved)}.`}
        </p>
      )}

      <button
        className="primary"
        disabled={!unitId || empty}
        onClick={() => {
          const trimmed = name.trim();
          const fields = { unitId, target, ...(trimmed ? { name: trimmed } : { name: undefined }) };
          if (existing) {
            plansStore.update(existing.id, fields);
            onSaved(existing.id);
          } else {
            onSaved(
              plansStore.create({
                unitId,
                target,
                ...(unit ? { origin: currentState(unit, db) } : {}),
                ...(trimmed ? { name: trimmed } : {}),
              }).id,
            );
          }
        }}
      >
        {existing ? 'Save plan' : 'Create plan'}
      </button>
    </section>
  );
}
