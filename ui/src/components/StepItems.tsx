import { useMemo, useState } from 'react';

import { rarityName } from '@lib/gamedata/enums.js';
import {
  aggregate,
  allocateHoldings,
  canForge,
  isUnfarmable,
  isUnobtainable,
  itemSource,
  nodeStatuses,
  ownedByKey,
  planCosts,
  type AllocatedComponent,
  type AllocatedItem,
  type AggregatedItem,
  type RequirementKind,
} from '@lib/gamedata/requirements.js';
import type { EvolutionPlan } from '@lib/gamedata/plan.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse, Unit } from '@lib/types/player.js';

type View = 'steps' | 'total';

/**
 * Toggle one id in a set of open rows.
 *
 * A set rather than a single id because a recipe row is rendered inside its
 * item's expansion: opening the ingredient must not close the parent drawing it.
 */
export function toggleOpen(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (!next.delete(id)) next.add(id);
  return next;
}

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
  // A set, not a single id: a recipe row lives inside its item's expansion, so
  // opening it must not close the parent that renders it.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const { steps, totals, gold, goldByStep } = useMemo(() => {
    // Finished steps cost nothing more, and pricing them against the unit's
    // present state would invent needs it has already met.
    const remaining = { ...plan, steps: plan.steps.filter((step) => !step.done) };
    const costs = planCosts(unit, remaining, db);
    const owned = ownedByKey(player, db);
    return {
      steps: new Map(allocateHoldings(costs, owned, db).map((s) => [s.step.order, s])),
      goldByStep: new Map(costs.map((c) => [c.step.order, c.gold])),
      totals: aggregate(costs, owned, db),
      gold: costs.reduce((sum, c) => sum + c.gold, 0),
    };
  }, [unit, plan, db, player]);

  if (plan.steps.length === 0) return null;

  const toggle = (id: string) => setOpen((current) => toggleOpen(current, id));

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
        shows up on the step where it actually bites. Recipe ingredients draw on the same
        stock. Items already fitted to the unit are marked applied — they are spent, and
        cannot be moved elsewhere. An item you hold but cannot farm is marked stock only:
        spending it elsewhere cannot be undone. Forged items have no farmable form, so they
        read as ready to forge or parts missing rather than as a count. Click an item for
        where to get it. Gold is shown where it is spent; the API does not report the
        balance, so there is nothing to check it against.
      </p>

      {view === 'steps'
        ? plan.steps.map((step) => {
            // A finished step stays on the page, collapsed: the plan is a route,
            // and a route that erases what you have walked is hard to read.
            if (step.done) {
              return (
                <div className="step-block done" key={step.order}>
                  <div className="step-block-head">
                    <span className="step-num">✓</span>
                    {step.label}
                    <span className="chip ok-chip" style={{ marginLeft: 8 }}>
                      Done
                    </span>
                  </div>
                </div>
              );
            }
            const items = steps.get(step.order)?.items ?? [];
            const stepGold = goldByStep.get(step.order) ?? 0;
            return (
            <div className="step-block" key={step.order}>
              <div className="step-block-head">
                <span className="step-num">{step.order}</span>
                {step.label}
                {stepGold > 0 && (
                  <span className="chip gold" style={{ marginLeft: 8 }}>
                    {stepGold.toLocaleString()} gold
                  </span>
                )}
              </div>
              {items.length === 0 ? (
                <p className="muted small" style={{ margin: '4px 0 0 30px' }}>
                  No items.
                </p>
              ) : (
                <ul className="item-list">
                  {items.map((item) => (
                    <ItemRow
                      key={`${step.order}:${item.key}:${item.applied ? 'a' : 'n'}`}
                      id={`${step.order}:${item.key}:${item.applied ? 'a' : 'n'}`}
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
            );
          })
        : (
            <ul className="item-list">
              {gold > 0 && (
                <li className="item-row">
                  <div className="item-head static">
                    <span className="chevron" />
                    <span className="count">{gold.toLocaleString()}</span>
                    <span className="item-name">Gold</span>
                    <span className="muted small">across the plan</span>
                  </div>
                </li>
              )}
              {totals.map((item) => (
                <ItemRow
                  key={`${item.key}:${item.applied ? 'a' : 'n'}`}
                  id={`${item.key}:${item.applied ? 'a' : 'n'}`}
                  item={item}
                  db={db}
                  player={player}
                  open={open}
                  onToggle={toggle}
                  totals={item}
                />
              ))}
            </ul>
          )}
    </section>
  );
}

export function ItemRow({
  id,
  item,
  db,
  player,
  open,
  onToggle,
  totals,
}: {
  id: string;
  item: AllocatedItem | AggregatedItem;
  db: GameDatabase;
  player: PlayerResponse;
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Set in the aggregate view, where a row stands for several steps. */
  totals?: AggregatedItem;
}) {
  const blocked = isUnfarmable(item, db, player);
  // Covered by stock, but with no source to replace it: worth spending
  // carefully, since there is nowhere to farm more.
  const finite = !blocked && item.covered > 0 && isUnobtainable(item, db, player);
  const complete = item.missing === 0;
  const expanded = open.has(id);
  const forge = forgeState(item, db);

  // Fitted materials have nowhere to go and nothing to find, so they do not
  // open into sources.
  if (item.applied) {
    return (
      <li className="item-row complete applied">
        <div className="item-head static">
          <span className="chevron" />
          <span className="count">{item.amount}×</span>
          <span className="item-name">
            {item.name}
            {item.rarity !== undefined && (
              <span className="muted small"> · {rarityName(item.rarity)}</span>
            )}
          </span>
          <span className="chip ok-chip">Already applied</span>
        </div>
      </li>
    );
  }

  return (
    <li className={`item-row${blocked ? ' blocked' : ''}${complete ? ' complete' : ''}`}>
      <button className="item-head" onClick={() => onToggle(id)} aria-expanded={expanded}>
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
        <Count covered={item.covered} amount={item.amount} forged={forge !== undefined} />
        <span className="item-name">
          {item.name}
          {item.rarity !== undefined && (
            <span className="muted small"> · {rarityName(item.rarity)}</span>
          )}
        </span>
        {forge !== undefined && <ForgeChip ready={forge} />}
        {blocked && <span className="chip warn">Nothing unlocked</span>}
        {finite && (
          <span className="chip caution" title="You hold enough, but no unlocked source can replace what you spend.">
            Stock only — cannot farm more
          </span>
        )}
        {totals && !totals.applied && (
          <span className="muted small">
            {/* "0 held" of a forged item is the same non-fact as "0/1". */}
            {forge !== undefined && totals.owned === 0 ? '' : `${totals.owned} held · `}
            {totals.steps} step{totals.steps === 1 ? '' : 's'}
          </span>
        )}
      </button>
      {expanded && (
        <ItemSources
          item={item}
          db={db}
          player={player}
          idPrefix={id}
          open={open}
          onToggle={onToggle}
        />
      )}
    </li>
  );
}

function ItemSources({
  item,
  db,
  player,
  idPrefix,
  open,
  onToggle,
}: {
  item: AllocatedItem | AggregatedItem;
  db: GameDatabase;
  player: PlayerResponse;
  idPrefix: string;
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
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
    // The allocated recipe covers only the shortfall; when nothing is missing
    // there is nothing to craft, so fall back to the raw recipe for reference.
    const components: AllocatedComponent[] =
      item.components ??
      source.recipe.map((component) => ({ ...component, covered: 0, missing: 0 }));
    return (
      <div className="source-note">
        <div className="small muted" style={{ marginBottom: 6 }}>
          {item.missing > 0
            ? `Crafting the ${item.missing} still missing needs:`
            : 'Crafted from:'}
        </div>
        <ul className="item-list nested">
          {components.map((component) => (
            <ComponentRow
              key={component.key}
              id={`${idPrefix}/${component.key}`}
              component={component}
              db={db}
              player={player}
              open={open}
              onToggle={onToggle}
            />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <NodeTable
      nodes={nodeStatuses(source.nodes, player, db, {
        kind: item.kind,
        ...(item.rarity !== undefined ? { rarity: item.rarity } : {}),
      })}
    />
  );
}

function ComponentRow({
  id,
  component,
  db,
  player,
  open,
  onToggle,
}: {
  id: string;
  component: AllocatedComponent;
  db: GameDatabase;
  player: PlayerResponse;
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const item = { kind: 'upgrade' as const, ...component };
  const source = itemSource(item, db);
  const blocked = isUnfarmable(item, db, player);
  const finite = !blocked && component.covered > 0 && isUnobtainable(item, db, player);
  const complete = component.missing === 0;
  const expanded = open.has(id);
  const forge = forgeState(component, db);

  return (
    <li className={`item-row${blocked ? ' blocked' : ''}${complete ? ' complete' : ''}`}>
      <button className="item-head" onClick={() => onToggle(id)} aria-expanded={expanded}>
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
        <Count
          covered={component.covered}
          amount={component.amount}
          forged={forge !== undefined}
        />
        <span className="item-name">
          {component.name}
          {component.rarity !== undefined && (
            <span className="muted small"> · {rarityName(component.rarity)}</span>
          )}
        </span>
        {forge !== undefined && <ForgeChip ready={forge} />}
        {blocked && <span className="chip warn">Nothing unlocked</span>}
        {finite && (
          <span className="chip caution" title="You hold enough, but no unlocked source can replace what you spend.">
            Stock only — cannot farm more
          </span>
        )}

      </button>
      {expanded &&
        (source.kind === 'craft' ? (
          <div className="source-note">
            <div className="small muted" style={{ marginBottom: 6 }}>
              {component.missing > 0
                ? `Crafting the ${component.missing} still missing needs:`
                : 'Crafted from:'}
            </div>
            <ul className="item-list nested">
              {(
                component.components ??
                source.recipe.map((child) => ({ ...child, covered: 0, missing: 0 }))
              ).map((child) => (
                <ComponentRow
                  key={child.key}
                  id={`${id}/${child.key}`}
                  component={child}
                  db={db}
                  player={player}
                  open={open}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          </div>
        ) : source.kind === 'farm' ? (
          <NodeTable
            nodes={nodeStatuses(source.nodes, player, db, {
              kind: 'upgrade',
              ...(component.rarity !== undefined ? { rarity: component.rarity } : {}),
            })}
          />
        ) : (
          <p className="source-note muted small">No published way to obtain this yet.</p>
        ))}
    </li>
  );
}

/**
 * Whether a shortfall has to be forged, and whether the parts are in hand.
 *
 * `undefined` means the question does not arise: the item is farmed, or nothing
 * is missing, so a plain count says all there is to say.
 */
function forgeState(
  item: {
    kind?: RequirementKind;
    key: string;
    missing: number;
    components?: readonly AllocatedComponent[] | undefined;
  },
  db: GameDatabase,
): boolean | undefined {
  if (item.missing <= 0) return undefined;
  if (itemSource({ kind: item.kind ?? 'upgrade', key: item.key }, db).kind !== 'craft') {
    return undefined;
  }
  return canForge(item.components ?? []);
}

/**
 * A forged item has no farmable form, so "0 of 1" reads as a shortage that no
 * amount of farming can fix. The count is dropped for those in favour of the
 * only question that matters — are the parts there — while a partial holding
 * still shows, since that is a real head start.
 */
function Count({
  covered,
  amount,
  forged,
}: {
  covered: number;
  amount: number;
  forged: boolean;
}) {
  if (forged && covered === 0) return <span className="count" />;
  return (
    <span className="count">
      {covered}/{amount}
    </span>
  );
}

function ForgeChip({ ready }: { ready: boolean }) {
  return ready ? (
    <span className="chip ok-chip" title="Every ingredient is in hand — forge it.">
      Ready to forge
    </span>
  ) : (
    <span className="chip" title="Some ingredients are still missing.">
      Parts missing
    </span>
  );
}

function NodeTable({ nodes }: { nodes: ReturnType<typeof nodeStatuses> }) {
  if (nodes.length === 0) {
    return <p className="source-note muted small">No campaign node drops this.</p>;
  }
  // Cheapest per copy among the nodes actually open, so the best buy is marked
  // rather than left to be worked out by eye.
  const best = Math.min(
    ...nodes
      .filter((n) => n.unlocked && n.energyPerDrop !== undefined)
      .map((n) => n.energyPerDrop!),
  );
  return (
    <div className="source-note">
      <table className="nodes">
        <tbody>
          {nodes.map((node) => (
            <tr
              key={`${node.campaignId}#${node.battleIndex}`}
              className={node.unlocked ? '' : 'locked'}
            >
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
              {/* Run cost and cost per copy are separate on purpose: a node can
                  be the cheapest per copy and still be the one you cannot
                  afford, because a run is all-or-nothing. */}
              <td className="muted">{node.energyCost !== undefined ? `${node.energyCost}⚡/run` : ''}</td>
              <td className="muted">
                {node.dropRate !== undefined ? `${(node.dropRate * 100).toFixed(0)}% drop` : ''}
              </td>
              <td className={node.unlocked && node.energyPerDrop === best ? 'ok' : 'muted'}>
                {node.energyPerDrop !== undefined
                  ? `${node.energyPerDrop.toFixed(1)}⚡ each`
                  : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        Drop rates are published per campaign type, not per node. A rate above
        100% means more than one copy per run on average.
      </p>
    </div>
  );
}
