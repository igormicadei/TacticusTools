import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {  Rarity } from '@lib/gamedata/enums.js';
import type { ItemTarget } from '@lib/gamedata/itemPlan.js';
import { currentState, markProgress, projectedStats, resolvePlan } from '@lib/gamedata/plan.js';
import { computeUnitStats, type ComputedUnitStats } from '@lib/gamedata/stats.js';
import { buildTimeline, type StatPriority } from '@lib/gamedata/timeline.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { humaniseFaction } from '../data/roster.ts';
import { plansStore, type StoredPlan } from '../data/plans.ts';
import { uiIcon, unitIcon } from '../data/icons.ts';
import { Icon, useIcons } from '../components/Icon.tsx';
import { ItemTargetsEditor, ItemTargetsSummary } from '../components/ItemTargets.tsx';
import { localAlliance, localRank, localRarity } from '../i18n/game.ts';
import { NextStep } from '../components/NextStep.tsx';
import { PlanCost } from '../components/PlanCost.tsx';
import { StatCard, type StatCardRow } from '../components/StatCard.tsx';
import { SelectField, SwitchField, Toolbar, ToolbarCounts } from '../components/Toolbar.tsx';
import { t, tn } from '../i18n/locale.ts';

type GroupMode = 'none' | 'faction' | 'alliance' | 'status';
type SortMode = 'created' | 'name' | 'energy' | 'steps';

const VIEW_KEY = 'tacticus-tools:plans-view';

function readView(): { group: GroupMode; sort: SortMode; hideDone: boolean } {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) return { group: 'none', sort: 'created', hideDone: false, ...JSON.parse(raw) };
  } catch {
    /* Private mode, or a corrupt value — the defaults still work. */
  }
  return { group: 'none', sort: 'created', hideDone: false };
}

