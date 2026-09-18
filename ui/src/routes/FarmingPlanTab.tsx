import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  currentState,
  markProgress,
  resolvePlan,
  type PlanStep,
  type PlanStepKind,
} from '@lib/gamedata/plan.js';
import {
  allocateHoldings,
  farmingCost,
  farmTargets,
  ownedByKey,
  planCosts,
  type AllocatedItem,
  type FarmTarget,
  type NodeStatus,
} from '@lib/gamedata/requirements.js';
import {
  buildTimeline,
  energyCandidates,
  type EnergyCandidate,
  type StatPriority,
} from '@lib/gamedata/timeline.js';
import { battleLevelOf, campaignFamily, isMirrorType, type BattleLevel } from '@lib/gamedata/teams.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { Icon, useIcons } from '../components/Icon.tsx';
import { ItemRow, NodeTable, toggleOpen } from '../components/StepItems.tsx';
import { SegmentedControl, SelectField, SwitchField } from '../components/Toolbar.tsx';
import { movePriority, plansStore, readPriorityOrder, type StoredPlan } from '../data/plans.ts';
import { rankIcon, requirementIcon, unitIcon } from '../data/icons.ts';
import {
  localCampaignType,
  localNumber,
  localRank,
  localRarity,
  localStat,
  localStepLabel,
} from '../i18n/game.ts';
import { t, tn } from '../i18n/locale.ts';

type Scope = 'all' | 'next' | 'slots';

const SCOPE_KEY = 'tacticus-tools:farming-scope';
const KINDS_KEY = 'tacticus-tools:farming-kinds';
const BUDGET_KEY = 'tacticus-tools:farming-budget';
const TODAY_KEY = 'tacticus-tools:farming-today';
const STAT_KEY = 'tacticus-tools:farming-stat';
const PLANNED_KEY = 'tacticus-tools:farming-planned-only';
const CUSTOM_ORDER_KEY = 'tacticus-tools:farming-custom-order';

const KIND_ORDER: readonly PlanStepKind[] = ['rank', 'level', 'ability', 'ascension', 'promotion'];
const LEVEL_ORDER: readonly BattleLevel[] = ['Standard', 'Elite', 'Extremis'];

/** A campaign, pulled apart into the same three axes the team picker offers
 * (`BattlePicker` in `TeamDetailPage.tsx`) — shared across all three scopes
 * below, since all three need the same campaign filter. */
interface CampaignOption {
  campaignId: string;
  family: string;
  mirror: boolean;
  level: BattleLevel;
}

/**
 * A node's campaign, as a `CampaignOption`.
 *
 * Reads the raw db name, not `node.campaignName`: that one already has a
 * " Standard"/" Elite" disambiguator appended for two campaigns that would
 * otherwise share a display name (see `nodeStatuses`), which `campaignFamily`
 * does not know to strip back off — the same reason the team picker
 * (`BattleBrief.all`) reads the name straight off `db.campaigns` too.
 */
function campaignOptionOf(node: NodeStatus, db: GameDatabase): CampaignOption {
  const campaign = db.campaigns[node.campaignId];
  return {
    campaignId: node.campaignId,
    family: campaignFamily(campaign?.name ?? node.campaignId),
    mirror: isMirrorType(campaign?.type),
    level: battleLevelOf(campaign?.type),
  };
}

/** Families/sides/difficulties actually on offer, and which campaign ids the
 * current pick resolves to — the same derivation every scope needs. */
function deriveCascade(options: readonly CampaignOption[], family: string, mirror: boolean, level: BattleLevel) {
  const families = [...new Set(options.map((o) => o.family))].sort((a, b) => a.localeCompare(b));
  const inFamily = options.filter((o) => o.family === family);
  const sides = [...new Set(inFamily.map((o) => o.mirror))].sort();
  const onSide = inFamily.filter((o) => o.mirror === mirror);
  const levels = LEVEL_ORDER.filter((l) => onSide.some((o) => o.level === l));
  const campaignIds = new Set(onSide.filter((o) => o.level === level).map((o) => o.campaignId));
  return { families, inFamily, sides, onSide, levels, campaignIds };
}

interface CascadeState {
  family: string;
  mirror: boolean;
  level: BattleLevel;
  setFamily: (v: string) => void;
  setMirror: (v: boolean) => void;
  setLevel: (v: BattleLevel) => void;
}

