import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import type { GameDatabase } from '@lib/gamedata/types.js';
import type { GameCode } from '@lib/types/gameCodes.js';

import { codesStore, outstandingCodes, unseenCodes } from '../data/gameCodes.ts';
import { t } from '../i18n/locale.ts';
import { GameCodeCard } from './GameCodeCard.tsx';
import { useIcons } from './Icon.tsx';

/** A plain bell glyph, drawn inline rather than pulled from Codex's game-art manifest — this is app chrome, not a game icon. */
function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3a5 5 0 0 0-5 5v3.2c0 .9-.32 1.77-.9 2.46L4.7 15.3a1 1 0 0 0 .76 1.65h13.08a1 1 0 0 0 .76-1.65l-1.4-1.64a3.8 3.8 0 0 1-.9-2.46V8a5 5 0 0 0-5-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The bell beside the refresh button: a running count of active codes the
 * player has not been shown yet, and — opened — the same cards the Codes
 * page shows, scoped to only what still needs acting on.
 *
 * Opening it is what clears its own badge (see {@link codesStore.markAllSeen}):
 * the badge counts unseen codes, not unread messages, so it resets the moment
 * they have been seen rather than waiting on each one to be swiped away.
 */
export function CodesBell({ db, codes }: { db: GameDatabase; codes: GameCode[] | undefined }) {
  useIcons();
  const [open, setOpen] = useState(false);
  const [, forceRerender] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const list = codes ?? [];
  const outstanding = outstandingCodes(list);
  const unseen = unseenCodes(list);

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const toggle = () => {
    const next = !open;
    if (next) codesStore.markAllSeen(outstanding.map((c) => c.id));
    setOpen(next);
  };

  const act = (run: () => void) => {
    run();
    forceRerender((n) => n + 1);
  };

  return (
    <>
      <div className="bell-wrap" ref={wrapRef}>
        <button
          type="button"
          className="bell-button"
          onClick={toggle}
          aria-label={t('codes.bellHint')}
          title={t('codes.bellHint')}
        >
          <BellIcon />
          {unseen.length > 0 && <span className="bell-badge">{unseen.length > 9 ? '9+' : unseen.length}</span>}
        </button>
      </div>
      {/* A sibling of the bell rather than nested inside it, and positioned
          off `.topbar` (already the nearest `position` ancestor) instead of
          off the bell button itself — the button sits at the topbar's left
          edge on a phone and its right edge on a wide screen, and a panel
          anchored to it would run off whichever side is closer. Anchored to
          the topbar's own edge instead, it is inside the viewport at both. */}
      {open && (
        <div className="bell-panel" ref={panelRef}>
          <div className="row">
            <strong className="small">{t('codes.activeCodes')}</strong>
            <span style={{ flex: 1 }} />
            <Link className="chip" to="/codes" onClick={() => setOpen(false)}>
              {t('codes.viewAll')}
            </Link>
          </div>
          {outstanding.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              {t('codes.bellEmpty')}
            </p>
          ) : (
            <div className="code-list compact">
              {outstanding.map((code) => (
                <GameCodeCard
                  key={code.id}
                  code={code}
                  db={db}
                  compact
                  onMarkUsed={() => act(() => codesStore.markUsed(code.id))}
                  onDismiss={() => act(() => codesStore.markDismissed(code.id))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
