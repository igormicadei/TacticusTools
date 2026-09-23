import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Rarity } from '@lib/gamedata/enums.js';
import { computeTierStarLevel } from '@lib/gamedata/stats.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { Icon, useIcons } from '../components/Icon.tsx';
import { SearchField, SelectField, Toolbar, ToolbarCounts } from '../components/Toolbar.tsx';
import { factionIcon, rarityIcon, requirementIcon, unitIcon } from '../data/icons.ts';
import { humaniseFaction, type OwnershipStatus } from '../data/roster.ts';
import { buildShardRows, type ProgressionCost, type ShardRow } from '../data/shards.ts';
import { localNumber, localRarity } from '../i18n/game.ts';
import { t } from '../i18n/locale.ts';

type SortKey = 'closestPromotion' | 'closestAscension' | 'shardsHeld' | 'rarity' | 'name';
type StatusFilter = OwnershipStatus | 'all';

export function ShardsPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('closestPromotion');

  const rows = useMemo(() => buildShardRows(player, db), [player, db]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      owned: rows.filter((r) => r.status === 'owned').length,
      unlockable: rows.filter((r) => r.status === 'unlockable').length,
      locked: rows.filter((r) => r.status === 'locked').length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.factionId.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
      );
    });
  }, [rows, query, statusFilter]);

  const sorted = useMemo(() => {
    const byName = (a: ShardRow, b: ShardRow) => a.name.localeCompare(b.name);
    const list = [...filtered];
    switch (sort) {
      case 'shardsHeld':
        list.sort((a, b) => b.shards - a.shards || byName(a, b));
        break;
      case 'rarity':
        list.sort(
          (a, b) => (b.unit?.progressionIndex ?? -1) - (a.unit?.progressionIndex ?? -1) || byName(a, b),
        );
        break;
      case 'closestAscension':
        // Furthest along first: the smallest shortfall is the one nearest to
        // affordable. Units with no ascension left (already Mythic) carry
        // Infinity and sort to the end, since there is nothing left to answer
        // "how close" about.
        list.sort((a, b) => a.ascensionShortfall - b.ascensionShortfall || byName(a, b));
        break;
      case 'closestPromotion':
        list.sort((a, b) => a.promotionShortfall - b.promotionShortfall || byName(a, b));
        break;
      default:
        list.sort(byName);
    }
    return list;
  }, [filtered, sort]);

  return (
    <>
      <Toolbar>
        <SearchField value={query} onChange={setQuery} placeholder={t('units.search')} />
        <SelectField label={t('teams.sortBy')} value={sort} onChange={setSort}>
          <option value="closestPromotion">{t('shards.sort.closestPromotion')}</option>
          <option value="closestAscension">{t('shards.sort.closestAscension')}</option>
          <option value="shardsHeld">{t('shards.sort.shardsHeld')}</option>
          <option value="rarity">{t('shards.sort.rarity')}</option>
          <option value="name">{t('common.name')}</option>
        </SelectField>
        <ToolbarCounts
          activeKey={statusFilter}
          onSelect={setStatusFilter}
          items={[
            { key: 'all', value: counts.total, label: t('units.all') },
            { key: 'owned', value: counts.owned, label: t('units.available'), color: 'var(--status-owned)' },
            {
              key: 'unlockable',
              value: counts.unlockable,
              label: t('units.inProgress'),
              color: 'var(--status-unlockable)',
            },
            { key: 'locked', value: counts.locked, label: t('units.notStarted'), color: 'var(--status-locked)' },
          ]}
        />
      </Toolbar>

      <p className="small muted" style={{ marginTop: 0 }}>{t('shards.blurb')}</p>

      {sorted.length === 0 ? (
        <div className="empty">{t('units.noMatch', { query })}</div>
      ) : (
        <div className="table-wrap">
          <table className="steps stacked">
            <thead>
              <tr>
                <th>{t('common.unit')}</th>
                <th>{t('shards.colRarity')}</th>
                <th style={{ textAlign: 'right' }}>{t('shards.colHeld')}</th>
                <th>{t('shards.colPromotion')}</th>
                <th>{t('shards.colAscension')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <ShardTableRow key={row.id} row={row} db={db} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ShardTableRow({ row, db }: { row: ShardRow; db: GameDatabase }) {
  // A locked or partially-shard unit has not been unlocked yet, so it has no
  // rarity of its own to show — `baseRarity` is what the unit *will* start
  // at, the same descriptive field the unit detail page shows for it.
  const rarity = row.unit ? row.rarity : row.definition?.baseRarity;
  const stars = row.unit ? computeTierStarLevel(row.unit.progressionIndex, db, rarity) : undefined;

  return (
    <tr>
      <td data-label="" className="card-title-cell">
        <Link to={`/units/${encodeURIComponent(row.id)}`} className="row" style={{ gap: 8 }}>
          <Icon src={unitIcon(row.id)} size={28} className="portrait" reserve />
          <span>
            {row.name}
            <span className="muted small row" style={{ marginTop: 2 }}>
              <Icon src={factionIcon(row.factionId)} size={12} className="crest" />
              {humaniseFaction(row.factionId)}
            </span>
          </span>
        </Link>
      </td>
      <td data-label={t('shards.colRarity')}>
        {rarity !== undefined && (
          <span
            className="chip rarity"
            style={{ '--rarity': `var(--rarity-${rarity})` } as React.CSSProperties}
          >
            <Icon src={rarityIcon(rarity)} size={14} />
            {localRarity(rarity)}
          </span>
        )}
        {stars !== undefined && <div className="muted small">{t('shards.stars', { n: stars })}</div>}
      </td>
      <td data-label={t('shards.colHeld')} style={{ textAlign: 'right' }}>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
          <Icon src={requirementIcon(`shard:${row.id}`)} size={18} className="portrait" reserve />
          {localNumber(row.shards)}
        </div>
        {row.mythicShards > 0 && (
          <div className="muted small">{t('shards.mythicHeld', { n: localNumber(row.mythicShards) })}</div>
        )}
      </td>
      <MilestoneCell
        label={t('shards.colPromotion')}
        unitId={row.id}
        cost={row.nextPromotion}
        heldShards={row.shards}
        heldMythicShards={row.mythicShards}
        heldOrbs={row.nextPromotionHeldOrbs}
        alliance={row.alliance}
        owned={row.unit !== undefined}
      />
      <MilestoneCell
        label={t('shards.colAscension')}
        unitId={row.id}
        cost={row.nextAscension}
        heldShards={row.shards}
        heldMythicShards={row.mythicShards}
        heldOrbs={row.nextAscensionHeldOrbs}
        alliance={row.alliance}
        owned={row.unit !== undefined}
      />
    </tr>
  );
}

/**
 * One milestone (promotion or ascension) as a single cell — shards and orbs
 * placed side by side rather than as two separate stacked rows, so a card
 * reads as "here is what this star costs" in one glance instead of two, and
 * the two halves land in the same spot on every card since they split an
 * even `1fr 1fr` rather than sizing to their own content.
 *
 * Kept as one `<td>` (not two) for another reason too: `table.stacked`
 * treats every child of a cell as its own grid slot after the label, so a
 * cell with more than one top-level element — a shards line, a mythic-shards
 * line, a bridging note — would wrap onto extra label/value rows instead of
 * staying under the one label it belongs to. Everything here nests inside a
 * single wrapper div to stay the one child the grid expects.
 */
function MilestoneCell({
  label,
  unitId,
  cost,
  heldShards,
  heldMythicShards,
  heldOrbs,
  alliance,
  owned,
}: {
  label: string;
  unitId: string;
  cost: ProgressionCost | undefined;
  heldShards: number;
  heldMythicShards: number;
  heldOrbs: ReadonlyMap<Rarity, number>;
  alliance: string | undefined;
  /** False for a not-yet-owned unit — a missing cost then means "not
   * applicable yet", not "fully progressed". */
  owned: boolean;
}) {
  if (!cost) {
    return (
      <td data-label={label}>
        <span className="muted small">{owned ? t('shards.maxed') : '—'}</span>
      </td>
    );
  }

  const shardsReady = heldShards >= cost.shards && heldMythicShards >= cost.mythicShards;
  return (
    <td data-label={label}>
      <div>
        <div className="milestone-pair">
          <div className="milestone-col">
            <div className="milestone-col-label">{t('shards.colShards')}</div>
            {cost.shards > 0 && (
              <div className={`row ${shardsReady ? 'ok' : ''}`} style={{ gap: 4 }}>
                <Icon src={requirementIcon(`shard:${unitId}`)} size={16} className="portrait" reserve />
                {localNumber(heldShards)}/{localNumber(cost.shards)}
              </div>
            )}
            {cost.mythicShards > 0 && (
              <div className={`row ${shardsReady ? 'ok' : ''}`} style={{ gap: 4 }}>
                <Icon src={requirementIcon(`shard:${unitId}:mythic`)} size={16} className="portrait" reserve />
                {localNumber(heldMythicShards)}/{localNumber(cost.mythicShards)}
                <span className="muted small">{t('shards.mythicSuffix')}</span>
              </div>
            )}
          </div>
          <div className="milestone-col">
            <div className="milestone-col-label">{t('shards.colOrbs')}</div>
            {cost.orbs.length === 0 ? (
              <span className="muted">—</span>
            ) : (
              cost.orbs.map((o) => {
                const held = heldOrbs.get(o.rarity) ?? 0;
                return (
                  <div key={o.rarity} className={`row ${held >= o.amount ? 'ok' : ''}`} style={{ gap: 4 }}>
                    <Icon
                      src={requirementIcon(`orb:${alliance ?? 'Unknown'}:${o.rarity}`)}
                      size={16}
                      className="portrait"
                      reserve
                    />
                    {localNumber(held)}/{localNumber(o.amount)}
                    <span className="muted small">{localRarity(o.rarity)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
        {cost.bridgedAscension && <div className="muted small">{t('shards.viaAscension')}</div>}
      </div>
    </td>
  );
}
