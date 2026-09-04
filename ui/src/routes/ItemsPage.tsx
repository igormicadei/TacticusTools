import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { rankName, rarityName } from '@lib/gamedata/enums.js';
import {
  materialCatalogue,
  nextRankCosts,
  type MaterialEntry,
  type MaterialUse,
  type NextRank,
  type RankMaterial,
} from '@lib/gamedata/materials.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { Icon, useIcons } from '../components/Icon.tsx';
import { rankIcon, requirementIcon, unitIcon } from '../data/icons.ts';

type View = 'inventory' | 'ranks';
type Filter = 'stock' | 'all' | 'unused';
type Scope = 'ahead' | 'roster' | 'everyone';

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  { key: 'stock', label: 'In stock', hint: 'Materials you hold at least one of' },
  { key: 'all', label: 'Every material', hint: 'The whole table, held or not' },
  { key: 'unused', label: 'Spent by nothing', hint: 'No rank in the game asks for these' },
];

/**
 * Whose ranks count as a use.
 *
 * The unfiltered answer is true and useless: 112 of the game's 128 units spend
 * a Fine Micro-Generator somewhere, most of them at ranks a given player will
 * never reach with units they do not own. What a player can act on is their own
 * roster, and within it the ranks still ahead — a rank already passed spent its
 * materials long ago.
 */
const SCOPES: { key: Scope; label: string; hint: string }[] = [
  { key: 'ahead', label: 'Still ahead', hint: 'Your units, at ranks they have not reached yet' },
  { key: 'roster', label: 'Your roster', hint: 'Your units, at every rank including ones passed' },
  { key: 'everyone', label: 'Every unit', hint: 'The whole game, owned or not' },
];

