import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';


import { currentState, markProgress, resolvePlan } from '@lib/gamedata/plan.js';
import { nodeStatuses } from '@lib/gamedata/requirements.js';
import {
  buildTimeline,
  energyCandidates,
  planEnergy,
  type EnergyCandidate,
  type StatPriority,
  type TimelineBundle,
} from '@lib/gamedata/timeline.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { ItemRow, toggleOpen } from '../components/StepItems.tsx';
import { plansStore } from '../data/plans.ts';
import { rankIcon, unitIcon } from '../data/icons.ts';
import { Icon, useIcons } from '../components/Icon.tsx';
import { localRank, localRarity, localStepLabel } from '../i18n/game.ts';
import { t } from '../i18n/locale.ts';

type Mode = 'order' | 'energy';

const ENERGY_KEY = 'tacticus-tools:energy';
const STAT_KEY = 'tacticus-tools:energyStat';

const STAT_LABEL: Record<StatPriority, string> = {
  health: 'Health',
  damage: 'Damage',
  armour: 'Armour',
};

export function TimelinePage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  const [mode, setMode] = useState<Mode>('order');
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
          <button className={mode === 'order' ? 'active' : ''} onClick={() => setMode('order')}>
            {t('timeline.orderOfWork')}
          </button>
          <button className={mode === 'energy' ? 'active' : ''} onClick={() => setMode('energy')}>
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

  const budget = Number(energy) || 0;

  const { picks, rest, energyUsed, gain } = useMemo(() => {
    // Per-unit choices override the page-wide one, so a tank can favour health
    // while the same run tops up someone else's damage.
    const perUnit = new Map<string, StatPriority>();
    for (const saved of plansStore.list()) {
      if (saved.priority) perUnit.set(saved.unitId, saved.priority);
    }
    const candidates = energyCandidates(player.player.units, player, db, {
      ...(stat ? { priority: stat } : {}),
      perUnit,
    });
    return planEnergy(candidates, budget);
  }, [player, db, stat, budget]);

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
            style={{ width: 90 }}
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
        <span style={{ flex: 1 }} />
        <span className="chip">
          {energyUsed.toFixed(0)} of {budget}⚡ · +{gain} {stat ? STAT_LABEL[stat] : 'total'}
        </span>
      </div>

      <p className="small muted" style={{ marginTop: 0 }}>
        {t('timeline.spendBlurb')} Your energy is not in the API; type it above.
      </p>

      {picks.length === 0 ? (
        <div className="empty">
          {t('timeline.nothingFits', { n: budget })}
          {rest[0] && t('timeline.cheapestRun', { n: rest[0].energy.toFixed(0) })}
        </div>
      ) : (
        <CandidateTable rows={picks} db={db} player={player} affordable />
      )}

      {rest.length > 0 && (
        <>
          <h3 style={{ marginTop: 20 }}>{t('timeline.beyondBudget')}</h3>
          <CandidateTable rows={rest.slice(0, 12)} db={db} player={player} affordable={false} />
        </>
      )}
    </section>
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
              <span className="count">{row.energy.toFixed(0)}⚡</span>
              <span className="item-name">
                <Link
                  to={`/units/${encodeURIComponent(row.unitId)}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {row.unitName}
                </Link>
                <span className="muted"> · {row.itemName}</span>
                {row.rarity !== undefined && (
                  <span className="muted small"> · {localRarity(row.rarity)}</span>
                )}
              </span>
              <span className="chip ok-chip">
                +{row.gain} {STAT_LABEL[row.stat].toLowerCase()}
              </span>
              <span className="muted small">
                {t('timeline.copiesAt', {
                  n: row.copies,
                  node: `${row.energyPerCopy.toFixed(1)}⚡`,
                })}
              </span>
            </button>
            {isOpen && (
              <div className="source-note">
                <div className="table-wrap">
                <table className="nodes">
                  <tbody>
                    {nodeStatuses(
                      row.nodes,
                      player,
                      db,
                      row.rarity !== undefined
                        ? { kind: 'upgrade', rarity: row.rarity }
                        : { kind: 'upgrade' },
                    )
                      .slice(0, 6)
                      .map((node) => (
                        <tr
                          key={`${node.campaignId}#${node.battleIndex}`}
                          className={node.unlocked ? '' : 'locked'}
                        >
                          <td>{node.campaignName}</td>
                          <td className="muted">{t('si.node', { n: node.nodeNumber })}</td>
                          <td>
                            {node.unlocked ? (
                              node.attemptsLeft > 0 ? (
                                <span className="ok">{t('timeline.triesLeft', { n: node.attemptsLeft })}</span>
                              ) : (
                                <span className="muted">{t('timeline.noneLeftToday')}</span>
                              )
                            ) : (
                              <span className="muted">locked</span>
                            )}
                          </td>
                          <td className="muted">
                            {node.energyCost !== undefined ? `${node.energyCost}⚡/run` : ''}
                          </td>
                          <td className="muted">
                            {node.energyPerDrop !== undefined
                              ? `${node.energyPerDrop.toFixed(1)}⚡ each`
                              : ''}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                </div>
                {row.nodes.length === 0 && (
                  <p className="muted small" style={{ margin: 0 }}>
                    {t('timeline.craftedNote')}
                    open nodes.
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
