import { useMemo, useState } from 'react';

import { UnitCard } from '../components/UnitCard.tsx';
import { t } from '../i18n/locale.ts';
import {
  buildRoster,
  groupByFaction,
  groupByOwnership,
  summarise,
  type RosterEntry,
} from '../data/roster.ts';

import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

type GroupMode = 'ownership' | 'faction';

export function UnitsPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  const [mode, setMode] = useState<GroupMode>('ownership');
  const [query, setQuery] = useState('');

  const entries = useMemo(() => buildRoster(player, db), [player, db]);
  const counts = useMemo(() => summarise(entries), [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.factionId.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const groups = useMemo(
    () => (mode === 'ownership' ? groupByOwnership(filtered) : groupByFaction(filtered)),
    [mode, filtered],
  );

  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          <button
            className={mode === 'ownership' ? 'active' : ''}
            onClick={() => setMode('ownership')}
          >
            {t('units.byStatus')}
          </button>
          <button
            className={mode === 'faction' ? 'active' : ''}
            onClick={() => setMode('faction')}
          >
            {t('units.byFaction')}
          </button>
        </div>

        <input
          className="search"
          placeholder={t('units.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="counts small muted">
          <span className="count">
            <b style={{ color: 'var(--status-owned)' }}>{counts.owned}</b>{' '}
            {t('units.available')}
          </span>
          <span className="count">
            <b style={{ color: 'var(--status-unlockable)' }}>{counts.unlockable}</b>{' '}
            {t('units.inProgress')}
          </span>
          <span className="count">
            <b>{counts.locked}</b> {t('units.notStarted')}
          </span>
        </div>
      </div>

      {groups.length === 0 && (
        <div className="empty">{t('units.noMatch', { query })}</div>
      )}

      {groups.map((group) => (
        <section className="group" key={group.key}>
          <div className="group-head">
            <h2>{group.label}</h2>
            <span className="pill">{group.entries.length}</span>
            {mode === 'faction' && <FactionProgress entries={group.entries} />}
          </div>
          <div className="grid">
            {group.entries.map((entry) => (
              <UnitCard entry={entry} key={entry.id} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function FactionProgress({ entries }: { entries: RosterEntry[] }) {
  const owned = entries.filter((e) => e.status === 'owned').length;
  return (
    <span className="pill" style={{ marginLeft: 'auto' }}>
      {t('units.factionProgress', { owned, total: entries.length })}
    </span>
  );
}
