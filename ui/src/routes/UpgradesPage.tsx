import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';


import { levelToCompleteRank } from '@lib/gamedata/plan.js';
import {
  materialCatalogue,
  nextRankCosts,
  UpgradeAvailability,
  type AvailableUse,
  type MaterialEntry,
  type NextRank,
  type RankMaterial,
} from '@lib/gamedata/materials.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { Icon, useIcons } from '../components/Icon.tsx';
import { localRank, localRarity, localStat } from '../i18n/game.ts';
import { t, tn, type StringKey } from '../i18n/locale.ts';
import { rankIcon, requirementIcon, unitIcon } from '../data/icons.ts';

type View = 'inventory' | 'ranks';
type Filter = 'stock' | 'all' | 'unused';
type Scope = 'now' | 'ahead' | 'roster' | 'everyone';

const FILTERS: { key: Filter; label: StringKey; hint: StringKey }[] = [
  { key: 'stock', label: 'upg.filter.stock', hint: 'upg.filter.stockHint' },
  { key: 'all', label: 'upg.filter.all', hint: 'upg.filter.allHint' },
  { key: 'unused', label: 'upg.filter.unused', hint: 'upg.filter.unusedHint' },
];

/**
 * Whose ranks count as a use.
 *
 * The unfiltered answer is true and useless: 112 of the game's 128 units spend
 * a Fine Micro-Generator somewhere, most of them at ranks a given player will
 * never reach with units they do not own. What a player can act on is their own
 * roster, and within it the ranks still ahead — a rank already passed spent its
 * materials long ago.
 *
 * Narrower still, and the default, is what goes in *today*: a unit standing at
 * that rank with that slot still empty. Everything else is a plan; this is a
 * thing to go and do.
 */
const SCOPES: { key: Scope; label: StringKey; hint: StringKey }[] = [
  { key: 'now', label: 'upg.scope.now', hint: 'upg.scope.nowHint' },
  { key: 'ahead', label: 'upg.scope.ahead', hint: 'upg.scope.aheadHint' },
  { key: 'roster', label: 'upg.scope.roster', hint: 'upg.scope.rosterHint' },
  { key: 'everyone', label: 'upg.scope.everyone', hint: 'upg.scope.everyoneHint' },
];

