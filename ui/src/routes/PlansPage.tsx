import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {  Rarity } from '@lib/gamedata/enums.js';
import { currentState, markProgress, resolvePlan } from '@lib/gamedata/plan.js';
import { computeUnitStats } from '@lib/gamedata/stats.js';
import { buildTimeline, type StatPriority } from '@lib/gamedata/timeline.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { plansStore, type StoredPlan } from '../data/plans.ts';
import { unitIcon } from '../data/icons.ts';
import { Icon, useIcons } from '../components/Icon.tsx';
import { localRank, localRarity } from '../i18n/game.ts';
import { PlanCost } from '../components/PlanCost.tsx';
import { t } from '../i18n/locale.ts';

export function PlansPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const navigate = useNavigate();
  const [plans, setPlans] = useState(() => plansStore.list());
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string>();

  const owned = useMemo(
    () => [...player.player.units].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id)),
    [player],
  );

  // Built once for the whole page: scored plan by plan, two units wanting the
  // same material would both claim it, and the cards would not add up against
  // the timeline.
  const summaries = useMemo(() => {
    const entries = [];
    for (const saved of plans) {
      const unit = owned.find((u) => u.id === saved.unitId);
      if (!unit) continue;
      entries.push({
        id: saved.id,
        unit,
        plan: markProgress(
          resolvePlan(unit, saved.target, db, saved.origin),
          currentState(unit, db),
        ),
      });
    }
    return buildTimeline(entries, player, db).byPlan;
  }, [plans, owned, player, db]);

  const remove = (id: string) => {
    plansStore.remove(id);
    setPlans(plansStore.list());
  };

  return (
    <>
      <div className="toolbar">
        <h2 style={{ margin: 0, fontSize: 18 }}>{t('plans.heading')}</h2>
        <span style={{ flex: 1 }} />
        {plans.length > 0 && (
          <Link className="chip" to="/plans/timeline">
            Everything in order
          </Link>
        )}
        <button
          className="primary"
          onClick={() => {
            setEditing(undefined);
            setCreating((v) => !v);
          }}
        >
          {creating ? 'Cancel' : t('common.newPlan')}
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
          const summary = summaries.get(stored.id);
          return (
            <div className="card" key={stored.id} style={{ '--status': done ? 'var(--status-owned)' : 'var(--status-unlockable)' } as React.CSSProperties}>
              <Link to={`/plans/${stored.id}`}>
                <div className="card-head">
                  <Icon src={unitIcon(unit.id)} alt="" size={40} className="portrait" />
                  <div className="card-title">
                    <div className="name">{stored.name || unit.name || unit.id}</div>
                    <div className="sub">{describeTarget(stored.target)}</div>
                  </div>
                </div>
                <div className="meta">
                  <span className="chip">
                    {done
                      ? t('common.complete')
                      : t('common.stepsLeft', { n: left, total: plan.steps.length })}
                  </span>
                  {/* No "unreachable" chip beside this: it counted copies of
                      the named requirements with no route, which is the same
                      idea as "with no route" below but measured before recipes
                      are resolved — two different numbers for one fact. */}
                  {summary && <PlanCost cost={summary.cost} />}
                  {plan.blocked && <span className="chip">{t('common.blocked')}</span>}
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
  if (target.rarity !== undefined) parts.push(localRarity(target.rarity));
  if (target.rank !== undefined) parts.push(localRank(target.rank));
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
  const [priority, setPriority] = useState<StatPriority | ''>(existing?.priority ?? '');

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
  // Where the unit stands now. Only what lies ahead of it is offerable — a
  // target it already meets is not a plan.
  const now = unit ? currentState(unit, db) : undefined;
  const held = unit ? computeUnitStats(unit, db)?.rarity : undefined;

  /**
   * Values a field may take: everything above where the unit is now.
   *
   * A stored target the unit has since passed stays in its own list, so opening
   * an old plan shows what it says rather than silently reading as something
   * else.
   */
  const above = (from: number | undefined, to: number, selected: string): number[] => {
    const start = (from ?? 0) + 1;
    const options = [];
    for (let value = start; value <= to; value += 1) options.push(value);
    const chosen = selected === '' ? undefined : Number(selected);
    if (chosen !== undefined && !options.includes(chosen)) options.unshift(chosen);
    return options;
  };

  const rarityOptions = above(held, Rarity.Mythic, rarity);
  const rankOptions = above(now?.rank, 19, rank);
  const levelOptions = above(now?.xpLevel, maxLevel, xpLevel);
  const activeOptions = above(now?.activeAbilityLevel, maxLevel, active);
  const passiveOptions = above(now?.passiveAbilityLevel, maxLevel, passive);

  // Switching units can leave a value the new one already has; clearing it is
  // less surprising than saving a target that is met the moment it is created.
  const onUnit = (next: string) => {
    setUnitId(next);
    setRarity('');
    setRank('');
    setXpLevel('');
    setActive('');
    setPassive('');
  };

  return (
    <section className="panel" style={{ marginBottom: 24 }}>
      <h3>{existing ? t('common.editPlan') : t('common.newPlan')}</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Set only what you care about. Anything else it depends on is worked out and added
        for you — an ability target pulls the character level with it, and level or rank
        targets pull rarity. Each field offers only what lies ahead of the unit, since a
        target it already meets is not a plan.
      </p>

      <div className="form-grid">
        <label>
          <span>{t('common.unit')}</span>
          <select value={unitId} onChange={(e) => onUnit(e.target.value)}>
            {units.map((u) => (
              <option value={u.id} key={u.id}>
                {u.name ?? u.id}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{t('common.name')}</span>
          <input
            type="text"
            placeholder={t('plans.unitName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label>
          <span>{t('common.favour')}</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as StatPriority | '')}
            title={t('plans.favourHint')}
          >
            <option value="">{t('plans.noPreference')}</option>
            <option value="health">{t('common.health')}</option>
            <option value="damage">{t('common.damage')}</option>
            <option value="armour">{t('common.armour')}</option>
          </select>
        </label>

        <label>
          <span>{t('common.rarity')}</span>
          <select value={rarity} onChange={(e) => setRarity(e.target.value)} disabled={rarityOptions.length === 0}>
            <option value="">{rarityOptions.length === 0 ? t('common.atTop') : '—'}</option>
            {rarityOptions.map((r) => (
              <option value={r} key={r}>
                {localRarity(r)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{t('common.rank')}</span>
          <select value={rank} onChange={(e) => setRank(e.target.value)} disabled={rankOptions.length === 0}>
            <option value="">{rankOptions.length === 0 ? t('common.atTop') : '—'}</option>
            {rankOptions.map((r) => (
              <option value={r} key={r}>
                {localRank(r)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{t('common.level')}</span>
          <select value={xpLevel} onChange={(e) => setXpLevel(e.target.value)} disabled={levelOptions.length === 0}>
            <option value="">{levelOptions.length === 0 ? t('common.atCap') : '—'}</option>
            {levelOptions.map((n) => (
              <option value={n} key={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{t('plans.activeAbility')}</span>
          <select value={active} onChange={(e) => setActive(e.target.value)} disabled={activeOptions.length === 0}>
            <option value="">{activeOptions.length === 0 ? t('common.atCap') : '—'}</option>
            {activeOptions.map((n) => (
              <option value={n} key={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{t('plans.passiveAbility')}</span>
          <select value={passive} onChange={(e) => setPassive(e.target.value)} disabled={passiveOptions.length === 0}>
            <option value="">{passiveOptions.length === 0 ? t('common.atCap') : '—'}</option>
            {passiveOptions.map((n) => (
              <option value={n} key={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {preview && (
        <p className="small" style={{ color: preview.blocked ? 'var(--danger-strong)' : 'var(--text-secondary)' }}>
          {preview.blocked
            ? preview.blocked
            : preview.steps.length === 0
              ? t('plans.alreadyMet')
              : `${preview.steps.length} steps — requires ${describeTarget(preview.resolved)}.`}
        </p>
      )}

      <button
        className="primary"
        disabled={!unitId || empty}
        onClick={() => {
          const trimmed = name.trim();
          const fields = {
            unitId,
            target,
            priority: priority === '' ? undefined : priority,
            ...(trimmed ? { name: trimmed } : { name: undefined }),
          };
          if (existing) {
            plansStore.update(existing.id, fields);
            onSaved(existing.id);
          } else {
            onSaved(
              plansStore.create({
                unitId,
                target,
                ...(unit ? { origin: currentState(unit, db) } : {}),
                ...(priority ? { priority } : {}),
                ...(trimmed ? { name: trimmed } : {}),
              }).id,
            );
          }
        }}
      >
        {existing ? t('common.savePlan') : t('common.createPlan')}
      </button>
    </section>
  );
}