/** The Campaign/Side/Difficulty three-select, shared by every scope. */
function CampaignCascade({
  options,
  state,
}: {
  options: readonly CampaignOption[];
  state: CascadeState;
}) {
  const { family, mirror, level, setFamily, setMirror, setLevel } = state;
  const { families, inFamily, sides, levels } = deriveCascade(options, family, mirror, level);

  if (families.length === 0) return null;

  /** Re-point side/difficulty at a combination the new campaign actually has,
   * the same way `BattlePicker` keeps its own three selects in step. */
  const chooseFamily = (nextFamily: string) => {
    const pool = options.filter((o) => o.family === nextFamily);
    const nextMirror = pool.some((o) => o.mirror === mirror) ? mirror : (pool[0]?.mirror ?? false);
    const onThatSide = pool.filter((o) => o.mirror === nextMirror);
    const nextLevel = onThatSide.some((o) => o.level === level)
      ? level
      : (LEVEL_ORDER.find((l) => onThatSide.some((o) => o.level === l)) ?? 'Standard');
    setFamily(nextFamily);
    setMirror(nextMirror);
    setLevel(nextLevel);
  };
  const chooseMirror = (nextMirror: boolean) => {
    const onThatSide = inFamily.filter((o) => o.mirror === nextMirror);
    const nextLevel = onThatSide.some((o) => o.level === level)
      ? level
      : (LEVEL_ORDER.find((l) => onThatSide.some((o) => o.level === l)) ?? 'Standard');
    setMirror(nextMirror);
    setLevel(nextLevel);
  };

  return (
    <>
      <h3 style={{ marginTop: 0 }}>{t('nextSteps.filterByCampaign')}</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('nextSteps.campaignBlurb')}
      </p>
      <div className="form-grid">
        <label>
          <span>{t('td.campaign')}</span>
          <select value={family} onChange={(e) => chooseFamily(e.target.value)}>
            <option value="">{t('td.noCampaign')}</option>
            {families.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('td.side')}</span>
          <select
            value={mirror ? 'mirror' : 'standard'}
            onChange={(e) => chooseMirror(e.target.value === 'mirror')}
            disabled={!family || sides.length < 2}
          >
            {(sides.length > 0 ? sides : [false]).map((isMirror) => (
              <option key={String(isMirror)} value={isMirror ? 'mirror' : 'standard'}>
                {isMirror ? localCampaignType('Mirror') : localCampaignType('Standard')}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('td.level')}</span>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as BattleLevel)}
            disabled={!family || levels.length < 2}
          >
            {(levels.length > 0 ? levels : LEVEL_ORDER.slice(0, 1)).map((l) => (
              <option key={l} value={l}>
                {localCampaignType(l)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

/**
 * ▲/▼ buttons that swap a unit with its neighbour in the shared farming
 * priority order — only rendered when "Custom order" is on. `order` is the
 * full list as currently rendered in *this* scope, so the swap always has a
 * real neighbour to trade places with.
 */
function PriorityButtons({
  unitId,
  order,
  onMoved,
}: {
  unitId: string;
  order: readonly string[];
  onMoved: () => void;
}) {
  const index = order.indexOf(unitId);
  const move = (direction: 'up' | 'down') => {
    movePriority(unitId, direction, order);
    onMoved();
  };
  return (
    <span className="priority-buttons">
      <button
        type="button"
        className="priority-button"
        disabled={index <= 0}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          move('up');
        }}
        aria-label={t('farming.moveUp')}
        title={t('farming.moveUp')}
      >
        ▲
      </button>
      <button
        type="button"
        className="priority-button"
        disabled={index < 0 || index >= order.length - 1}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          move('down');
        }}
        aria-label={t('farming.moveDown')}
        title={t('farming.moveDown')}
      >
        ▼
      </button>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Scope: all outstanding steps                                               */
/* -------------------------------------------------------------------------- */

interface SharedFilters {
  db: GameDatabase;
  player: PlayerResponse;
  stored: StoredPlan[];
  kinds: ReadonlySet<PlanStepKind>;
  cascade: CascadeState;
  energyBudget: string;
  customOrder: boolean;
  priorityOrder: readonly string[];
  onPriorityChanged: () => void;
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

function useAllStepsData({ db, player, stored, kinds, cascade, energyBudget, customOrder, priorityOrder }: SharedFilters) {
  const entries = useMemo(() => {
    const out = [];
    for (const saved of stored) {
      const unit = player.player.units.find((u) => u.id === saved.unitId);
      if (!unit) continue;
      out.push({
        id: saved.id,
        unit,
        name: saved.name,
        plan: markProgress(resolvePlan(unit, saved.target, db, saved.origin), currentState(unit, db)),
      });
    }
    return out;
  }, [stored, player, db]);

  const timeline = useMemo(
    () => buildTimeline(entries, player, db, customOrder ? { priorityOrder } : {}),
    [entries, player, db, customOrder, priorityOrder],
  );

  const presentKinds = useMemo(() => {
    const seen = new Set(timeline.bundles.flatMap((b) => b.steps.map((s) => s.kind)));
    return KIND_ORDER.filter((kind) => seen.has(kind));
  }, [timeline]);

  const kindFiltered = useMemo(
    () => timeline.bundles.filter((b) => kinds.size === 0 || b.steps.some((s) => kinds.has(s.kind))),
    [timeline, kinds],
  );

  const withEnergy = useMemo(
    () => kindFiltered.map((bundle) => ({ bundle, energy: farmingCost(bundle.items, db, player).energy })),
    [kindFiltered, db, player],
  );

  const campaignOptions = useMemo(() => {
    const map = new Map<string, CampaignOption>();
    for (const { bundle } of withEnergy) {
      for (const item of bundle.items) {
        if (item.applied) continue;
        for (const target of farmTargets(
          { kind: item.kind, key: item.key, name: item.name, ...(item.rarity !== undefined ? { rarity: item.rarity } : {}) },
          item.missing,
          db,
          player,
        )) {
          for (const node of target.nodes) {
            if (!map.has(node.campaignId)) map.set(node.campaignId, campaignOptionOf(node, db));
          }
        }
      }
    }
    return [...map.values()];
  }, [withEnergy, db, player]);

  const { campaignIds } = deriveCascade(campaignOptions, cascade.family, cascade.mirror, cascade.level);
  const budget = energyBudget === '' ? undefined : Number(energyBudget);

  const visible = useMemo(() => {
    return withEnergy.filter(({ bundle, energy }) => {
      if (budget !== undefined && energy > budget) return false;
      if (!cascade.family) return true;
      return bundle.items.some((item) => {
        if (item.applied) return false;
        return farmTargets(
          { kind: item.kind, key: item.key, name: item.name, ...(item.rarity !== undefined ? { rarity: item.rarity } : {}) },
          item.missing,
          db,
          player,
        ).some((target) => target.nodes.some((node) => campaignIds.has(node.campaignId)));
      });
    });
  }, [withEnergy, budget, cascade.family, campaignIds, db, player]);

  const order = useMemo(() => [...new Set(visible.map(({ bundle }) => bundle.unitId))], [visible]);

  return { bundles: visible.map((v) => v.bundle), presentKinds, campaignOptions, order };
}

function AllStepsScope(props: SharedFilters) {
  useIcons();
  const { db, player, open, onToggle, customOrder, onPriorityChanged } = props;
  const { bundles, campaignOptions, order } = useAllStepsData(props);

  if (bundles.length === 0) {
    return <div className="empty">{t('timeline.allComplete')}</div>;
  }

  const headings = new Map<number, string>();
  for (const bundle of bundles) {
    const reaches = bundle.targetRank !== undefined;
    if (reaches || !headings.has(bundle.sortRank)) {
      headings.set(
        bundle.sortRank,
        reaches
          ? t('timeline.reaching', { rank: localRank(bundle.sortRank) })
          : t('timeline.alreadyAtRank', { rank: localRank(bundle.sortRank) }),
      );
    }
  }

  let tier: number | undefined;
  return (
    <>
      <CampaignCascade options={campaignOptions} state={props.cascade} />
      <section className="panel">
        <p className="small muted" style={{ marginTop: 0 }}>
          {t('timeline.orderBlurb')}
        </p>

        {bundles.map((bundle) => {
          const id = `${bundle.planId}:${bundle.sortRank}`;
          const heading = bundle.sortRank !== tier ? ((tier = bundle.sortRank), true) : false;
          return (
            <div key={id}>
              {heading && (
                <h3 className="tier-head row">
                  <Icon src={rankIcon(bundle.sortRank)} size={20} reserve />
                  {headings.get(bundle.sortRank)}
                </h3>
              )}
              <div className="step-block">
                <button className="bundle-head" onClick={() => onToggle(id)} aria-expanded={open.has(id)}>
                  <span className="chevron">{open.has(id) ? '▾' : '▸'}</span>
                  <Icon src={unitIcon(bundle.unitId)} alt="" size={28} className="portrait" reserve />
                  <Link to={`/plans/${bundle.planId}`} className="bundle-unit" onClick={(e) => e.stopPropagation()}>
                    {bundle.unitName}
                  </Link>
                  <span className="muted small">{bundle.steps.map((step) => localStepLabel(step)).join(' · ')}</span>
                  <span style={{ flex: 1 }} />
                  <span className="row-tail">
                    {bundle.unreachable > 0 && (
                      <span className="chip warn">{t('timeline.unreachable', { n: bundle.unreachable })}</span>
                    )}
                    <span className={`chip${bundle.missing === 0 ? ' ok-chip' : ''}`}>
                      {bundle.missing === 0 ? t('timeline.ready') : t('timeline.missing', { n: bundle.missing })}
                    </span>
                    {customOrder && (
                      <PriorityButtons unitId={bundle.unitId} order={order} onMoved={onPriorityChanged} />
                    )}
                  </span>
                </button>
                {open.has(id) && (
                  <ul className="item-list">
                    {bundle.items.map((item) => (
                      <ItemRow
                        key={`${id}:${item.key}:${item.applied ? 'a' : 'n'}`}
                        id={`${id}:${item.key}:${item.applied ? 'a' : 'n'}`}
                        item={item}
                        db={db}
                        player={player}
                        open={open}
                        onToggle={onToggle}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Scope: next step only                                                     */
/* -------------------------------------------------------------------------- */

interface NextStepRow {
  planId: string;
  unitId: string;
  unitName: string;
  kind: PlanStepKind;
  step: PlanStep;
  items: AllocatedItem[];
  targetsByItem: Map<string, FarmTarget[]>;
  energy: number;
}

function useNextStepData({ db, player, stored, kinds, cascade, energyBudget }: SharedFilters) {
  const rows = useMemo<NextStepRow[]>(() => {
    const out: NextStepRow[] = [];
    for (const saved of stored) {
      const unit = player.player.units.find((u) => u.id === saved.unitId);
      if (!unit) continue;
      const plan = markProgress(resolvePlan(unit, saved.target, db, saved.origin), currentState(unit, db));
      const next = plan.steps.find((step) => !step.done);
      if (!next) continue;

      const costs = planCosts(unit, { ...plan, steps: [next] }, db);
      const owned = ownedByKey(player, db);
      const allocated = allocateHoldings(costs, owned, db);
      const items = (allocated[0]?.items ?? []).filter((item) => !item.applied && item.missing > 0);

      const targetsByItem = new Map<string, FarmTarget[]>();
      let energy = 0;
      for (const item of items) {
        const targets = farmTargets(
          { kind: item.kind, key: item.key, name: item.name, ...(item.rarity !== undefined ? { rarity: item.rarity } : {}) },
          item.missing,
          db,
          player,
        );
        targetsByItem.set(item.key, targets);
        energy += targets.reduce((n, target) => n + (target.energy ?? 0), 0);
      }

      out.push({
        planId: saved.id,
        unitId: unit.id,
        unitName: saved.name || unit.name || unit.id,
        kind: next.kind,
        step: next,
        items,
        targetsByItem,
        energy,
      });
    }
    return out;
  }, [stored, player, db]);

  const presentKinds = useMemo(() => {
    const seen = new Set(rows.map((row) => row.kind));
    return KIND_ORDER.filter((kind) => seen.has(kind));
  }, [rows]);

  const kindFiltered = useMemo(
    () => rows.filter((row) => kinds.size === 0 || kinds.has(row.kind)),
    [rows, kinds],
  );

  const campaignOptions = useMemo(() => {
    const map = new Map<string, CampaignOption>();
    for (const row of kindFiltered) {
      for (const item of row.items) {
        for (const target of row.targetsByItem.get(item.key) ?? []) {
          for (const node of target.nodes) {
            if (!map.has(node.campaignId)) map.set(node.campaignId, campaignOptionOf(node, db));
          }
        }
      }
    }
    return [...map.values()];
  }, [kindFiltered, db]);

  const { campaignIds } = deriveCascade(campaignOptions, cascade.family, cascade.mirror, cascade.level);
  const budget = energyBudget === '' ? undefined : Number(energyBudget);

  const visible = useMemo(() => {
    return kindFiltered
      .filter((row) => budget === undefined || row.energy <= budget)
      .map((row) => {
        if (!cascade.family) return row;
        const items = row.items.filter((item) =>
          (row.targetsByItem.get(item.key) ?? []).some((target) =>
            target.nodes.some((node) => campaignIds.has(node.campaignId)),
          ),
        );
        return { ...row, items };
      })
      .filter((row) => !cascade.family || row.items.length > 0);
  }, [kindFiltered, budget, cascade.family, campaignIds]);

  return { rows: visible, allRows: rows, presentKinds, campaignOptions };
}

function NextStepScope(props: SharedFilters) {
  useIcons();
  const { db, player, open, onToggle } = props;
  const { rows, campaignOptions } = useNextStepData(props);

  return (
    <>
      <CampaignCascade options={campaignOptions} state={props.cascade} />
      {rows.length === 0 ? (
        <div className="empty">{t('nextSteps.noMatch')}</div>
      ) : (
        <section className="panel">
          {rows.map((row) => (
            <div className="step-block" key={row.planId}>
              <div className="step-block-head">
                <Icon src={unitIcon(row.unitId)} size={28} className="portrait" reserve />
                <Link to={`/plans/${row.planId}`}>{row.unitName}</Link>
                <span className="muted small">{localStepLabel(row.step)}</span>
              </div>
              {row.items.length === 0 ? (
                <p className="muted small" style={{ margin: '4px 0 0 30px' }}>
                  {t('si.allApplied')}
                </p>
              ) : (
                <ul className="item-list">
                  {row.items.map((item) => (
                    <ItemRow
                      key={`${row.planId}:${item.key}`}
                      id={`${row.planId}:${item.key}`}
                      item={item}
                      db={db}
                      player={player}
                      open={open}
                      onToggle={onToggle}
                    />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Scope: current rank slots                                                 */
/* -------------------------------------------------------------------------- */

interface SlotFilters extends SharedFilters {
  stat: StatPriority | '';
  plannedOnly: boolean;
  todayOnly: boolean;
}

function useSlotData(props: SlotFilters) {
  const { db, player, stored, cascade, energyBudget, stat, plannedOnly, todayOnly, customOrder, priorityOrder } = props;
  const planned = useMemo(() => new Set(stored.map((p) => p.unitId)), [stored]);

  const units = useMemo(() => {
    const base = plannedOnly && planned.size > 0 ? player.player.units.filter((u) => planned.has(u.id)) : player.player.units;
    if (!customOrder) return base;
    const rank = new Map(priorityOrder.map((id, i) => [id, i]));
    return [...base].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  }, [player, plannedOnly, planned, customOrder, priorityOrder]);

  const { affordable: allCandidates } = useMemo(() => {
    const perUnit = new Map<string, StatPriority>();
    for (const saved of stored) {
      if (saved.priority) perUnit.set(saved.unitId, saved.priority);
    }
    const found = energyCandidates(units, player, db, { ...(stat ? { priority: stat } : {}), perUnit });
    const all = todayOnly ? found.filter((c) => c.today !== undefined) : found;
    return { affordable: all };
  }, [units, player, db, stat, stored, todayOnly]);

  const campaignOptions = useMemo(() => {
    const map = new Map<string, CampaignOption>();
    for (const candidate of allCandidates) {
      for (const target of candidate.targets) {
        for (const node of target.nodes) {
          if (!map.has(node.campaignId)) map.set(node.campaignId, campaignOptionOf(node, db));
        }
      }
    }
    return [...map.values()];
  }, [allCandidates, db]);

  const { campaignIds } = deriveCascade(campaignOptions, cascade.family, cascade.mirror, cascade.level);
  const budget = energyBudget === '' ? undefined : Number(energyBudget);

  const filtered = useMemo(() => {
    return allCandidates.filter((c) => {
      if (budget !== undefined && c.energy > budget) return false;
      if (!cascade.family) return true;
      return c.targets.some((target) => target.nodes.some((node) => campaignIds.has(node.campaignId)));
    });
  }, [allCandidates, budget, cascade.family, campaignIds]);

  return { candidates: filtered, campaignOptions, plannedEmpty: plannedOnly && planned.size === 0 };
}

function SlotsScope(props: SlotFilters) {
  useIcons();
  const { player, customOrder, priorityOrder, onPriorityChanged } = props;
  const [energy, setEnergy] = useState(() => localStorage.getItem('tacticus-tools:energy') ?? '60');
  const budget = Number(energy) || 0;
  const { candidates, campaignOptions, plannedEmpty } = useSlotData(props);

  const affordable = candidates.filter((c) => c.energy <= budget);
  const beyond = candidates.filter((c) => c.energy > budget).sort((a, b) => a.energy - b.energy);
  const cheapest = candidates.reduce<number | undefined>(
    (min, c) => (min === undefined ? c.energy : Math.min(min, c.energy)),
    undefined,
  );

  const order = useMemo(() => [...new Set(candidates.map((c) => c.unitId))], [candidates]);

  return (
    <>
      <CampaignCascade options={campaignOptions} state={props.cascade} />
      <section className="panel">
        <label className="inline-field">
          <span>{t('timeline.energy')}</span>
          <input
            type="number"
            min={0}
            value={energy}
            onChange={(e) => {
              setEnergy(e.target.value);
              localStorage.setItem('tacticus-tools:energy', e.target.value);
            }}
            style={{ width: 100 }}
          />
        </label>

        <p className="small muted" style={{ marginTop: 12 }}>
          {t('spend.blurb')} {t('spend.energyNote')}
        </p>
        {plannedEmpty && <div className="notice">{t('spend.noPlans')}</div>}

        <h3>{tn(budget, 'spend.afford', 'spend.affordPlural', { n: localNumber(budget) })}</h3>
        {affordable.length === 0 ? (
          <div className="empty">
            {t('spend.affordNone', { n: localNumber(budget), cheapest: cheapest === undefined ? '—' : localNumber(Math.round(cheapest)) })}
          </div>
        ) : (
          <ByUnit rows={affordable} affordable player={player} customOrder={customOrder} order={order} onPriorityChanged={onPriorityChanged} priorityOrder={priorityOrder} />
        )}

        {beyond.length > 0 && (
          <>
            <h3 style={{ marginTop: 20 }}>{t('spend.beyond')}</h3>
            <ByUnit rows={beyond.slice(0, 12)} affordable={false} player={player} customOrder={customOrder} order={order} onPriorityChanged={onPriorityChanged} priorityOrder={priorityOrder} />
          </>
        )}
      </section>
    </>
  );
}

function ByUnit({
  rows,
  affordable,
  customOrder,
  order,
  onPriorityChanged,
}: {
  rows: EnergyCandidate[];
  affordable: boolean;
  player: PlayerResponse;
  customOrder: boolean;
  order: readonly string[];
  onPriorityChanged: () => void;
  priorityOrder: readonly string[];
}) {
  const groups = useMemo(() => {
    const map = new Map<string, EnergyCandidate[]>();
    for (const row of rows) {
      const list = map.get(row.unitId);
      if (list) list.push(row);
      else map.set(row.unitId, [row]);
    }
    for (const list of map.values()) list.sort((a, b) => a.energy - b.energy || b.ratio - a.ratio);
    return [...map.entries()].sort(
      (a, b) => Math.min(...a[1].map((c) => c.energy)) - Math.min(...b[1].map((c) => c.energy)),
    );
  }, [rows]);

  return (
    <>
      {groups.map(([unitId, candidates]) => (
        <div className="step-block" key={unitId}>
          <div className="step-block-head">
            <Icon src={unitIcon(unitId)} size={26} className="portrait" reserve />
            <Link to={`/units/${encodeURIComponent(unitId)}`}>{candidates[0]?.unitName}</Link>
            <span className="muted small">
              {affordable
                ? tn(candidates.length, 'spend.unitAffordable', 'spend.unitAffordablePlural')
                : tn(candidates.length, 'spend.unitBeyond', 'spend.unitBeyondPlural')}
            </span>
            {customOrder && <PriorityButtons unitId={unitId} order={order} onMoved={onPriorityChanged} />}
          </div>
          <CandidateTable rows={candidates} affordable={affordable} />
        </div>
      ))}
    </>
  );
}

function FarmList({ row }: { row: EnergyCandidate }) {
  const [shown, setShown] = useState<string>();
  const targets = row.targets;

  if (targets.length === 0) {
    return (
      <div className="source-note">
        <p className="muted small" style={{ margin: 0 }}>{t('spend.nothingToFarm')}</p>
      </div>
    );
  }

  const drops = targets.reduce((n, target) => n + target.amount, 0);
  const energy = targets.reduce((n, target) => n + (target.energy ?? 0), 0);

  return (
    <div className="source-note">
      <p className="muted small" style={{ margin: '0 0 6px' }}>
        {tn(drops, 'spend.toFarm', 'spend.toFarmPlural', { energy: localNumber(Math.round(energy)) })}
      </p>
      <ul className="item-list nested">
        {targets.map((target) => {
          const id = `${row.unitId}:${row.slotIndex}:${target.key}`;
          const isOpen = shown === id;
          return (
            <li className="item-row" key={target.key}>
              <button className="item-head" onClick={() => setShown(isOpen ? undefined : id)} aria-expanded={isOpen}>
                <span className="chevron">{isOpen ? '▾' : '▸'}</span>
                <span className="count">{target.amount}×</span>
                <Icon src={requirementIcon(target.key)} size={22} className="portrait" reserve />
                <span className="item-name">
                  {target.name}
                  {target.rarity !== undefined && <span className="muted small"> · {localRarity(target.rarity)}</span>}
                  {target.via.length > 0 && (
                    <span className="muted small">
                      {' · '}
                      {t('si.forFlat', { chain: target.via.join(' › ') })}
                    </span>
                  )}
                </span>
                <span className="muted small">
                  {target.energyPerCopy === undefined ? t('si.noSource') : t('spend.each', { n: target.energyPerCopy.toFixed(1) })}
                </span>
                {target.energy !== undefined && (
                  <span className="chip">{t('spend.cost', { n: localNumber(Math.round(target.energy)) })}</span>
                )}
              </button>
              {isOpen && <NodeTable nodes={target.nodes} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CandidateTable({ rows, affordable }: { rows: EnergyCandidate[]; affordable: boolean }) {
  const [shown, setShown] = useState<string>();
  return (
    <ul className="item-list" style={{ paddingLeft: 0 }}>
      {rows.map((row) => {
        const id = `${row.unitId}:${row.itemKey}`;
        const isOpen = shown === id;
        return (
          <li key={id} className={`item-row${affordable ? '' : ' dim'}`}>
            <button className="item-head" onClick={() => setShown(isOpen ? undefined : id)} aria-expanded={isOpen}>
              <span className="chevron">{isOpen ? '▾' : '▸'}</span>
              <span className="count">{t('spend.cost', { n: localNumber(Math.round(row.energy)) })}</span>
              <span className="slot-pos">{t('si.slotPos', { rank: localRank(row.rank), n: row.slotIndex + 1 })}</span>
              <span className="item-name muted">
                {t('spend.copies', { n: row.copies, item: row.itemName })}
                {row.rarity !== undefined && <span className="small"> · {localRarity(row.rarity)}</span>}
              </span>
              <span className="chip ok-chip">{t('spend.gain', { n: row.gain, stat: localStat(row.statType) })}</span>
              <span className="muted small">
                {row.today === undefined
                  ? tn(row.targets.reduce((n, target) => n + target.amount, 0), 'spend.dropsLeft', 'spend.dropsLeftPlural')
                  : row.today.raids === 0
                    ? t('spend.raidsNone')
                    : tn(row.today.raids, 'spend.raids', 'spend.raidsPlural')}
              </span>
            </button>
            {isOpen && <FarmList row={row} />}
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* The tab itself                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Every rank-up material still needed, across the whole roster — one list,
 * three scopes over the same underlying question (what do I still need, and
 * where do I farm it), rather than three separate pages that each answered a
 * fixed slice of it. "All outstanding steps" and "Next step only" differ only
 * in how much of a plan they look at; "Current rank slots" additionally
 * considers units with no plan at all, since a slot is fillable whether or
 * not its unit has a stated target.
 *
 * Equipment/gear costs (Dust, Gold, Forge Badges) are a different currency
 * system with no campaign or energy dimension at all, so Shopping List stays
 * its own page rather than a fourth scope here.
 */
export function FarmingPlanTab({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  const [scope, setScope] = useState<Scope>(
    () => (localStorage.getItem(SCOPE_KEY) as Scope | null) ?? 'all',
  );
  const chooseScope = (next: Scope) => {
    setScope(next);
    localStorage.setItem(SCOPE_KEY, next);
  };

  const [kinds, setKinds] = useState<ReadonlySet<PlanStepKind>>(() => {
    try {
      const raw = localStorage.getItem(KINDS_KEY);
      return raw ? new Set(JSON.parse(raw) as PlanStepKind[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const toggleKind = (kind: PlanStepKind) =>
    setKinds((current) => {
      const next = new Set(current);
      if (!next.delete(kind)) next.add(kind);
      try {
        localStorage.setItem(KINDS_KEY, JSON.stringify([...next]));
      } catch {
        /* Private mode — the choice still holds for this render. */
      }
      return next;
    });

  const [family, setFamily] = useState('');
  const [mirror, setMirror] = useState(false);
  const [level, setLevel] = useState<BattleLevel>('Standard');
  const cascade: CascadeState = { family, mirror, level, setFamily, setMirror, setLevel };

  const [energyBudget, setEnergyBudget] = useState(() => localStorage.getItem(BUDGET_KEY) ?? '');
  const [todayOnly, setTodayOnly] = useState(() => localStorage.getItem(TODAY_KEY) === '1');
  const [stat, setStat] = useState<StatPriority | ''>(
    () => (localStorage.getItem(STAT_KEY) as StatPriority | null) ?? '',
  );
  const [plannedOnly, setPlannedOnly] = useState(() => localStorage.getItem(PLANNED_KEY) === '1');
  const [customOrder, setCustomOrder] = useState(() => localStorage.getItem(CUSTOM_ORDER_KEY) === '1');
  const [priorityOrder, setPriorityOrder] = useState(() => readPriorityOrder());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) => setOpen((current) => toggleOpen(current, id));

  const stored = useMemo(() => plansStore.list(), []);

  const shared: SharedFilters = {
    db,
    player,
    stored,
    kinds,
    cascade,
    energyBudget,
    customOrder,
    priorityOrder,
    onPriorityChanged: () => setPriorityOrder(readPriorityOrder()),
    open,
    onToggle: toggle,
  };

  // Computed even for scopes not currently shown, so the filter panel always
  // has real step-type chips to offer without a conditional hook call.
  const allPresentKinds = useAllStepsData(shared).presentKinds;
  const nextPresentKinds = useNextStepData(shared).presentKinds;
  const presentKinds = scope === 'all' ? allPresentKinds : nextPresentKinds;

  if (stored.length === 0 && scope !== 'slots') {
    return (
      <div className="empty">{t('farming.noPlansYet')}</div>
    );
  }

  return (
    <>
      <section className="panel" style={{ marginBottom: 16 }}>
        <SegmentedControl
          value={scope}
          onChange={chooseScope}
          options={[
            { value: 'all', label: t('farming.scopeAll') },
            { value: 'next', label: t('farming.scopeNext') },
            { value: 'slots', label: t('farming.scopeSlots') },
          ]}
        />

        {scope !== 'slots' && presentKinds.length > 0 && (
          <>
            <h3 style={{ marginTop: 16 }}>{t('nextSteps.filterByType')}</h3>
            <div className="counts">
              {presentKinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`count filterable${kinds.has(kind) ? ' active' : ''}`}
                  onClick={() => toggleKind(kind)}
                >
                  {t(`nextSteps.kind.${kind}`)}
                </button>
              ))}
            </div>
          </>
        )}

        {scope === 'slots' && (
          <div className="form-grid" style={{ marginTop: 16 }}>
            <SelectField
              label={t('common.favour')}
              value={stat}
              onChange={(next) => {
                setStat(next);
                localStorage.setItem(STAT_KEY, next);
              }}
            >
              <option value="">{t('timeline.anyAttribute')}</option>
              <option value="health">{t('common.health')}</option>
              <option value="damage">{t('common.damage')}</option>
              <option value="armour">{t('common.armour')}</option>
            </SelectField>
            <label>
              <span>{t('spend.units')}</span>
              <SegmentedControl
                value={plannedOnly ? 'plans' : 'all'}
                onChange={(v) => {
                  const next = v === 'plans';
                  setPlannedOnly(next);
                  localStorage.setItem(PLANNED_KEY, next ? '1' : '0');
                }}
                options={[
                  { value: 'all', label: t('spend.allUnits') },
                  { value: 'plans', label: t('spend.onlyPlans') },
                ]}
              />
            </label>
            <SwitchField
              checked={todayOnly}
              onChange={(checked) => {
                setTodayOnly(checked);
                localStorage.setItem(TODAY_KEY, checked ? '1' : '0');
              }}
              label={t('spend.today')}
              hint={t('spend.todayHint')}
            />
          </div>
        )}

        <h3 style={{ marginTop: 16 }}>{t('farming.filterByEnergy')}</h3>
        <label className="inline-field">
          <span>{t('farming.maxEnergy')}</span>
          <input
            type="number"
            min={0}
            placeholder={t('farming.noLimit')}
            value={energyBudget}
            onChange={(e) => {
              setEnergyBudget(e.target.value);
              localStorage.setItem(BUDGET_KEY, e.target.value);
            }}
            style={{ width: 100 }}
          />
        </label>

        {scope !== 'next' && (
          <div style={{ marginTop: 16 }}>
            <SwitchField
              checked={customOrder}
              onChange={(checked) => {
                setCustomOrder(checked);
                localStorage.setItem(CUSTOM_ORDER_KEY, checked ? '1' : '0');
              }}
              label={t('farming.customOrder')}
              hint={t('farming.customOrderHint')}
            />
          </div>
        )}
      </section>

      {scope === 'all' && <AllStepsScope {...shared} />}
      {scope === 'next' && <NextStepScope {...shared} />}
      {scope === 'slots' && <SlotsScope {...shared} stat={stat} plannedOnly={plannedOnly} todayOnly={todayOnly} />}
    </>
  );
}