export function PlansPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const [plans, setPlans] = useState(() => plansStore.list());
  const [editing, setEditing] = useState<string>();
  const [view, setView] = useState(readView);

  const setGroup = (group: GroupMode) => {
    setView((v) => {
      const next = { ...v, group };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(next));
      } catch {
        /* Private mode, or storage disabled — the choice still holds for this render. */
      }
      return next;
    });
  };
  const setSort = (sort: SortMode) => {
    setView((v) => {
      const next = { ...v, sort };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(next));
      } catch {
        /* Private mode, or storage disabled — the choice still holds for this render. */
      }
      return next;
    });
  };
  const setHideDone = (hideDone: boolean) => {
    setView((v) => {
      const next = { ...v, hideDone };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(next));
      } catch {
        /* Private mode, or storage disabled — the choice still holds for this render. */
      }
      return next;
    });
  };

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

  /**
   * Where each plan lands, against where the unit stands now.
   *
   * Computed here rather than inside the card so the whole list is one pass
   * over the roster, and so a card renders no arithmetic of its own.
   */
  const projections = useMemo(() => {
    const map = new Map<
      string,
      { from: ComputedUnitStats | undefined; to: ComputedUnitStats | undefined }
    >();
    for (const saved of plans) {
      const unit = owned.find((u) => u.id === saved.unitId);
      if (!unit) continue;
      const resolved = resolvePlan(unit, saved.target, db, saved.origin);
      map.set(saved.id, {
        from: computeUnitStats(unit, db),
        to: projectedStats(unit, resolved, db),
      });
    }
    return map;
  }, [plans, owned, db]);

  const reset = (unitId: string) => {
    plansStore.reset(unitId);
    setPlans(plansStore.list());
  };

  // Resolved once per plan, so grouping and sorting read off the same numbers
  // the cards themselves show rather than recomputing per row.
  const rows = useMemo(() => {
    const list: {
      stored: StoredPlan;
      unit: PlayerResponse['player']['units'][number];
      plan: ReturnType<typeof resolvePlan>;
      left: number;
      done: boolean;
    }[] = [];
    for (const stored of plans) {
      const unit = owned.find((u) => u.id === stored.unitId);
      if (!unit) continue;
      const plan = markProgress(
        resolvePlan(unit, stored.target, db, stored.origin),
        currentState(unit, db),
      );
      const left = plan.steps.filter((s) => !s.done).length;
      list.push({ stored, unit, plan, left, done: left === 0 });
    }
    return list;
  }, [plans, owned, db]);

  type Row = (typeof rows)[number];

  const sortRows = (list: Row[]): Row[] => {
    const sorted = [...list];
    switch (view.sort) {
      case 'name':
        sorted.sort((a, b) => (a.unit.name ?? a.unit.id).localeCompare(b.unit.name ?? b.unit.id));
        break;
      case 'energy':
        // Ascending: the quickest wins lead, the same reading order the
        // energy chip itself invites.
        sorted.sort(
          (a, b) =>
            (summaries.get(a.stored.id)?.cost.energy ?? 0) -
            (summaries.get(b.stored.id)?.cost.energy ?? 0),
        );
        break;
      case 'steps':
        sorted.sort((a, b) => a.left - b.left);
        break;
      case 'created':
      default:
        sorted.sort((a, b) => b.stored.createdAt - a.stored.createdAt);
        break;
    }
    return sorted;
  };

  /**
   * Rows bucketed the way the toolbar asks, each bucket sorted the same way.
   *
   * "None" still goes through this so the page has exactly one rendering path
   * — a single unlabelled bucket — rather than a second branch to keep in sync.
   */
  const groups = useMemo(() => {
    const visible = view.hideDone ? rows.filter((row) => !row.done) : rows;
    if (view.group === 'none') {
      return [{ key: 'all', label: '', rows: sortRows(visible) }];
    }
    const keyOf = (row: Row): { key: string; label: string } => {
      if (view.group === 'faction') {
        const id = db.units[row.unit.id]?.factionId ?? row.unit.faction ?? 'unknown';
        return { key: id, label: humaniseFaction(id) };
      }
      if (view.group === 'alliance') {
        const alliance = db.units[row.unit.id]?.grandAlliance;
        return { key: String(alliance ?? 'unknown'), label: localAlliance(alliance) };
      }
      return row.done
        ? { key: 'done', label: t('common.complete') }
        : { key: 'active', label: t('plans.inProgress') };
    };
    const buckets = new Map<string, { label: string; rows: Row[] }>();
    for (const row of visible) {
      const { key, label } = keyOf(row);
      const bucket = buckets.get(key);
      if (bucket) bucket.rows.push(row);
      else buckets.set(key, { label, rows: [row] });
    }
    return [...buckets.entries()]
      .map(([key, bucket]) => ({ key, label: bucket.label, rows: sortRows(bucket.rows) }))
      .sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
    // `sortRows` closes over `view.sort` and `summaries`, both already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, view, summaries, db]);

  return (
    <>
      <Toolbar>
        <h2 style={{ margin: 0, fontSize: 18 }}>{t('plans.heading')}</h2>
        {plans.length > 0 && (
          <>
            <SwitchField
              checked={view.hideDone}
              onChange={setHideDone}
              label={t('plans.hideDone')}
            />
            <SelectField label={t('plans.groupBy')} value={view.group} onChange={setGroup}>
              <option value="none">{t('plans.groupNone')}</option>
              <option value="faction">{t('plans.groupFaction')}</option>
              <option value="alliance">{t('plans.groupAlliance')}</option>
              <option value="status">{t('plans.groupStatus')}</option>
            </SelectField>
            <SelectField label={t('plans.sortBy')} value={view.sort} onChange={setSort}>
              <option value="created">{t('plans.sortCreated')}</option>
              <option value="name">{t('plans.sortName')}</option>
              <option value="energy">{t('plans.sortEnergy')}</option>
              <option value="steps">{t('plans.sortSteps')}</option>
            </SelectField>
            <ToolbarCounts items={[{ value: plans.length, label: t('plans.count') }]} />
            <Link className="chip" to="/plans/timeline">
              {t('plans.everythingInOrder')}
            </Link>
            <Link className="chip" to="/plans/shopping-list">
              {t('shopping.heading')}
            </Link>
          </>
        )}
      </Toolbar>

      {plans.length === 0 && (
        <div className="empty">
          {t('plans.none')}
        </div>
      )}

      {groups.map((group) => (
        <section className={group.label ? 'group' : undefined} key={group.key}>
          {group.label && (
            <div className="group-head">
              <h2>{group.label}</h2>
              <span className="pill">{group.rows.length}</span>
            </div>
          )}
          <div className="grid">
            {group.rows.map(({ stored, unit, plan, left, done }) => {
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
                    </div>
                    {plan.steps.length > 0 && (
                      <div className="bar">
                        <span
                          style={{
                            width: `${Math.round(((plan.steps.length - left) / plan.steps.length) * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                    {plan.blocked && (
                      <div className="meta">
                        <span className="chip">{t('common.blocked')}</span>
                      </div>
                    )}
                    {stored.itemTargets && stored.itemTargets.length > 0 && (
                      <div className="meta">
                        <ItemTargetsSummary db={db} player={player} unit={unit} targets={stored.itemTargets} compact />
                      </div>
                    )}
                  </Link>
                  <div className="row" style={{ marginTop: 10, alignItems: 'stretch' }}>
                    <div style={{ flex: 1 }}>
                      <StatCard rows={statCardRows(projections.get(stored.id)?.from, projections.get(stored.id)?.to)} />
                    </div>
                    <div className="row" style={{ flexDirection: 'column', gap: 6 }}>
                      <button
                        className="small"
                        onClick={() => setEditing((current) => (current === stored.id ? undefined : stored.id))}
                      >
                        {editing === stored.id ? t('common.cancel') : t('common.edit')}
                      </button>
                      <button className="danger small" onClick={() => reset(stored.unitId)}>
                        {t('plans.reset')}
                      </button>
                    </div>
                  </div>
                  <NextStep unit={unit} plan={plan} db={db} player={player} />
                  {editing === stored.id && (
                    <PlanForm
                      db={db}
                      player={player}
                      unit={unit}
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
        </section>
      ))}

      <PlansFooter />
    </>
  );
}

/**
 * A quiet close to the list — an original skyline silhouette (plain
 * rectangles, not a recreation of any in-game city) behind the app's own
 * tagline, echoing the reference's footer banner without copying its art.
 */
function PlansFooter() {
  return (
    <div className="plans-footer">
      <svg viewBox="0 0 400 70" className="plans-footer-skyline" aria-hidden="true" preserveAspectRatio="none">
        <rect x="0" y="30" width="26" height="40" />
        <rect x="30" y="18" width="18" height="52" />
        <rect x="52" y="38" width="22" height="32" />
        <rect x="78" y="10" width="16" height="60" />
        <rect x="98" y="26" width="30" height="44" />
        <rect x="132" y="42" width="20" height="28" />
        <rect x="156" y="6" width="14" height="64" />
        <rect x="174" y="24" width="26" height="46" />
        <rect x="204" y="34" width="18" height="36" />
        <rect x="226" y="14" width="22" height="56" />
        <rect x="252" y="40" width="30" height="30" />
        <rect x="286" y="22" width="16" height="48" />
        <rect x="306" y="30" width="24" height="40" />
        <rect x="334" y="12" width="18" height="58" />
        <rect x="356" y="36" width="26" height="34" />
      </svg>
      <p className="plans-footer-tagline">{t('plans.tagline')}</p>
    </div>
  );
}

/** The three headline stats, as a projection when both ends are known. */
function statCardRows(
  from: ComputedUnitStats | undefined,
  to: ComputedUnitStats | undefined,
): StatCardRow[] {
  if (!from || !to) return [];
  return [
    { key: 'hp', icon: uiIcon('health'), label: t('stat.hp'), value: to.health, from: from.health },
    { key: 'dmg', icon: uiIcon('damage'), label: t('stat.dmg'), value: to.damage, from: from.damage },
    { key: 'armour', icon: uiIcon('armour'), label: t('stat.armour'), value: to.armour, from: from.armour },
  ];
}

export function describeTarget(
  target: {
    rarity?: number;
    rank?: number;
    xpLevel?: number;
    activeAbilityLevel?: number;
    passiveAbilityLevel?: number;
    progressionIndex?: number;
  },
  db?: GameDatabase,
): string {
  const parts: string[] = [];
  if (target.rarity !== undefined) parts.push(localRarity(target.rarity));
  // Named by the stars it grants rather than by its index, which means nothing
  // outside this codebase.
  if (target.progressionIndex !== undefined) {
    const rung = db?.progressionRequirements.find(
      (r) => r.progressionIndex === target.progressionIndex,
    );
    parts.push(t('plans.targetStars', { n: rung?.starLevel ?? target.progressionIndex }));
  }
  if (target.rank !== undefined) parts.push(localRank(target.rank));
  if (target.xpLevel !== undefined) parts.push(t('plans.targetLevel', { n: target.xpLevel }));
  if (target.activeAbilityLevel !== undefined) {
    parts.push(t('plans.targetActive', { n: target.activeAbilityLevel }));
  }
  if (target.passiveAbilityLevel !== undefined) {
    parts.push(t('plans.targetPassive', { n: target.passiveAbilityLevel }));
  }
  return parts.length > 0 ? parts.join(' · ') : t('plans.noTarget');
}

/**
 * Edit a unit's plan.
 *
 * Every unit has exactly one, so this is never "create vs. edit" — it always
 * loads what is stored (or the default, empty target) for `unit` and saves
 * back over that same entry. The unit is fixed by the caller rather than
 * chosen here: every place this form appears already knows which unit it is
 * editing, whether that is the unit's own page or one card on the Plans list.
 */
export function PlanForm({
  db,
  player,
  unit,
  onSaved,
}: {
  db: GameDatabase;
  player: PlayerResponse;
  unit: PlayerResponse['player']['units'][number];
  onSaved: () => void;
}) {
  const existing = useMemo(() => plansStore.get(unit.id), [unit.id]);
  const field = (value: number | undefined) => (value === undefined ? '' : String(value));
  const [rarity, setRarity] = useState(field(existing.target.rarity));
  const [rank, setRank] = useState(field(existing.target.rank));
  const [xpLevel, setXpLevel] = useState(field(existing.target.xpLevel));
  const [active, setActive] = useState(field(existing.target.activeAbilityLevel));
  const [passive, setPassive] = useState(field(existing.target.passiveAbilityLevel));
  const [stars, setStars] = useState(field(existing.target.progressionIndex));
  const [priority, setPriority] = useState<StatPriority | ''>(existing.priority ?? '');
  const [itemTargets, setItemTargets] = useState<ItemTarget[]>(existing.itemTargets ?? []);

  const num = (v: string) => (v === '' ? undefined : Number(v));
  const target = {
    ...(rarity !== '' ? { rarity: Number(rarity) as Rarity } : {}),
    ...(rank !== '' ? { rank: Number(rank) as never } : {}),
    ...(xpLevel !== '' ? { xpLevel: num(xpLevel)! } : {}),
    ...(active !== '' ? { activeAbilityLevel: num(active)! } : {}),
    ...(passive !== '' ? { passiveAbilityLevel: num(passive)! } : {}),
    ...(stars !== '' ? { progressionIndex: num(stars)! } : {}),
  };
  const empty = Object.keys(target).length === 0 && itemTargets.length === 0;
  const unitDef = db.units[unit.id];
  const preview = !empty ? resolvePlan(unit, target, db) : undefined;

  const maxLevel = Math.max(...db.rarityCaps.map((c) => c.maxLevel), 50);
  // Where the unit stands now. Only what lies ahead of it is offerable — a
  // target it already meets is not a plan.
  const now = currentState(unit, db);
  const held = computeUnitStats(unit, db)?.rarity;

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

  /**
   * Rungs of the promotion ladder above where the unit stands.
   *
   * Offered as rungs rather than as a star count because the two are not the
   * same: an ascension rung and the promotion below it can carry the same
   * number of stars, so a count alone would not say which is meant. Each option
   * is labelled the way the game shows it — the rarity it sits in and the stars
   * it grants.
   */
  const starOptions = (() => {
    const from = now?.progressionIndex ?? 0;
    const rungs = db.progressionRequirements
      .filter((r) => r.progressionIndex > from)
      .sort((a, b) => a.progressionIndex - b.progressionIndex);
    const chosen = stars === '' ? undefined : Number(stars);
    if (chosen !== undefined && !rungs.some((r) => r.progressionIndex === chosen)) {
      const stored = db.progressionRequirements.find((r) => r.progressionIndex === chosen);
      if (stored) rungs.unshift(stored);
    }
    return rungs;
  })();

  const rarityOptions = above(held, Rarity.Mythic, rarity);
  const rankOptions = above(now?.rank, 19, rank);
  const levelOptions = above(now?.xpLevel, maxLevel, xpLevel);
  const activeOptions = above(now?.activeAbilityLevel, maxLevel, active);
  const passiveOptions = above(now?.passiveAbilityLevel, maxLevel, passive);

  return (
    <section className="panel" style={{ marginBottom: 24 }}>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('plans.formBlurb')}
      </p>

      <div className="form-grid">
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

        <label title={t('plans.starsHint')}>
          <span>{t('common.stars')}</span>
          <select
            value={stars}
            onChange={(e) => setStars(e.target.value)}
            disabled={starOptions.length === 0}
          >
            <option value="">{starOptions.length === 0 ? t('common.atTop') : '—'}</option>
            {starOptions.map((rung) => (
              <option value={rung.progressionIndex} key={rung.progressionIndex}>
                {t('plans.starsOption', {
                  rarity: localRarity(rung.rarity),
                  stars: rung.starLevel ?? 0,
                })}
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

      <h4 style={{ marginBottom: 4 }}>{t('itemplan.heading')}</h4>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('itemplan.blurb')}
      </p>
      <ItemTargetsEditor
        db={db}
        player={player}
        unitDef={unitDef}
        unit={unit}
        value={itemTargets}
        onChange={setItemTargets}
      />

      {preview && (
        <p className="small" style={{ color: preview.blocked ? 'var(--danger-strong)' : 'var(--text-secondary)' }}>
          {preview.blocked
            ? preview.blocked
            : preview.steps.length === 0
              ? t('plans.alreadyMet')
              : tn(preview.steps.length, 'plans.previewSteps', 'plans.previewStepsPlural', {
                  target: describeTarget(preview.resolved, db),
                })}
        </p>
      )}

      <button
        className="primary"
        onClick={() => {
          plansStore.save(unit.id, {
            target,
            priority: priority === '' ? undefined : priority,
            itemTargets: itemTargets.length > 0 ? itemTargets : undefined,
            // Anchored once, the first time this unit's plan holds any real
            // target — never moved after, or later progress would look like
            // it was always there.
            origin: existing.origin ?? currentState(unit, db),
            // A plan is a plan for one unit, so the unit's own name is the only
            // name it needs. Cleared on save so a name typed by an older build
            // does not linger under a field that no longer exists.
            name: undefined,
          });
          onSaved();
        }}
      >
        {t('common.savePlan')}
      </button>
    </section>
  );
}
