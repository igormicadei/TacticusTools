import { Link } from 'react-router-dom';

import { factionIcon, rankIcon, starIcon, unitIcon } from '../data/icons.ts';
import { humaniseFaction, rarityLabel, type RosterEntry } from '../data/roster.ts';
import { Icon, useIcons } from './Icon.tsx';

const STATUS_COLOR: Record<RosterEntry['status'], string> = {
  owned: 'var(--status-owned)',
  unlockable: 'var(--status-unlockable)',
  locked: 'var(--status-locked)',
};

function Stars({ count }: { count: number }) {
  if (count <= 0) return null;
  const star = starIcon();
  // The pip art repeats like the glyph it replaces; without it the glyph is
  // still perfectly readable, so there is nothing to fall back to but itself.
  return (
    <span className="stars">
      {Array.from({ length: Math.min(count, 14) }, (_, i) =>
        star ? <Icon key={i} src={star} size={13} /> : <span key={i}>★</span>,
      )}
    </span>
  );
}

export function UnitCard({ entry }: { entry: RosterEntry }) {
  useIcons();
  const { unit, definition } = entry;
  const factionId = definition?.factionId ?? entry.factionId;
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
      <div className="card-head">
        <Icon src={unitIcon(entry.id)} alt="" size={44} className="portrait" />
        <div className="card-title">
          <div className="name">{entry.name}</div>
          <div className="sub">
            <Icon src={factionIcon(factionId)} size={13} className="crest" />
            {humaniseFaction(factionId)}
            {definition?.isMachineOfWar ? ' · Machine of War' : ''}
          </div>
        </div>
      </div>

      <div className="meta">
        {unit ? (
          <>
            <span className="chip">Lv {unit.xpLevel}</span>
            <span className="chip with-icon">
              <Icon src={rankIcon(unit.rank)} size={14} />
              Rank {unit.rank}
            </span>
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
