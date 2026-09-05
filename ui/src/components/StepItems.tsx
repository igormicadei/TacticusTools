import { useMemo, useState } from 'react';


import {
  aggregate,
  allocateHoldings,
  canForge,
  flattenNeeds,
  isUnfarmable,
  isUnobtainable,
  itemSource,
  nodeStatuses,
  ownedByKey,
  planCosts,
  type AllocatedComponent,
  type AllocatedItem,
  type AggregatedItem,
  type FlatNeed,
  type RequirementKind,
  type SlotPlacement,
} from '@lib/gamedata/requirements.js';
import type { EvolutionPlan } from '@lib/gamedata/plan.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse, Unit } from '@lib/types/player.js';

import { campaignIcon, requirementIcon, uiIcon } from '../data/icons.ts';
import { Icon, useIcons } from './Icon.tsx';
import { localNumber, localRank, localRarity, localStat } from '../i18n/game.ts';
import { t, tn } from '../i18n/locale.ts';

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
  // What you take to a campaign node is the leaves of the recipe trees, not the
  // composites the plan names. Off by default, because the unflattened list is
  // the one that matches what the game's own rank screen shows.
  const [flat, setFlat] = useState(false);
  // A set, not a single id: a recipe row lives inside its item's expansion, so
  // opening it must not close the parent that renders it.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const { steps, totals, gold, goldByStep, allItems } = useMemo(() => {
    // Finished steps cost nothing more, and pricing them against the unit's
    // present state would invent needs it has already met.
    const remaining = { ...plan, steps: plan.steps.filter((step) => !step.done) };
    const costs = planCosts(unit, remaining, db);
    const owned = ownedByKey(player, db);
    const allocated = allocateHoldings(costs, owned, db);
    return {
      steps: new Map(allocated.map((s) => [s.step.order, s])),
      goldByStep: new Map(costs.map((c) => [c.step.order, c.gold])),
      totals: aggregate(costs, owned, db),
      gold: costs.reduce((sum, c) => sum + c.gold, 0),
      // Every step's requirements in one list, which is what the flattened
      // total is built from: pooling after flattening, so a base material
      // wanted by two steps reads as one line.
      allItems: allocated.flatMap((s) => s.items),
    };
  }, [unit, plan, db, player]);

  if (plan.steps.length === 0) return null;

  const toggle = (id: string) => setOpen((current) => toggleOpen(current, id));

  return (
    <section className="panel">
      {/* Wraps: a heading plus three controls does not fit a phone on one line,
          and the spacer then simply ends the first line. */}
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{t('si.heading')}</h3>
        <span style={{ flex: 1 }} />
        <div className="tabs">
          <button className={view === 'steps' ? 'active' : ''} onClick={() => setView('steps')}>
            {t('si.perStep')}
          </button>
          <button className={view === 'total' ? 'active' : ''} onClick={() => setView('total')}>
            {t('si.total')}
          </button>
        </div>
        <label className="switch" title={t('si.flattenHint')}>
          <input type="checkbox" checked={flat} onChange={(e) => setFlat(e.target.checked)} />
          <span>{t('si.flatten')}</span>
        </label>
      </div>

      <p className="small muted" style={{ marginTop: 0 }}>{t('si.blurb')}</p>

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
                      {t('si.done')}
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
                    {t('si.goldChip', { n: localNumber(stepGold) })}
                  </span>
                )}
              </div>
              {items.length === 0 ? (
                <p className="muted small" style={{ margin: '4px 0 0 30px' }}>
                  {t('si.noItems')}
                </p>
              ) : flat ? (
                <BySlot items={items} />
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
        : flat ? (
            <FlatList needs={flattenNeeds(allItems)} />
          )
        : (
            <ul className="item-list">
              {gold > 0 && (
                <li className="item-row">
                  <div className="item-head static">
                    <span className="chevron" />
                    <span className="count">{localNumber(gold)}</span>
                    <span className="item-name">{t('si.gold')}</span>
                    <span className="muted small">{t('si.acrossPlan')}</span>
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

/**
 * Which slots a material fills, and what they give.
 *
 * A material often fills more than one slot in a rank span, so the gains are
 * summed per stat rather than listed one by one — six separate "+30 health"
 * chips say less than one "+90 health" does. The level is the rank's, and the
 * highest of them governs, since that is the one that gates leaving the rank.
 */
function SlotNote({ slots }: { slots?: readonly SlotPlacement[] | undefined }) {
  const summary = useMemo(() => {
    if (!slots?.length) return undefined;
    const gains = new Map<string, number>();
    let level: number | undefined;
    for (const slot of slots) {
      if (slot.statType !== undefined && slot.statIncrease !== undefined) {
        gains.set(slot.statType, (gains.get(slot.statType) ?? 0) + slot.statIncrease);
      }
      if (slot.levelToComplete !== undefined) {
        level = Math.max(level ?? 0, slot.levelToComplete);
      }
    }
    return {
      positions: slots
        .map((slot) => t('si.slotPos', { rank: localRank(slot.rank), n: slot.slotIndex + 1 }))
        .join(', '),
      gains: [...gains.entries()].map(
        ([stat, total]) => t('si.slotGain', { n: total, stat: localStat(stat) }),
      ),
      level,
    };
  }, [slots]);

  if (!summary) return null;
  return (
    <>
      <span className="muted small" title={summary.positions}>
        {summary.positions}
      </span>
      {summary.gains.map((gain) => (
        <span className="slot-gain" key={gain}>
          {gain}
        </span>
      ))}
      {summary.level !== undefined && (
        <span
          className="muted small"
          title={t('si.levelHint')}
        >
          {t('si.levelShort', { n: summary.level })}
        </span>
      )}
    </>
  );
}

/** `Bronze III · slot 4` — the position, named the way the game screen reads. */
function slotKey(slot: SlotPlacement): string {
  return `${slot.rank}:${slot.slotIndex}`;
}

/**
 * A rank's requirements arranged by the slot they fill.
 *
 * The plan names materials; the game's rank screen shows six slots. Grouping
 * this way answers the question actually being asked in front of that screen —
 * what does *this* slot want, what does it give me, and can I fit it yet —
 * rather than leaving the reader to map a pooled list back onto positions.
 */
function BySlot({ items }: { items: AllocatedItem[] }) {
  const groups = useMemo(() => {
    const needs = flattenNeeds(items);
    const bySlot = new Map<string, { slot: SlotPlacement; needs: FlatNeed[] }>();
    const loose: FlatNeed[] = [];
    for (const need of needs) {
      if (need.slots.length === 0) {
        loose.push(need);
        continue;
      }
      for (const slot of need.slots) {
        const key = slotKey(slot);
        const group = bySlot.get(key) ?? { slot, needs: [] };
        group.needs.push(need);
        bySlot.set(key, group);
      }
    }
    return {
      slots: [...bySlot.values()].sort(
        (a, b) => a.slot.rank - b.slot.rank || a.slot.slotIndex - b.slot.slotIndex,
      ),
      loose,
    };
  }, [items]);

  if (groups.slots.length === 0 && groups.loose.length === 0) {
    return (
      <p className="muted small" style={{ margin: '4px 0 0 30px' }}>
        Everything this step needs is already in hand.
      </p>
    );
  }

  return (
    <div className="slot-groups">
      {groups.slots.map(({ slot, needs }) => (
        <div className="slot-group" key={slotKey(slot)}>
          <div className="slot-head">
            <span className="slot-pos">
              {t('si.slotPos', { rank: localRank(slot.rank), n: slot.slotIndex + 1 })}
            </span>
            {slot.statIncrease !== undefined && slot.statType !== undefined && (
              <span className="slot-gain">
                {t('si.slotGain', {
                  n: slot.statIncrease,
                  stat: localStat(slot.statType),
                })}
              </span>
            )}
            {slot.levelToComplete !== undefined && (
              <span
                className="chip"
                title={t('si.levelHint')}
              >
                {t('si.needsLevel', { n: slot.levelToComplete })}
              </span>
            )}
          </div>
          <FlatList needs={needs} />
        </div>
      ))}
      {groups.loose.length > 0 && (
        <div className="slot-group">
          <div className="slot-head">
            <span className="slot-pos">{t('si.notARankSlot')}</span>
          </div>
          <FlatList needs={groups.loose} />
        </div>
      )}
    </div>
  );
}

/**
 * Base materials to go and find, with the recipe that wanted them.
 *
 * No disclosure and no source list: this view exists to be read at a glance
 * against a campaign screen, and a row that opens into three more rows defeats
 * that. The unflattened view is where sources live.
 */
function FlatList({ needs }: { needs: FlatNeed[] }) {
  useIcons();
  if (needs.length === 0) {
    return (
      <p className="muted small" style={{ margin: '4px 0 0 30px' }}>
        Nothing left to farm here.
      </p>
    );
  }
  return (
    <ul className="item-list">
      {needs.map((need) => (
        <li className="item-row" key={need.key}>
          <div className="item-head static">
            <span className="chevron" />
            <span className="count">{need.amount}×</span>
            <Icon src={requirementIcon(need.key)} size={22} className="portrait" reserve />
            <span className="item-name">
              {need.name}
              {need.rarity !== undefined && (
                <span className="muted small"> · {localRarity(need.rarity)}</span>
              )}
            </span>
            <span className="row-tail">
              {need.via.length > 0 && (
                <span className="muted small">
                  {t('si.forFlat', { chain: need.via.join(' › ') })}
                </span>
              )}
            </span>
          </div>
        </li>
      ))}
    </ul>
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
  useIcons();
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
          <Icon src={requirementIcon(item.key)} size={22} className="portrait" reserve />
          <span className="item-name">
            {item.name}
            {item.rarity !== undefined && (
              <span className="muted small"> · {localRarity(item.rarity)}</span>
            )}
          </span>
          <span className="row-tail">
            <span className="chip ok-chip">{t('si.alreadyApplied')}</span>
            <SlotNote slots={item.slots} />
          </span>
        </div>
      </li>
    );
  }

  return (
    <li className={`item-row${blocked ? ' blocked' : ''}${complete ? ' complete' : ''}`}>
      <button className="item-head" onClick={() => onToggle(id)} aria-expanded={expanded}>
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
        <Count covered={item.covered} amount={item.amount} forged={forge !== undefined} />
        <Icon src={requirementIcon(item.key)} size={22} className="portrait" reserve />
        <span className="item-name">
          {item.name}
          {item.rarity !== undefined && (
            <span className="muted small"> · {localRarity(item.rarity)}</span>
          )}
        </span>
        <span className="row-tail">
          <SlotNote slots={item.slots} />
          {forge !== undefined && <ForgeChip ready={forge} />}
          {blocked && <span className="chip warn">{t('si.nothingUnlocked')}</span>}
          {finite && (
            <span className="chip caution" title={t('si.stockOnlyHint')}>
              {t('si.stockOnly')}
            </span>
          )}
          {totals && !totals.applied && (
            <span className="muted small">
              {/* "0 held" of a forged item is the same non-fact as "0/1". */}
              {forge !== undefined && totals.owned === 0
                ? ''
                : `${t('si.held', { n: totals.owned })} · `}
              {tn(totals.steps, 'si.steps', 'si.stepsPlural')}
            </span>
          )}
        </span>
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
        {t('si.notFarmed')}
      </p>
    );
  }
  if (source.kind === 'none') {
    return <p className="source-note muted small">{t('si.noSource')}</p>;
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
            ? t('si.craftingNeeds', { n: item.missing })
            : t('si.craftedFrom')}
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
  useIcons();
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
        <Icon src={requirementIcon(item.key)} size={22} className="portrait" reserve />
        <span className="item-name">
          {component.name}
          {component.rarity !== undefined && (
            <span className="muted small"> · {localRarity(component.rarity)}</span>
          )}
        </span>
        <span className="row-tail">
          {/* No slot note here: an ingredient fills no slot of its own, the
              item it forges into does. */}
          {forge !== undefined && <ForgeChip ready={forge} />}
          {blocked && <span className="chip warn">{t('si.nothingUnlocked')}</span>}
          {finite && (
            <span className="chip caution" title={t('si.stockOnlyHint')}>
              {t('si.stockOnly')}
            </span>
          )}
        </span>
      </button>
      {expanded &&
        (source.kind === 'craft' ? (
          <div className="source-note">
            <div className="small muted" style={{ marginBottom: 6 }}>
              {component.missing > 0
                ? t('si.craftingNeeds', { n: component.missing })
                : t('si.craftedFrom')}
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
          <p className="source-note muted small">{t('si.noSource')}</p>
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
    <span className="chip ok-chip" title={t('si.readyToForgeHint')}>
      {t('si.readyToForge')}
    </span>
  ) : (
    <span className="chip" title={t('si.partsMissingHint')}>
      {t('si.partsMissing')}
    </span>
  );
}

function NodeTable({ nodes }: { nodes: ReturnType<typeof nodeStatuses> }) {
  useIcons();
  if (nodes.length === 0) {
    return <p className="source-note muted small">{t('si.noNodeDrops')}</p>;
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
      <div className="table-wrap">
      <table className="nodes">
        <tbody>
          {nodes.map((node) => (
            <tr
              key={`${node.campaignId}#${node.battleIndex}`}
              className={node.unlocked ? '' : 'locked'}
            >
              <td className="node-campaign">
                <Icon src={campaignIcon(node.campaignId)} size={18} className="portrait" reserve />
                {node.campaignName}
              </td>
              <td className="muted">{t('si.node', { n: node.nodeNumber })}</td>
              <td>
                {node.unlocked ? (
                  node.attemptsLeft > 0 ? (
                    <span className="ok">{t('si.triesLeft', { n: node.attemptsLeft })}</span>
                  ) : (
                    <span className="muted">{t('si.noTriesLeft')}</span>
                  )
                ) : (
                  <span className="muted">{t('si.locked')}</span>
                )}
              </td>
              {/* Run cost and cost per copy are separate on purpose: a node can
                  be the cheapest per copy and still be the one you cannot
                  afford, because a run is all-or-nothing. */}
              <td className="muted">
                {node.energyCost !== undefined && (
                  <>
                    {node.energyCost}
                    <Energy /> /run
                  </>
                )}
              </td>
              <td className="muted">
                {node.dropRate !== undefined ? `${(node.dropRate * 100).toFixed(0)}% drop` : ''}
              </td>
              <td className={node.unlocked && node.energyPerDrop === best ? 'ok' : 'muted'}>
                {node.energyPerDrop !== undefined && (
                  <>
                    {node.energyPerDrop.toFixed(1)}
                    <Energy /> each
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        Drop rates are published per campaign type, not per node. A rate above
        100% means more than one copy per run on average.
      </p>
    </div>
  );
}

/** The game's energy glyph, falling back to the character it stands in for. */
export function Energy() {
  useIcons();
  const src = uiIcon('energy');
  return src ? <Icon src={src} size={13} alt="energy" /> : <>⚡</>;
}
