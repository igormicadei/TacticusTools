import { Link } from 'react-router-dom';

import { factionIcon, rankIcon, starIcon, unitIcon } from '../data/icons.ts';
import { humaniseFaction, type RosterEntry } from '../data/roster.ts';
import { localRarity } from '../i18n/game.ts';
import { t } from '../i18n/locale.ts';
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
            {definition?.isMachineOfWar ? ` · ${t('card.machineOfWar')}` : ''}
          </div>
        </div>
      </div>

      <div className="meta">
        {unit ? (
          <>
            <span className="chip">{t('card.level', { n: unit.xpLevel })}</span>
            <span className="chip with-icon">
              <Icon src={rankIcon(unit.rank)} size={14} />
              {t('card.rank', { n: unit.rank })}
            </span>
            {entry.rarity !== undefined && (
              <span className="chip rarity">{localRarity(entry.rarity)}</span>
            )}
          </>
        ) : entry.status === 'unlockable' ? (
          <span className="chip">{t('card.shards', { n: entry.shards })}</span>
        ) : (
          <span className="chip">{t('card.locked')}</span>
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