export function UpgradesPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const [view, setView] = useState<View>('inventory');
  const [filter, setFilter] = useState<Filter>('stock');
  const [scope, setScope] = useState<Scope>('now');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  // One walk of every rank table in the game, so it is done once per roster
  // rather than once per row opened.
  const catalogue = useMemo(() => materialCatalogue(player, db), [player, db]);
  const ranks = useMemo(() => nextRankCosts(player, db), [player, db]);

  // One pass over the roster, reused for every row: the page asks "can I use
  // this today?" tens of thousands of times.
  const availability = useMemo(
    () => new UpgradeAvailability(player, levelToCompleteRank),
    [player],
  );

  /**
   * The catalogue with every use annotated and narrowed to the chosen scope.
   *
   * `openNow` is kept whatever the scope, because it is what the collapsed row
   * has to say — a material with a slot waiting for it is the one thing on this
   * page worth acting on, and hiding that behind a scope change would bury it.
   */
  const scoped = useMemo(
    () =>
      catalogue.map((material) => {
        const annotated = availability.annotateAll(material.uses);
        const openNow = annotated.filter((u) => u.status === 'now');
        const uses =
          scope === 'everyone'
            ? annotated
            : scope === 'now'
              ? openNow
              : annotated.filter((u) =>
                  scope === 'roster'
                    ? u.status !== 'unowned'
                    : u.status === 'now' || u.status === 'later',
                );
        return {
          ...material,
          uses,
          openNow,
          unitCount: new Set(uses.map((u) => u.unitId)).size,
        };
      }),
    [catalogue, scope, availability],
  );

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
      // Held and spendable today sorts above held-but-not-yet, which sorts above
      // everything else: the order answers "what can I do with what I have?"
      .sort(
        (a, b) =>
          Number(b.openNow.length > 0 && b.owned > 0) -
            Number(a.openNow.length > 0 && a.owned > 0) ||
          b.openNow.length - a.openNow.length ||
          b.owned - a.owned ||
          a.name.localeCompare(b.name),
      );
  }, [scoped, filter, query]);

  const held = catalogue.filter((m) => m.owned > 0).length;
  const spendable = scoped.filter((m) => m.owned > 0 && m.openNow.length > 0).length;

  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          <button className={view === 'inventory' ? 'active' : ''} onClick={() => setView('inventory')}>
            {t('upg.tab.where')}
          </button>
          <button className={view === 'ranks' ? 'active' : ''} onClick={() => setView('ranks')}>
            {t('upg.tab.nextRank')}
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
                  title={t(f.hint)}
                >
                  {t(f.label)}
                </button>
              ))}
            </div>
            <div className="tabs">
              {SCOPES.map((sc) => (
                <button
                  key={sc.key}
                  className={scope === sc.key ? 'active' : ''}
                  onClick={() => setScope(sc.key)}
                  title={t(sc.hint)}
                >
                  {t(sc.label)}
                </button>
              ))}
            </div>
            <input
              className="search"
              placeholder={t('upg.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="counts small muted">
              <span className="count">
                <b>{spendable}</b> {t('upg.count.spendable')}
              </span>
              <span className="count">
                <b>{held}</b> {t('upg.count.stock')}
              </span>
              <span className="count">
                <b>{catalogue.length}</b> {t('upg.count.known')}
              </span>
            </div>
          </>
        )}
      </div>

      {view === 'inventory' ? (
        <section className="panel">
          <p className="small muted" style={{ marginTop: 0 }}>
            {t('upg.blurb')}
          </p>
          {rows.length === 0 ? (
            <div className="empty">{t('upg.noMatch', { query })}</div>
          ) : (
            <ul className="item-list" style={{ paddingLeft: 0 }}>
              {rows.map((material) => (
                <MaterialRow
                  key={material.id}
                  material={material}
                  openNow={material.openNow.length}
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
  openNow,
  expanded,
  onToggle,
}: {
  material: MaterialEntry & { uses: AvailableUse[] };
  openNow: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Held, and somewhere to put it today. Everything else on this page is
  // planning; this row is a thing to go and do, so it is marked as one.
  const spendable = openNow > 0 && material.owned > 0;
  return (
    <li className={`item-row${spendable ? ' actionable' : ''}`}>
      <button className="item-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
        <span className="count">{material.owned > 0 ? `${material.owned}×` : '—'}</span>
        <Icon src={requirementIcon(`upgrade:${material.id}`)} size={22} className="portrait" reserve />
        <span className="item-name">
          {material.name}
          {material.rarity !== undefined && (
            <span className="muted small"> · {localRarity(material.rarity)}</span>
          )}
        </span>
        <span className="row-tail">
          {openNow > 0 && (
            <span
              className={`chip ${spendable ? 'ok-chip' : ''}`}
              title={t(spendable ? 'upg.slotsOpenHint' : 'upg.slotsOpenNoneHeld')}
            >
              {tn(openNow, 'upg.slotsOpen', 'upg.slotsOpenPlural')}
            </span>
          )}
          {!material.farmable && (
            <span className="chip gold" title={t('upg.forgedHint')}>
              {t('upg.forged')}
            </span>
          )}
          <span className="muted small">
            {material.uses.length === 0
              ? t('upg.nothingNeeds')
              : tn(material.unitCount, 'upg.unitCount', 'upg.unitCountPlural')}
          </span>
        </span>
      </button>
      {expanded && <MaterialUses material={material} />}
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
function MaterialUses({ material }: { material: MaterialEntry & { uses: AvailableUse[] } }) {
  const byUnit = useMemo(() => {
    const map = new Map<string, AvailableUse[]>();
    for (const use of material.uses) {
      const list = map.get(use.unitId);
      if (list) list.push(use);
      else map.set(use.unitId, [use]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.rank - b.rank || a.slotIndex - b.slotIndex);
    }
    // Units with a slot open today first, so the answer to "where does this go
    // right now" is at the top rather than alphabetically buried.
    return [...map.entries()].sort(
      (a, b) =>
        Number(b[1].some((u) => u.status === 'now')) -
          Number(a[1].some((u) => u.status === 'now')) ||
        (a[1][0]?.unitName ?? '').localeCompare(b[1][0]?.unitName ?? ''),
    );
  }, [material]);

  if (byUnit.length === 0) {
    return (
      <p className="source-note muted small">{t('upg.noUses')}</p>
    );
  }

  return (
    <div className="source-note">
      <table className="uses">
        <tbody>
          {byUnit.map(([unitId, uses]) => (
            <tr key={unitId} className={uses.some((u) => u.status === 'now') ? 'now-unit' : ''}>
              <td className="use-unit">
                <Icon src={unitIcon(unitId)} size={22} className="portrait" reserve />
                <Link to={`/units/${encodeURIComponent(unitId)}`}>{uses[0]?.unitName}</Link>
              </td>
              <td>
                {uses.map((use, i) => (
                  <UseLine key={`${use.rank}:${use.slotIndex}:${i}`} use={use} />
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One place the material goes, and whether it goes there today.
 *
 * The status is the point of the line, so it leads with a chip rather than
 * ending with one; a rank still ahead is dimmed rather than hidden, because
 * knowing a material is worth keeping is the second most useful thing this page
 * can say.
 */
function UseLine({ use }: { use: AvailableUse }) {
  const gain =
    use.statIncrease !== undefined && use.statType !== undefined
      ? t('upg.gain', { n: use.statIncrease, stat: localStat(use.statType) })
      : undefined;

  return (
    <div className={`use-line status-${use.status}`}>
      <Icon src={rankIcon(use.rank)} size={16} reserve />
      <span className="use-rank">{localRank(use.rank)}</span>
      <b>{use.amount}×</b>
      {use.status === 'now' && <span className="chip ok-chip">{t('upg.fitsNow')}</span>}
      {use.status === 'applied' && <span className="chip">{t('upg.alreadyFitted')}</span>}
      {use.status === 'passed' && <span className="chip">{t('upg.rankPassed')}</span>}
      {gain !== undefined && <span className="use-gain">{gain}</span>}
      {use.chain.length === 0 ? (
        <span className="muted">{t('upg.directly')}</span>
      ) : (
        <span className="muted">
          {t('upg.via', { chain: use.chain.map((link) => link.name).join(' › ') })}
        </span>
      )}
      {use.levelGated && use.levelToComplete !== undefined && (
        <span
          className="muted small"
          title={t('upg.levelHint')}
        >
          {t('upg.needsLevel', { n: use.levelToComplete })}
        </span>
      )}
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
    return <div className="empty">{t('upg.noRanksLeft')}</div>;
  }
  return (
    <section className="panel">
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('upg.nextRankBlurb')}
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
              {localRank(rank.from)} →
              <Icon src={rankIcon(rank.to)} size={16} reserve />
              {localRank(rank.to)}
            </span>
            <span style={{ flex: 1 }} />
            <span className={`chip${rank.missing === 0 ? ' ok-chip' : ''}`}>
              {rank.missing === 0 ? t('upg.ready') : t('upg.missing', { n: rank.missing })}
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
            <span className="muted small"> · {localRarity(material.rarity)}</span>
          )}
        </span>
        <span className="row-tail">
          {material.applied > 0 && (
            <span className="chip ok-chip">
              {t('upg.appliedCount', { n: material.applied })}
            </span>
          )}
          {!material.farmable && short > 0 && (
            <span className="chip gold">{t('upg.forged')}</span>
          )}
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
                        · {t('upg.via', { chain: component.chain.map((l) => l.name).join(' › ') })}
                      </span>
                    )}
                  </span>
                  <span className="row-tail">
                    {!component.farmable && componentShort > 0 && (
                      <span className="chip gold">{t('upg.forged')}</span>
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
