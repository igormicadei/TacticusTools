import { useMemo, useState } from 'react';

import { rarityName } from '@lib/gamedata/enums.js';
import {
  aggregate,
  allocateHoldings,
  isUnfarmable,
  itemSource,
  nodeStatuses,
  ownedByKey,
  planCosts,
  type AllocatedItem,
  type ItemRequirement,
} from '@lib/gamedata/requirements.js';
import type { EvolutionPlan } from '@lib/gamedata/plan.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse, Unit } from '@lib/types/player.js';

type View = 'steps' | 'total';

export function StepItems({
  unit,
  plan,
  db,
  player,
}: {
  unit: Unit;
  plan: EvolutionPlan;
  db: GameDatabase;
  player: PlayerResponse;
}) {
  const [view, setView] = useState<View>('steps');
  const [open, setOpen] = useState<string>();

  const { steps, totals, gold } = useMemo(() => {
    const costs = planCosts(unit, plan, db);
    const owned = ownedByKey(player, db);
    return {
      steps: allocateHoldings(costs, owned),
      totals: aggregate(costs, owned),
      gold: costs.reduce((sum, c) => sum + c.gold, 0),
    };
  }, [unit, plan, db, player]);

  if (plan.steps.length === 0) return null;

  const toggle = (id: string) => setOpen((current) => (current === id ? undefined : id));

  return (
    <section className="panel">
      <div className="row" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Items needed</h3>
        <span style={{ flex: 1 }} />
        <div className="tabs">
          <button className={view === 'steps' ? 'active' : ''} onClick={() => setView('steps')}>
            Per step
          </button>
          <button className={view === 'total' ? 'active' : ''} onClick={() => setView('total')}>
            Total
          </button>
        </div>
      </div>

      <p className="small muted" style={{ marginTop: 0 }}>
        Held stock is spread across the steps that need it, earliest first, so a shortfall
        shows up on the step where it actually bites. Click an item for where to get it.
        {gold > 0 && ` Gold across the plan: ${gold.toLocaleString()}.`}
      </p>

      {view === 'steps'
        ? steps.map(({ step, items }) => (
            <div className="step-block" key={step.order}>
              <div className="step-block-head">
                <span className="step-num">{step.order}</span>
                {step.label}
              </div>
              {items.length === 0 ? (
                <p className="muted small" style={{ margin: '4px 0 0 30px' }}>
                  No items.
                </p>
              ) : (
                <ul className="item-list">
                  {items.map((item) => (
                    <ItemRow
                      key={`${step.order}:${item.key}`}
                      id={`${step.order}:${item.key}`}
                      item={item}
                      db={db}
                      player={player}
                      open={open}
                      onToggle={toggle}
                    />
                  ))}
                </ul>
              )}
            </div>
          ))
        : (
            <ul className="item-list">
              {totals.map((item) => (
                <ItemRow
                  key={item.key}
                  id={item.key}
                  item={item}
                  db={db}
                  player={player}
                  open={open}
                  onToggle={toggle}
                  extra={`${item.owned} held · ${item.steps} step${item.steps === 1 ? '' : 's'}`}
                />
              ))}
            </ul>
          )}
    </section>
  );
}

function ItemRow({
  id,
  item,
  db,
  player,
  open,
  onToggle,
  extra,
}: {
  id: string;
  item: AllocatedItem | (ItemRequirement & { covered: number; missing: number });
  db: GameDatabase;
  player: PlayerResponse;
  open: string | undefined;
  onToggle: (id: string) => void;
  extra?: string;
}) {
  const blocked = isUnfarmable(item, db, player);
  const complete = item.missing === 0;
  const expanded = open === id;

  return (
    <li className={`item-row${blocked ? ' blocked' : ''}${complete ? ' complete' : ''}`}>
      <button className="item-head" onClick={() => onToggle(id)} aria-expanded={expanded}>
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
        <span className="count">
          {item.covered}/{item.amount}
        </span>
        <span className="item-name">
          {item.name}
          {item.rarity !== undefined && (
            <span className="muted small"> · {rarityName(item.rarity)}</span>
          )}
        </span>
        {blocked && <span className="chip warn">Nothing unlocked</span>}
        {extra && <span className="muted small">{extra}</span>}
      </button>
      {expanded && <ItemSources item={item} db={db} player={player} />}
    </li>
  );
}

function ItemSources({
  item,
  db,
  player,
}: {
  item: ItemRequirement;
  db: GameDatabase;
  player: PlayerResponse;
}) {
  const source = itemSource(item, db);

  if (source.kind === 'other') {
    return (
      <p className="source-note muted small">
        Not farmed from campaign nodes — this comes from chests, events and rewards.
      </p>
    );
  }
  if (source.kind === 'none') {
    return <p className="source-note muted small">No published way to obtain this yet.</p>;
  }
  if (source.kind === 'craft') {
    return (
      <div className="source-note">
        <div className="small muted" style={{ marginBottom: 6 }}>
          Crafted from:
        </div>
        <ul className="item-list nested">
          {source.recipe.map((component) => (
            <CraftComponent key={component.key} component={component} db={db} player={player} />
          ))}
        </ul>
      </div>
    );
  }

  const nodes = nodeStatuses(source.nodes, player, db);
  if (nodes.length === 0) {
    return <p className="source-note muted small">No campaign node drops this.</p>;
  }
  return (
    <div className="source-note">
      <table className="nodes">
        <tbody>
          {nodes.map((node) => (
            <tr key={`${node.campaignId}#${node.battleIndex}`} className={node.unlocked ? '' : 'locked'}>
              <td>{node.campaignName}</td>
              <td className="muted">node {node.nodeNumber}</td>
              <td>
                {node.unlocked ? (
                  node.attemptsLeft > 0 ? (
                    <span className="ok">{node.attemptsLeft} tries left today</span>
                  ) : (
                    <span className="muted">no tries left today</span>
                  )
                ) : (
                  <span className="muted">locked</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CraftComponent({
  component,
  db,
  player,
}: {
  component: { key: string; name: string; amount: number; rarity?: number };
  db: GameDatabase;
  player: PlayerResponse;
}) {
  const source = itemSource({ kind: 'upgrade', key: component.key }, db);
  const nodes = source.kind === 'farm' ? nodeStatuses(source.nodes, player, db) : [];
  const openNodes = nodes.filter((n) => n.unlocked);
  return (
    <li className="item-row">
      <div className="item-head static">
        <span className="count">{component.amount}×</span>
        <span className="item-name">{component.name}</span>
        {source.kind === 'farm' ? (
          <span className={`small ${openNodes.length === 0 ? 'warn-text' : 'muted'}`}>
            {openNodes.length} of {nodes.length} nodes unlocked
            {openNodes.length > 0 &&
              ` · ${openNodes.reduce((s, n) => s + n.attemptsLeft, 0)} tries today`}
          </span>
        ) : (
          <span className="muted small">crafted</span>
        )}
      </div>
    </li>
  );
}
