import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';


import { currentState, markProgress, resolvePlan } from '@lib/gamedata/plan.js';
import { farmTargets } from '@lib/gamedata/requirements.js';
import {
  buildTimeline,
  energyCandidates,
  type EnergyCandidate,
  type StatPriority,
  type TimelineBundle,
} from '@lib/gamedata/timeline.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { ItemRow, NodeTable, toggleOpen } from '../components/StepItems.tsx';
import { plansStore } from '../data/plans.ts';
import { rankIcon, requirementIcon, unitIcon } from '../data/icons.ts';
import { Icon, useIcons } from '../components/Icon.tsx';
import { localNumber, localRank, localRarity, localStat, localStepLabel } from '../i18n/game.ts';
import { t, tn } from '../i18n/locale.ts';

type Mode = 'order' | 'energy';

const ENERGY_KEY = 'tacticus-tools:energy';
const STAT_KEY = 'tacticus-tools:energyStat';
const PLANNED_KEY = 'tacticus-tools:energyPlannedOnly';
const MODE_KEY = 'tacticus-tools:timelineMode';
const TODAY_KEY = 'tacticus-tools:energyToday';

export function TimelinePage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  // Remembered, because the two views answer different questions and a player
  // who came here to spend tonight's energy should not have to re-pick it.
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem(MODE_KEY) === 'energy' ? 'energy' : 'order'),
  );
  const chooseMode = (next: Mode) => {
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
  };
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) => setOpen((current) => toggleOpen(current, id));

  const stored = useMemo(() => plansStore.list(), []);
  const { timeline, plansById } = useMemo(() => {
    const entries = [];
    const byId = new Map<string, (typeof stored)[number]>();
    for (const saved of stored) {
      const unit = player.player.units.find((u) => u.id === saved.unitId);
      if (!unit) continue;
      byId.set(saved.id, saved);
      entries.push({
        id: saved.id,
        unit,
        name: saved.name,
        plan: markProgress(
          resolvePlan(unit, saved.target, db, saved.origin),
          currentState(unit, db),
        ),
      });
    }
    return { timeline: buildTimeline(entries, player, db), plansById: byId };
  }, [stored, player, db]);

  if (stored.length === 0) {
    return (
      <>
        <Link to="/plans" className="back">
          {t('nav.backPlans')}
        </Link>
        <div className="empty">
          {t('timeline.none')}
        </div>
      </>
    );
  }

  return (
    <>
      <Link to="/plans" className="back">
        {t('nav.backPlans')}
      </Link>

      <div className="detail-head">
        <div>
          <h1>{t('timeline.heading')}</h1>
          <div className="muted">
            {t('timeline.stepsAcross', {
              steps: timeline.bundles.length,
              plans: plansById.size,
            })}
          </div>
        </div>
        <div className="tabs" style={{ marginLeft: 'auto' }}>
          <button className={mode === 'order' ? 'active' : ''} onClick={() => chooseMode('order')}>
            {t('timeline.orderOfWork')}
          </button>
          <button className={mode === 'energy' ? 'active' : ''} onClick={() => chooseMode('energy')}>
            {t('timeline.spendEnergy')}
          </button>
        </div>
      </div>

      {mode === 'order' ? (
        <OrderOfWork
          bundles={timeline.bundles}
          db={db}
          player={player}
          open={open}
          onToggle={toggle}
        />
      ) : (
        <SpendEnergy db={db} player={player} />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function OrderOfWork({
  bundles,
  db,
  player,
  open,
  onToggle,
}: {
  bundles: TimelineBundle[];
  db: GameDatabase;
  player: PlayerResponse;
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  useIcons();
  if (bundles.length === 0) {
    return <div className="empty">{t('timeline.allComplete')}</div>;
  }

  // The heading names the rank a group sorts on, not whatever the group's first
  // bundle happens to target. A group can hold both — a rank-up to Bronze II and
  // a level-up by a unit already sitting at Bronze II sort together — and reading
  // the label off the first bundle showed "the rest" for a group that plainly was
  // reaching a rank, and showed it twice running for two different ranks.
  const headings = new Map<number, string>();
  for (const bundle of bundles) {
    const reaches = bundle.targetRank !== undefined;
    if (reaches || !headings.has(bundle.sortRank)) {
      headings.set(
        bundle.sortRank,
        reaches
          ? t('timeline.reaching', { rank: localRank(bundle.sortRank) })
          : // Nothing here moves the rank: this is level and ability work by
            // units already standing at it.
            t('timeline.alreadyAtRank', { rank: localRank(bundle.sortRank) }),
      );
    }
  }

  let tier: number | undefined;
  return (
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
              <button
                className="bundle-head"
                onClick={() => onToggle(id)}
                aria-expanded={open.has(id)}
              >
                <span className="chevron">{open.has(id) ? '▾' : '▸'}</span>
                <Icon src={unitIcon(bundle.unitId)} alt="" size={28} className="portrait" reserve />
                <Link
                  to={`/plans/${bundle.planId}`}
                  className="bundle-unit"
                  onClick={(e) => e.stopPropagation()}
                >
                  {bundle.unitName}
                </Link>
                <span className="muted small">
                  {bundle.steps.map((step) => localStepLabel(step)).join(' · ')}
                </span>
                <span style={{ flex: 1 }} />
                <span className="row-tail">
                  {bundle.unreachable > 0 && (
                    <span className="chip warn">{t('timeline.unreachable', { n: bundle.unreachable })}</span>
                  )}
                  <span className={`chip${bundle.missing === 0 ? ' ok-chip' : ''}`}>
                    {bundle.missing === 0 ? t('timeline.ready') : t('timeline.missing', { n: bundle.missing })}
                  </span>
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
  );
}

/* -------------------------------------------------------------------------- */

function SpendEnergy({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  const [energy, setEnergy] = useState(() => localStorage.getItem(ENERGY_KEY) ?? '60');
  const [stat, setStat] = useState<StatPriority | ''>(
    () => (localStorage.getItem(STAT_KEY) as StatPriority | null) ?? '',
  );
  const [plannedOnly, setPlannedOnly] = useState(
    () => localStorage.getItem(PLANNED_KEY) === '1',
  );
  const [todayOnly, setTodayOnly] = useState(() => localStorage.getItem(TODAY_KEY) === '1');

  const budget = Number(energy) || 0;
  const plans = plansStore.list();
  const planned = new Set(plans.map((p) => p.unitId));

  /**
   * Every slot that could be filled, priced on its own.
   *
   * Deliberately not a basket. The old view spent the whole budget across
   * units and reported one combined total, which answers "what could I buy
   * with all of it" — a question with one answer, decided for you. What a
   * player standing at a campaign screen actually asks is which single slot to
   * go and fill, and that needs the alternatives side by side with their own
   * prices.
   */
  const { affordable, beyond, cheapest, hiddenByToday } = useMemo(() => {
    // Per-unit choices override the page-wide one, so a tank can favour health
    // while the same run tops up someone else's damage.
    const perUnit = new Map<string, StatPriority>();
    for (const saved of plans) {
      if (saved.priority) perUnit.set(saved.unitId, saved.priority);
    }
    const units = plannedOnly && planned.size > 0
      ? player.player.units.filter((u) => planned.has(u.id))
      : player.player.units;

    const found = energyCandidates(units, player, db, {
      ...(stat ? { priority: stat } : {}),
      perUnit,
    });
    // Energy is not the only thing that runs out: a node allows so many runs a
    // day, and a slot needing more of them than are left is not work you can
    // do tonight however much energy you hold.
    const all = todayOnly ? found.filter((c) => c.today !== undefined) : found;
    return {
      affordable: all.filter((c) => c.energy <= budget),
      // Nearest misses first, because the list below is cut short and what is
      // worth seeing above the budget is what a little more energy would reach.
      beyond: all.filter((c) => c.energy > budget).sort((a, b) => a.energy - b.energy),
      cheapest: all.reduce<number | undefined>(
        (min, c) => (min === undefined ? c.energy : Math.min(min, c.energy)),
        undefined,
      ),
      // Told apart from an empty roster: "nothing today" and "nothing at all"
      // want different advice.
      hiddenByToday: todayOnly ? found.length - all.length : 0,
    };
  }, [player, db, stat, budget, plannedOnly, todayOnly, plans.length]);

  return (
    <section className="panel">
      <div className="row wrap" style={{ gap: 16, marginBottom: 12 }}>
        <label className="inline-field">
          <span>{t('timeline.energy')}</span>
          <input
            type="number"
            min={0}
            value={energy}
            onChange={(e) => {
              setEnergy(e.target.value);
              localStorage.setItem(ENERGY_KEY, e.target.value);
            }}
            style={{ width: 100 }}
          />
        </label>
        <label className="inline-field">
          <span>{t('common.favour')}</span>
          <select
            value={stat}
            onChange={(e) => {
              const next = e.target.value as StatPriority | '';
              setStat(next);
              localStorage.setItem(STAT_KEY, next);
            }}
          >
            <option value="">{t('timeline.anyAttribute')}</option>
            <option value="health">{t('common.health')}</option>
            <option value="damage">{t('common.damage')}</option>
            <option value="armour">{t('common.armour')}</option>
          </select>
        </label>
        <div className="tabs">
          <button
            className={plannedOnly ? '' : 'active'}
            onClick={() => {
              setPlannedOnly(false);
              localStorage.setItem(PLANNED_KEY, '0');
            }}
          >
            {t('spend.allUnits')}
          </button>
          <button
            className={plannedOnly ? 'active' : ''}
            onClick={() => {
              setPlannedOnly(true);
              localStorage.setItem(PLANNED_KEY, '1');
            }}
          >
            {t('spend.onlyPlans')}
          </button>
        </div>
        <label className="switch" title={t('spend.todayHint')}>
          <input
            type="checkbox"
            checked={todayOnly}
            onChange={(e) => {
              setTodayOnly(e.target.checked);
              localStorage.setItem(TODAY_KEY, e.target.checked ? '1' : '0');
            }}
          />
          <span>{t('spend.today')}</span>
        </label>
      </div>

      <p className="small muted" style={{ marginTop: 0 }}>
        {t('spend.blurb')} {t('spend.energyNote')}
      </p>
      {plannedOnly && planned.size === 0 && (
        <div className="notice">{t('spend.noPlans')}</div>
      )}

      {/* The verb agrees with the number in Portuguese, so one budget buys and
          several buy. */}
      <h3>{tn(budget, 'spend.afford', 'spend.affordPlural', { n: localNumber(budget) })}</h3>
      {affordable.length === 0 ? (
        <div className="empty">
          {beyond.length === 0 && hiddenByToday > 0
            ? t('spend.todayNone')
            : t('spend.affordNone', {
                n: localNumber(budget),
                cheapest: cheapest === undefined ? '—' : localNumber(Math.round(cheapest)),
              })}
        </div>
      ) : (
        <ByUnit rows={affordable} db={db} player={player} affordable />
      )}

      {beyond.length > 0 && (
        <>
          <h3 style={{ marginTop: 20 }}>{t('spend.beyond')}</h3>
          <ByUnit rows={beyond.slice(0, 12)} db={db} player={player} affordable={false} />
        </>
      )}
    </section>
  );
}

/**
 * Affordable slots, gathered under the unit they belong to.
 *
 * Grouping is what makes these read as alternatives rather than a queue: three
 * rows under one name are three ways to spend the same energy on the same
 * character, and only one of them is going to happen tonight.
 */
function ByUnit({
  rows,
  db,
  player,
  affordable,
}: {
  rows: EnergyCandidate[];
  db: GameDatabase;
  player: PlayerResponse;
  affordable: boolean;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, EnergyCandidate[]>();
    for (const row of rows) {
      const list = map.get(row.unitId);
      if (list) list.push(row);
      else map.set(row.unitId, [row]);
    }
    // Cheapest first inside a unit. These are alternatives — one of them
    // happens tonight — so the question is what the budget reaches, and value
    // for money only breaks the tie between two slots at the same price.
    for (const list of map.values()) list.sort((a, b) => a.energy - b.energy || b.ratio - a.ratio);
    // Units whose best option is cheapest first, so the top of the page is the
    // thing most likely to be done.
    return [...map.entries()].sort(
      (a, b) =>
        Math.min(...a[1].map((c) => c.energy)) - Math.min(...b[1].map((c) => c.energy)),
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
          </div>
          <CandidateTable rows={candidates} db={db} player={player} affordable={affordable} />
        </div>
      ))}
    </>
  );
}

/**
 * What filling this slot sends you out to farm, and where.
 *
 * The row above prices the slot; this is the shopping list behind the price —
 * the same flattened base materials the plan screen shows, each opening into
 * the nodes that drop it. A forged material is not on it: what a player takes
 * to a campaign node is the leaves of the recipe, not the thing at the top.
 *
 * The total here counts what is already in the bag, so it can sit under a
 * higher figure on the row: that one is the price of the whole quantity from
 * scratch, which is what makes it comparable between slots.
 */
function FarmList({
  row,
  db,
  player,
}: {
  row: EnergyCandidate;
  db: GameDatabase;
  player: PlayerResponse;
}) {
  const [shown, setShown] = useState<string>();
  const targets = useMemo(
    () =>
      farmTargets(
        {
          kind: 'upgrade',
          key: row.itemKey,
          name: row.itemName,
          ...(row.rarity !== undefined ? { rarity: row.rarity } : {}),
        },
        row.copies,
        db,
        player,
      ),
    [row, db, player],
  );

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
        {tn(drops, 'spend.toFarm', 'spend.toFarmPlural', {
          energy: localNumber(Math.round(energy)),
        })}
      </p>
      <ul className="item-list nested">
        {targets.map((target) => {
          const id = `${row.unitId}:${row.slotIndex}:${target.key}`;
          const isOpen = shown === id;
          return (
            <li className="item-row" key={target.key}>
              <button
                className="item-head"
                onClick={() => setShown(isOpen ? undefined : id)}
                aria-expanded={isOpen}
              >
                <span className="chevron">{isOpen ? '▾' : '▸'}</span>
                <span className="count">{target.amount}×</span>
                <Icon src={requirementIcon(target.key)} size={22} className="portrait" reserve />
                <span className="item-name">
                  {target.name}
                  {target.rarity !== undefined && (
                    <span className="muted small"> · {localRarity(target.rarity)}</span>
                  )}
                  {/* The chain it is forged into, so a part several recipes
                      down still says what it is for. */}
                  {target.via.length > 0 && (
                    <span className="muted small">
                      {' · '}
                      {t('si.forFlat', { chain: target.via.join(' › ') })}
                    </span>
                  )}
                </span>
                <span className="muted small">
                  {target.energyPerCopy === undefined
                    ? t('si.noSource')
                    : t('spend.each', { n: target.energyPerCopy.toFixed(1) })}
                </span>
                {target.energy !== undefined && (
                  <span className="chip">
                    {t('spend.cost', { n: localNumber(Math.round(target.energy)) })}
                  </span>
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

function CandidateTable({
  rows,
  db,
  player,
  affordable,
}: {
  rows: EnergyCandidate[];
  db: GameDatabase;
  player: PlayerResponse;
  affordable: boolean;
}) {
  const [shown, setShown] = useState<string>();
  return (
    <ul className="item-list" style={{ paddingLeft: 0 }}>
      {rows.map((row) => {
        const id = `${row.unitId}:${row.itemKey}`;
        const isOpen = shown === id;
        return (
          <li key={id} className={`item-row${affordable ? '' : ' dim'}`}>
            <button
              className="item-head"
              onClick={() => setShown(isOpen ? undefined : id)}
              aria-expanded={isOpen}
            >
              <span className="chevron">{isOpen ? '▾' : '▸'}</span>
              <span className="count">{t('spend.cost', { n: localNumber(Math.round(row.energy)) })}</span>
              {/* The slot leads, because that is what the player has to find on
                  the character screen; the material is how they get it. Kept
                  out of `.item-name`, which is where game-English lives. */}
              <span className="slot-pos">
                {t('si.slotPos', { rank: localRank(row.rank), n: row.slotIndex + 1 })}
              </span>
              <span className="item-name muted">
                {t('spend.copies', { n: row.copies, item: row.itemName })}
                {row.rarity !== undefined && (
                  <span className="small"> · {localRarity(row.rarity)}</span>
                )}
              </span>
              <span className="chip ok-chip">
                {t('spend.gain', { n: row.gain, stat: localStat(row.statType) })}
              </span>
              {/* What tonight would actually take, when tonight can take it.
                  The per-copy rate stands in otherwise; it is also on every
                  node in the detail below. */}
              <span className="muted small">
                {row.today === undefined
                  ? t('spend.each', { n: row.energyPerCopy.toFixed(1) })
                  : row.today.raids === 0
                    ? t('spend.raidsNone')
                    : tn(row.today.raids, 'spend.raids', 'spend.raidsPlural')}
              </span>
            </button>
            {isOpen && <FarmList row={row} db={db} player={player} />}
          </li>
        );
      })}
    </ul>
  );
}
