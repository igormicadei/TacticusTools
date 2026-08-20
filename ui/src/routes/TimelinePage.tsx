import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { rankName, rarityName } from '@lib/gamedata/enums.js';
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
          ← All plans
        </Link>
        <div className="empty">
          No plans yet. The timeline puts every plan into one running order.
        </div>
      </>
    );
  }

  return (
    <>
      <Link to="/plans" className="back">
        ← All plans
      </Link>

      <div className="detail-head">
        <div>
          <h1>Everything, in order</h1>
          <div className="muted">
            {timeline.bundles.length} steps across {plansById.size} plan
            {plansById.size === 1 ? '' : 's'}
          </div>
        </div>
        <div className="tabs" style={{ marginLeft: 'auto' }}>
          <button className={mode === 'order' ? 'active' : ''} onClick={() => setMode('order')}>
            Order of work
          </button>
          <button className={mode === 'energy' ? 'active' : ''} onClick={() => setMode('energy')}>
            Spend energy
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
    return <div className="empty">Every plan is complete.</div>;
  }

  let tier: number | undefined;
  return (
    <section className="panel">
      <p className="small muted" style={{ marginTop: 0 }}>
        Grouped by the rank each step reaches, so the roster comes up together, and
        within a rank the cheapest first. A unit needing an ascension to reach a rank
        sorts behind units that can reach it without one — its bundle costs more.
        Held stock is spread across this order, so two units wanting the same material
        no longer both count it as theirs.
      </p>

      {bundles.map((bundle) => {
        const id = `${bundle.planId}:${bundle.sortRank}`;
        const heading = bundle.sortRank !== tier ? ((tier = bundle.sortRank), true) : false;
        return (
          <div key={id}>
            {heading && (
              <h3 className="tier-head row">
                {bundle.targetRank !== undefined && (
                  <Icon src={rankIcon(bundle.targetRank)} size={20} />
                )}
                Reaching {bundle.targetRank !== undefined ? rankName(bundle.targetRank) : 'the rest'}
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
                  {bundle.steps.map((s) => s.label).join(' · ')}
                </span>
                <span style={{ flex: 1 }} />
                {bundle.unreachable > 0 && (
                  <span className="chip warn">{bundle.unreachable} unreachable</span>
                )}
                <span className={`chip${bundle.missing === 0 ? ' ok-chip' : ''}`}>
                  {bundle.missing === 0 ? 'Ready' : `${bundle.missing} missing`}
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
          <span>Energy available</span>
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
          <span>Favour</span>
          <select
            value={stat}
            onChange={(e) => {
              const next = e.target.value as StatPriority | '';
              setStat(next);
              localStorage.setItem(STAT_KEY, next);
            }}
          >
            <option value="">Any attribute</option>
            <option value="health">Health</option>
            <option value="damage">Damage</option>
            <option value="armour">Armour</option>
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <span className="chip">
          {energyUsed.toFixed(0)} of {budget}⚡ · +{gain} {stat ? STAT_LABEL[stat] : 'total'}
        </span>
      </div>

      <p className="small muted" style={{ marginTop: 0 }}>
        Only the slots each unit can fill at the rank it is on now — an upgrade for a
        later rank raises nothing until you get there. A slot is all or nothing, so a
        part-filled one counts for zero and the whole quantity is priced. Prices are
        expected values over published drop rates, so treat the order as advice rather
        than arithmetic. Your energy is not in the API; type it above.
      </p>

      {picks.length === 0 ? (
        <div className="empty">
          Nothing fits in {budget}⚡.
          {rest[0] && ` The cheapest worthwhile run is ${rest[0].energy.toFixed(0)}⚡.`}
        </div>
      ) : (
        <CandidateTable rows={picks} db={db} player={player} affordable />
      )}

      {rest.length > 0 && (
        <>
          <h3 style={{ marginTop: 20 }}>Beyond this budget</h3>
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
                  <span className="muted small"> · {rarityName(row.rarity)}</span>
                )}
              </span>
              <span className="chip ok-chip">
                +{row.gain} {STAT_LABEL[row.stat].toLowerCase()}
              </span>
              <span className="muted small">
                {row.copies}× at {row.energyPerCopy.toFixed(1)}⚡
              </span>
            </button>
            {isOpen && (
              <div className="source-note">
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
                          <td className="muted">node {node.nodeNumber}</td>
                          <td>
                            {node.unlocked ? (
                              node.attemptsLeft > 0 ? (
                                <span className="ok">{node.attemptsLeft} tries left</span>
                              ) : (
                                <span className="muted">none left today</span>
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
                {row.nodes.length === 0 && (
                  <p className="muted small" style={{ margin: 0 }}>
                    Crafted — the price above is its ingredients, farmed at their cheapest
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
