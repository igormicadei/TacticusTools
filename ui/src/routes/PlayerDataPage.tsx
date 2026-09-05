import { useCallback, useEffect, useState, type ChangeEvent } from 'react';

import {
  InvalidPlayerDataError,
  PlayerFetchError,
  fetchPlayer,
  parsePlayerResponse,
  storage,
  type Credentials,
} from '../data/player.ts';

import { localDateTime } from '../i18n/game.ts';
import { setLang, t, useLang } from '../i18n/locale.ts';

import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

export function PlayerDataPage({
  db,
  player,
  fetchedAt,
  onLoaded,
  onClear,
}: {
  db: GameDatabase;
  player: PlayerResponse | undefined;
  fetchedAt: number | undefined;
  onLoaded: (response: PlayerResponse) => void;
  onClear: () => void;
}) {
  const lang = useLang();
  const stored = storage.readCredentials();
  const [apiKey, setApiKey] = useState(stored.apiKey ?? '');
  // Read, never written here: the relay comes from the build. Kept in state so
  // the copy below can say which of the two situations the reader is in.
  const [relayUrl] = useState(stored.relayUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [text, setText] = useState('');
  const [showPaste, setShowPaste] = useState(false);

  const refresh = useCallback(
    async (credentials: Credentials) => {
      setBusy(true);
      setError(undefined);
      try {
        storage.writeCredentials(credentials);
        onLoaded(await fetchPlayer(credentials));
      } catch (e) {
        setError(e instanceof PlayerFetchError ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onLoaded],
  );

  const importText = useCallback(
    (raw: string) => {
      try {
        onLoaded(parsePlayerResponse(raw));
        setError(undefined);
        setText('');
      } catch (e) {
        setError(
          e instanceof InvalidPlayerDataError ? e.message : t('pd.fileUnreadable'),
        );
      }
    },
    [onLoaded],
  );

  const onFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void file.text().then(importText);
    },
    [importText],
  );

  return (
    <>
      {player && (
        <div className="notice">
          <div className="row">
            <div>
              <strong>{player.player.details.name}</strong>{' '}
              <span className="muted small">
                {t('pd.rosterSummary', {
                  power: player.player.details.powerLevel,
                  units: player.player.units.length,
                })}
                {player.metaData.lastUpdatedOn
                  ? t('pd.gameDataAsOf', {
                      when: localDateTime(player.metaData.lastUpdatedOn * 1000),
                    })
                  : ''}
                {fetchedAt ? t('pd.fetchedAt', { when: localDateTime(fetchedAt) }) : ''}
              </span>
            </div>
            <span style={{ flex: 1 }} />
            <button className="danger" onClick={onClear}>
              {t('pd.removeRoster')}
            </button>
          </div>
        </div>
      )}

      {error && <div className="notice error">{error}</div>}

      <div className="panels">
        <section className="panel">
          <h3>{t('lang.heading')}</h3>
          <div className="tabs" style={{ marginBottom: 8 }}>
            <button className={lang === 'pt' ? 'active' : ''} onClick={() => setLang('pt')}>
              {t('lang.pt')}
            </button>
            <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>
              {t('lang.en')}
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {t('lang.blurb')}
          </p>

          <h3 style={{ marginTop: 20 }}>{t('pd.apiKey')}</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            {t('pd.apiKeyBlurb')}
            <a
              href="https://api.tacticusgame.com/settings"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              {t('pd.apiKeySettings')}
            </a>
            .
          </p>
          <input
            className="search"
            style={{ width: '100%' }}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />

          <p className="small muted">
            {relayUrl ? t('pd.relayBuiltIn') : t('pd.noRelay')}
          </p>

          <div className="row" style={{ marginTop: 16 }}>
            <button
              className="primary"
              disabled={busy || !apiKey.trim()}
              onClick={() => void refresh({ apiKey, relayUrl })}
            >
              {busy
                ? t('pd.fetching')
                : player
                  ? t('pd.refreshRoster')
                  : t('pd.fetchRoster')}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                storage.clearCredentials();
                setApiKey('');
              }}
            >
              {t('pd.forgetKey')}
            </button>
          </div>
        </section>

        <section className="panel">
          <h3>{t('pd.importInstead')}</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            {t('pd.importBlurb')}
          </p>
          <pre className="cmd">
            curl -H &quot;X-API-KEY: YOUR_KEY&quot; \{'\n'}
            {'  '}https://api.tacticusgame.com/api/v1/player &gt; player.json
          </pre>
          <div className="row" style={{ marginTop: 12 }}>
            <label className="button">
              {t('pd.chooseFile')}
              <input
                type="file"
                accept="application/json,.json"
                onChange={onFile}
                style={{ display: 'none' }}
              />
            </label>
            <button onClick={() => setShowPaste((v) => !v)}>
              {showPaste ? t('pd.hidePaste') : t('pd.pasteJson')}
            </button>
          </div>
          {showPaste && (
            <>
              <textarea
                style={{ marginTop: 12 }}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder='{"player": …'
              />
              <button
                className="primary"
                style={{ marginTop: 8 }}
                disabled={!text.trim()}
                onClick={() => importText(text)}
              >
                {t('pd.importPasted')}
              </button>
            </>
          )}
        </section>
      </div>

      <RelaySetup />

      <p className="small muted" style={{ marginTop: 24 }}>
        {t('pd.dbFooter', {
          version: db.sources.gameInfoVersion ?? t('shell.unknown'),
          units: db.stats.units,
          items: db.stats.items,
          abilities: db.stats.abilities,
        })}
      </p>
    </>
  );
}

/**
 * The worker source, with a copy button.
 *
 * Deploying the relay means pasting this into a Worker editor; on a phone,
 * selecting it by hand is the worst part of the process.
 */
function RelaySetup() {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || source !== undefined) return;
    fetch(`${import.meta.env.BASE_URL}cloudflare-worker.js`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setSource)
      .catch(() => setSource(t('pd.sourceFailed')));
  }, [open, source]);

  const copy = useCallback(async () => {
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [source]);

  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>{t('pd.setUpRelay')}</h3>
        <span style={{ flex: 1 }} />
        <button onClick={() => setOpen((v) => !v)}>{open ? t('pd.hide') : t('pd.showSteps')}</button>
      </div>

      {open && (
        <>
          <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              {t('pd.step1a')}
              <a
                href="https://workers.cloudflare.com/playground"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                workers.cloudflare.com/playground
              </a>{' '}
              {t('pd.step1b')}
            </li>
            <li>{t('pd.step2')}</li>
            <li>{t('pd.step3')}</li>
            <li>{t('pd.step4')}</li>
            <li>{t('pd.step5')}</li>
            <li>{t('pd.step6')}</li>
          </ol>

          <div className="row" style={{ marginBottom: 8 }}>
            <button className="primary" onClick={() => void copy()} disabled={!source}>
              {copied ? t('pd.copied') : t('pd.copy')}
            </button>
            <a
              className="button"
              href={`${import.meta.env.BASE_URL}cloudflare-worker.js`}
              target="_blank"
              rel="noreferrer"
            >
              {t('pd.openRaw')}
            </a>
          </div>
          <pre className="cmd" style={{ maxHeight: 260 }}>
            {source ?? 'Loading…'}
          </pre>
        </>
      )}
    </section>
  );
}