export function ItemsPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const [view, setView] = useState<View>('inventory');
  const [filter, setFilter] = useState<Filter>('stock');
  const [scope, setScope] = useState<Scope>('ahead');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  // One walk of every rank table in the game, so it is done once per roster
  // rather than once per row opened.
  const catalogue = useMemo(() => materialCatalogue(player, db), [player, db]);
  const ranks = useMemo(() => nextRankCosts(player, db), [player, db]);

  const rankById = useMemo(
    () => new Map(player.player.units.map((u) => [u.id, u.rank])),
    [player],
  );

  /** The catalogue narrowed to the chosen scope, uses and counts alike. */
  const scoped = useMemo(() => {
    if (scope === 'everyone') return catalogue;
    return catalogue.map((material) => {
      const uses = material.uses.filter((use) => {
        const current = rankById.get(use.unitId);
        if (current === undefined) return false;
        return scope === 'roster' || use.rank >= current;
      });
      return { ...material, uses, unitCount: new Set(uses.map((u) => u.unitId)).size };
    });
  }, [catalogue, scope, rankById]);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped
      .filter((m) => {
        if (filter === 'stock' && m.owned === 0) return false;
        if (filter === 'unused' && m.uses.length > 0) return false;
        if (!q) return true;
        return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
      })
      .sort((a, b) => b.owned - a.owned || a.name.localeCompare(b.name));
  }, [scoped, filter, query]);

  const held = catalogue.filter((m) => m.owned > 0).length;

  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          <button className={view === 'inventory' ? 'active' : ''} onClick={() => setView('inventory')}>
            Where materials go
          </button>
          <button className={view === 'ranks' ? 'active' : ''} onClick={() => setView('ranks')}>
            Next rank per unit
          </button>
        </div>
        {view === 'inventory' && (
          <>
            <div className="tabs">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={filter === f.key ? 'active' : ''}
                  onClick={() => setFilter(f.key)}
                  title={f.hint}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="tabs">
              {SCOPES.map((sc) => (
                <button
                  key={sc.key}
                  className={scope === sc.key ? 'active' : ''}
                  onClick={() => setScope(sc.key)}
                  title={sc.hint}
                >
                  {sc.label}
                </button>
              ))}
            </div>
            <input
              className="search"
              placeholder="Search materials…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="counts small muted">
              <span className="count">
                <b>{held}</b> in stock
              </span>
              <span className="count">
                <b>{catalogue.length}</b> known
              </span>
            </div>
          </>
        )}
      </div>

      {view === 'inventory' ? (
        <section className="panel">
          <p className="small muted" style={{ marginTop: 0 }}>
            The game marks a material as “used for ranking up” without saying by whom. This is
            the rank tables read backwards. A material counts as used whether the rank asks for
            it outright or forges it into something that is asked for, so a component several
            recipes deep still shows the ranks it ultimately serves — with the chain that gets
            it there, and the amount multiplied along it. Scoped by default to your own units at
            ranks they have not reached yet, since that is what you can still spend it on —
            widen it with the buttons above.
          </p>
          {rows.length === 0 ? (
            <div className="empty">Nothing matches “{query}”.</div>
          ) : (
            <ul className="item-list" style={{ paddingLeft: 0 }}>
              {rows.map((material) => (
                <MaterialRow
                  key={material.id}
                  material={material}
                  rankById={rankById}
                  expanded={open.has(material.id)}
                  onToggle={() => toggle(material.id)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <NextRanks ranks={ranks} open={open} onToggle={toggle} />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function MaterialRow({
  material,
  rankById,
  expanded,
  onToggle,
}: {
  material: MaterialEntry;
  rankById: ReadonlyMap<string, number>;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="item-row">
      <button className="item-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
        <span className="count">{material.owned > 0 ? `${material.owned}×` : '—'}</span>
        <Icon src={requirementIcon(`upgrade:${material.id}`)} size={22} className="portrait" reserve />
        <span className="item-name">
          {material.name}
          {material.rarity !== undefined && (
            <span className="muted small"> · {rarityName(material.rarity)}</span>
          )}
        </span>
        <span className="row-tail">
          {!material.farmable && (
            <span className="chip gold" title="No campaign node drops this; it has to be forged.">
              Forged
            </span>
          )}
          <span className="muted small">
            {material.uses.length === 0
              ? 'nothing in scope needs this'
              : `${material.unitCount} unit${material.unitCount === 1 ? '' : 's'}`}
          </span>
        </span>
      </button>
      {expanded && <MaterialUses material={material} rankById={rankById} />}
    </li>
  );
}

/**
 * Where one material goes, grouped by the unit that spends it.
 *
 * Grouped by unit rather than listed flat because that is the question being
 * asked — the game's badge says "somebody can use this", and the answer wanted
 * is a name. Within a unit the ranks run in order, and a rank that needs the
 * material by more than one route lists each separately: they are separate
 * things to go and get.
 */
function MaterialUses({
  material,
  rankById,
}: {
  material: MaterialEntry;
  rankById: ReadonlyMap<string, number>;
}) {
  const byUnit = useMemo(() => {
    const map = new Map<string, MaterialUse[]>();
    for (const use of material.uses) {
      const list = map.get(use.unitId);
      if (list) list.push(use);
      else map.set(use.unitId, [use]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.rank - b.rank || a.chain.length - b.chain.length);
    }
    return [...map.entries()].sort(
      (a, b) => (a[1][0]?.unitName ?? '').localeCompare(b[1][0]?.unitName ?? ''),
    );
  }, [material]);

  if (byUnit.length === 0) {
    return (
      <p className="source-note muted small">
        Nothing in the current scope consumes this, directly or through a recipe. Widen the
        scope to see whether a unit you do not own, or a rank you have already passed, ever
        asks for it.
      </p>
    );
  }

  return (
    <div className="source-note">
      <table className="uses">
        <tbody>
          {byUnit.map(([unitId, uses]) => (
            <tr key={unitId}>
              <td className="use-unit">
                <Icon src={unitIcon(unitId)} size={22} className="portrait" reserve />
                <Link to={`/units/${encodeURIComponent(unitId)}`}>{uses[0]?.unitName}</Link>
              </td>
              <td>
                {uses.map((use, i) => {
                  // The rank a unit currently stands at is the one whose slots
                  // it is filling now, so that is where the material can go
                  // today rather than eventually.
                  const now = rankById.get(unitId) === use.rank;
                  return (
                    <div className={`use-line${now ? ' now' : ''}`} key={i}>
                      <Icon src={rankIcon(use.rank)} size={16} reserve />
                      <span className="use-rank">{rankName(use.rank)}</span>
                      <b>{use.amount}×</b>
                      {use.chain.length === 0 ? (
                        <span className="muted">directly</span>
                      ) : (
                        <span className="muted">
                          via {use.chain.map((link) => link.name).join(' › ')}
                        </span>
                      )}
                      {now && <span className="chip ok-chip">filling now</span>}
                    </div>
                  );
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function NextRanks({
  ranks,
  open,
  onToggle,
}: {
  ranks: NextRank[];
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  if (ranks.length === 0) {
    return <div className="empty">No owned unit has a rank left to reach.</div>;
  }
  return (
    <section className="panel">
      <p className="small muted" style={{ marginTop: 0 }}>
        Everything one more rank costs each unit, primary materials and their recipes together,
        cheapest first. Slots already filled at the current rank are marked applied — those
        materials are spent and cannot be moved, so they count as done rather than as something
        to find. Only the shortfall is expanded into a recipe: what is already in hand does not
        need making.
      </p>
      {ranks.map((rank) => (
        <div className="step-block" key={rank.unitId}>
          <button
            className="bundle-head"
            onClick={() => onToggle(`rank:${rank.unitId}`)}
            aria-expanded={open.has(`rank:${rank.unitId}`)}
          >
            <span className="chevron">{open.has(`rank:${rank.unitId}`) ? '▾' : '▸'}</span>
            <Icon src={unitIcon(rank.unitId)} size={28} className="portrait" reserve />
            <Link
              to={`/units/${encodeURIComponent(rank.unitId)}`}
              className="bundle-unit"
              onClick={(e) => e.stopPropagation()}
            >
              {rank.unitName}
            </Link>
            <span className="muted small row" style={{ gap: 6 }}>
              <Icon src={rankIcon(rank.from)} size={16} reserve />
              {rankName(rank.from)} →
              <Icon src={rankIcon(rank.to)} size={16} reserve />
              {rankName(rank.to)}
            </span>
            <span style={{ flex: 1 }} />
            <span className={`chip${rank.missing === 0 ? ' ok-chip' : ''}`}>
              {rank.missing === 0 ? 'Ready' : `${rank.missing} missing`}
            </span>
          </button>
          {open.has(`rank:${rank.unitId}`) && (
            <ul className="item-list">
              {rank.materials.map((material) => (
                <RankMaterialRow key={material.id} material={material} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

function RankMaterialRow({ material }: { material: RankMaterial }) {
  const need = material.amount - material.applied;
  const short = Math.max(0, need - material.owned);
  const covered = Math.min(need, material.owned);

  return (
    <li className={`item-row${short === 0 ? ' complete' : ''}`}>
      <div className="item-head static">
        <span className="chevron" />
        <span className="count">
          {need === 0 ? `${material.applied}×` : `${covered}/${need}`}
        </span>
        <Icon src={requirementIcon(`upgrade:${material.id}`)} size={22} className="portrait" reserve />
        <span className="item-name">
          {material.name}
          {material.rarity !== undefined && (
            <span className="muted small"> · {rarityName(material.rarity)}</span>
          )}
        </span>
        <span className="row-tail">
          {material.applied > 0 && (
            <span className="chip ok-chip">{material.applied}× already applied</span>
          )}
          {!material.farmable && short > 0 && <span className="chip gold">Forged</span>}
        </span>
      </div>
      {material.components.length > 0 && (
        <ul className="item-list nested">
          {material.components.map((component, i) => {
            const componentShort = Math.max(0, component.amount - component.owned);
            return (
              <li
                className={`item-row${componentShort === 0 ? ' complete' : ''}`}
                key={`${component.id}:${i}`}
              >
                <div className="item-head static">
                  <span className="chevron" />
                  <span className="count">
                    {Math.min(component.amount, component.owned)}/{component.amount}
                  </span>
                  <Icon
                    src={requirementIcon(`upgrade:${component.id}`)}
                    size={22}
                    className="portrait"
                    reserve
                  />
                  <span className="item-name">
                    {component.name}
                    {component.chain.length > 0 && (
                      <span className="muted small">
                        {' '}
                        · via {component.chain.map((l) => l.name).join(' › ')}
                      </span>
                    )}
                  </span>
                  <span className="row-tail">
                    {!component.farmable && componentShort > 0 && (
                      <span className="chip gold">Forged</span>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
