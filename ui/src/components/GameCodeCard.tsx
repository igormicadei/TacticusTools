import { useState } from 'react';

import type { GameDatabase } from '@lib/gamedata/types.js';
import type { GameCode } from '@lib/types/gameCodes.js';

import { describeReward } from '../data/gameCodes.ts';
import { localDate } from '../i18n/game.ts';
import { t } from '../i18n/locale.ts';
import { Icon } from './Icon.tsx';
import { SwipeableCard } from './SwipeableCard.tsx';

/**
 * One redemption code: the code itself (tap to copy), what it pays out, when
 * it was posted, and whether the game still accepts it.
 *
 * Swipe right marks it used, swipe left dismisses it — both local-only (see
 * `codesStore` for why "report" has no server behind it) — and the same pair
 * of small buttons underneath do the same two things for a mouse, a
 * keyboard, or anyone who would rather not drag a card around.
 */
export function GameCodeCard({
  code,
  db,
  onMarkUsed,
  onDismiss,
  compact,
}: {
  code: GameCode;
  db: GameDatabase;
  onMarkUsed: () => void;
  onDismiss: () => void;
  compact?: boolean | undefined;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <SwipeableCard
      onSwipeRight={onMarkUsed}
      onSwipeLeft={onDismiss}
      rightLabel={t('codes.markUsed')}
      leftLabel={t('codes.dismiss')}
    >
      <div
        className={`card code-card${compact ? ' compact' : ''}`}
        style={{ '--status': code.isActive ? 'var(--status-owned)' : 'var(--border-strong)' } as React.CSSProperties}
      >
        <div className="code-card-head">
          <button
            type="button"
            className="code-chip"
            onClick={() => void copy()}
            title={t('codes.copyHint')}
          >
            {copied ? t('codes.copied') : code.code}
          </button>
          <span className={`chip${code.isActive ? ' ok-chip' : ''}`}>
            {code.isActive ? t('codes.enabled') : t('codes.disabled')}
          </span>
          <span className="muted small code-card-date">{localDate(code.postedDate)}</span>
        </div>

        <div className="row wrap code-card-rewards">
          {code.rewards.map((reward, i) => {
            const { label, icon } = describeReward(reward, db);
            return (
              <span className="chip" key={i}>
                {icon && <Icon src={icon} size={16} />}
                {label}
              </span>
            );
          })}
        </div>

        <div className="row code-card-actions">
          <button className="small" onClick={onMarkUsed}>
            {t('codes.markUsed')}
          </button>
          <button className="small" onClick={onDismiss}>
            {t('codes.dismiss')}
          </button>
        </div>
      </div>
    </SwipeableCard>
  );
}
