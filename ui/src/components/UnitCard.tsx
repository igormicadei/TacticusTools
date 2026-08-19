import { Link } from 'react-router-dom';

import { humaniseFaction, rarityLabel, type RosterEntry } from '../data/roster.ts';

const STATUS_COLOR: Record<RosterEntry['status'], string> = {
  owned: 'var(--status-owned)',
  unlockable: 'var(--status-unlockable)',
  locked: 'var(--status-locked)',
};

function Stars({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span className="stars">{'★'.repeat(Math.min(count, 14))}</span>;
}

export function UnitCard({ entry }: { entry: RosterEntry }) {
  const { unit, definition } = entry;
  const style = {
    '--status': STATUS_COLOR[entry.status],
    '--rarity': `var(--rarity-${entry.rarity ?? 0})`,
  } as React.CSSProperties;

  return (
    <Link
      to={`/units/${encodeURIComponent(entry.id)}`}
      className={`card ${entry.status}`}
      style={style}
    >
      <div className="name">{entry.name}</div>
      <div className="sub">
        {humaniseFaction(definition?.factionId ?? entry.factionId)}
        {definition?.isMachineOfWar ? ' · Machine of War' : ''}
      </div>

      <div className="meta">
        {unit ? (
          <>
            <span className="chip">Lv {unit.xpLevel}</span>
            <span className="chip">Rank {unit.rank}</span>
            {entry.rarity !== undefined && (
              <span className="chip rarity">{rarityLabel(entry.rarity)}</span>
            )}
          </>
        ) : entry.status === 'unlockable' ? (
          <span className="chip">{entry.shards} shards</span>
        ) : (
          <span className="chip">Locked</span>
        )}
      </div>

      {entry.starLevel !== undefined && entry.starLevel > 0 && (
        <div style={{ marginTop: 6 }}>
          <Stars count={entry.starLevel} />
        </div>
      )}
    </Link>
  );
}
