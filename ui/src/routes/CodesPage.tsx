import { useMemo, useState } from 'react';

import type { GameDatabase } from '@lib/gamedata/types.js';
import type { GameCode } from '@lib/types/gameCodes.js';

import { GameCodeCard } from '../components/GameCodeCard.tsx';
import { useIcons } from '../components/Icon.tsx';
import { SwitchField, Toolbar, ToolbarCounts } from '../components/Toolbar.tsx';
import { codesStore, outstandingCodes } from '../data/gameCodes.ts';
import { t } from '../i18n/locale.ts';

const HIDE_KEY = 'tacticus-tools:codes-hideHandled';

/**
 * Every redemption code Tacticus Codex has ever posted, newest first.
 *
 * Unlike the notification bell (always just the outstanding ones), this page
 * can show the whole history — "hide handled" defaults on, but turning it off
 * is how a past code's rewards or its now-disabled status gets looked up
 * again.
 */
export function CodesPage({
  db,
  codes,
}: {
  db: GameDatabase;
  codes: GameCode[] | undefined;
}) {
  useIcons();
  const [hideHandled, setHideHandled] = useState(() => localStorage.getItem(HIDE_KEY) !== '0');
  // Bumped after every swipe/click so `codesStore.action()` is re-read — the
  // store itself has no subscribers, this is what stands in for one.
  const [, forceRerender] = useState(0);

  const toggleHide = (checked: boolean) => {
    setHideHandled(checked);
    try {
      localStorage.setItem(HIDE_KEY, checked ? '1' : '0');
    } catch {
      /* Private mode, or storage disabled — the choice still holds for this render. */
    }
  };

  const sorted = useMemo(
    () => [...(codes ?? [])].sort((a, b) => b.postedDate.localeCompare(a.postedDate)),
    [codes],
  );
  const visible = hideHandled ? sorted.filter((c) => !codesStore.action(c.id)) : sorted;
  const outstanding = useMemo(() => outstandingCodes(codes ?? []), [codes]);

  const act = (run: () => void) => {
    run();
    forceRerender((n) => n + 1);
  };

  if (codes === undefined) {
    return <div className="empty">{t('codes.loading')}</div>;
  }

  return (
    <>
      <Toolbar>
        <h2 style={{ margin: 0, fontSize: 18 }}>{t('codes.heading')}</h2>
        <SwitchField checked={hideHandled} onChange={toggleHide} label={t('codes.hideHandled')} />
        <ToolbarCounts items={[{ value: outstanding.length, label: t('codes.outstanding') }]} />
      </Toolbar>

      <p className="small muted" style={{ marginTop: 0 }}>
        {t('codes.blurb')}
      </p>

      {visible.length === 0 ? (
        <div className="empty">{t(sorted.length === 0 ? 'codes.none' : 'codes.allHandled')}</div>
      ) : (
        <div className="code-list">
          {visible.map((code) => (
            <GameCodeCard
              key={code.id}
              code={code}
              db={db}
              onMarkUsed={() => act(() => codesStore.markUsed(code.id))}
              onDismiss={() => act(() => codesStore.markDismissed(code.id))}
            />
          ))}
        </div>
      )}
    </>
  );
}
