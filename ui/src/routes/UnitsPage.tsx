import { useMemo, useState } from 'react';

import { SearchField, SegmentedControl, Toolbar, ToolbarCounts } from '../components/Toolbar.tsx';
import { UnitCard } from '../components/UnitCard.tsx';
import { t } from '../i18n/locale.ts';
import {
  buildRoster,
  groupByFaction,
  groupByOwnership,
  summarise,
  type OwnershipStatus,
  type RosterEntry,
} from '../data/roster.ts';

import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

type GroupMode = 'ownership' | 'faction';
type StatusFilter = OwnershipStatus | 'all';

export function UnitsPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  const [mode, setMode] = useState<GroupMode>('ownership');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const entries = useMemo(() => buildRoster(player, db), [player, db]);
  const counts = useMemo(() => summarise(entries), [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || e.factionId.toLowerCase().includes(q) || e.id.toLowerCase().includes(q);
    });
  }, [entries, query, statusFilter]);

  const groups = useMemo(
    () => (mode === 'ownership' ? groupByOwnership(filtered) : groupByFaction(filtered)),
    [mode, filtered],
  );

  return (
    <>
      <Toolbar>
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ownership', label: t('units.byStatus') },
            { value: 'faction', label: t('units.byFaction') },
          ]}
        />
        <SearchField value={query} onChange={setQuery} placeholder={t('units.search')} />
        <ToolbarCounts
          activeKey={statusFilter}
          onSelect={setStatusFilter}
          items={[
            { key: 'all', value: counts.total, label: t('units.all') },
            { key: 'owned', value: counts.owned, label: t('units.available'), color: 'var(--status-owned)' },
            { key: 'unlockable', value: counts.unlockable, label: t('units.inProgress'), color: 'var(--status-unlockable)' },
            { key: 'locked', value: counts.locked, label: t('units.notStarted'), color: 'var(--status-locked)' },
          ]}
        />
      </Toolbar>

      <section className="mobile-units-toolbar" aria-label="Unit filters">
        <div className="mobile-filter-row">
          <label><span className="sr-only">Faction</span><select defaultValue="all"><option value="all">All factions</option><option value="imperial">Imperial</option><option value="chaos">Chaos</option><option value="xenos">Xenos</option></select></label>
          <label><span className="sr-only">Group</span><select value={mode} onChange={(e) => setMode(e.target.value as GroupMode)}><option value="ownership">By status</option><option value="faction">By faction</option></select></label>
        </div>
        <div className="mobile-search-row">
          <SearchField value={query} onChange={setQuery} placeholder="Search units..." />
          <button type="button" className="mobile-filter-button" aria-label="Filter units">
            <span></span><span></span><span></span>
          </button>
        </div>
        <div className="mobile-status-row">
          {[
            ['all', counts.total, t('units.all')],
            ['owned', counts.owned, t('units.available')],
            ['unlockable', counts.unlockable, t('units.inProgress')],
            ['locked', counts.locked, t('units.notStarted')],
          ].map(([key, value, label]) => (
            <button key={key} type="button" className={statusFilter === key ? 'active' : ''} onClick={() => setStatusFilter(key as StatusFilter)}>
              <b>{value}</b><span>{label}</span>
            </button>
          ))}
        </div>
      </section>

      {groups.length === 0 && <div className="empty">{t('units.noMatch', { query })}</div>}

      {groups.map((group) => (
        <section className="group" key={group.key}>
          <div className="group-head">
            <h2>{group.label}</h2>
            <span className="pill">{group.entries.length}</span>
            {mode === 'faction' && <FactionProgress entries={group.entries} />}
          </div>
          <div className="grid">{group.entries.map((entry) => <UnitCard entry={entry} db={db} key={entry.id} />)}</div>
        </section>
      ))}
    </>
  );
}

function FactionProgress({ entries }: { entries: RosterEntry[] }) {
  const owned = entries.filter((e) => e.status === 'owned').length;
  return <span className="pill" style={{ marginLeft: 'auto' }}>{t('units.factionProgress', { owned, total: entries.length })}</span>;
}
