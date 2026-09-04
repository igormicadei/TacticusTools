import { useCallback, useEffect, useState, type ChangeEvent } from 'react';

import {
  InvalidPlayerDataError,
  PlayerFetchError,
  fetchPlayer,
  parsePlayerResponse,
  storage,
  type Credentials,
} from '../data/player.ts';

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
          e instanceof InvalidPlayerDataError ? e.message : 'Could not read that file.',
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
                · power {player.player.details.powerLevel} · {player.player.units.length} units
                {player.metaData.lastUpdatedOn
                  ? ` · game data as of ${new Date(player.metaData.lastUpdatedOn * 1000).toLocaleString()}`
                  : ''}
                {fetchedAt ? ` · fetched ${new Date(fetchedAt).toLocaleString()}` : ''}
              </span>
            </div>
            <span style={{ flex: 1 }} />
            <button className="danger" onClick={onClear}>
              Remove roster
            </button>
          </div>
        </div>
      )}

      {error && <div className="notice error">{error}</div>}

      <div className="panels">
        <section className="panel">
          <h3>API key</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Stored in this browser only, and sent with each request. Get one from the{' '}
            <a
              href="https://api.tacticusgame.com/settings"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              Tacticus API settings
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
            {relayUrl ? (
              <>
                Nothing else to set up. The API sends no CORS headers, so a page cannot
                read its reply directly — this build routes through a relay that adds
                them and forwards nothing else. It carries no key of its own and stores
                nothing: your key passes through on each request and goes straight to the
                game.
              </>
            ) : (
              <>
                This build has no relay set, so the request will go straight to the API
                and the browser will block it. That is a browser rule about pages, not a
                limit on your machine — run <code className="inline">node
                relay/local-relay.mjs</code> and rebuild with{' '}
                <code className="inline">VITE_DEFAULT_RELAY</code> pointing at it, or use
                the file import on the right.
              </>
            )}
          </p>

          <div className="row" style={{ marginTop: 16 }}>
            <button
              className="primary"
              disabled={busy || !apiKey.trim()}
              onClick={() => void refresh({ apiKey, relayUrl })}
            >
              {busy ? 'Fetching…' : player ? 'Refresh roster' : 'Fetch roster'}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                storage.clearCredentials();
                setApiKey('');
              }}
            >
              Forget key
            </button>
          </div>
        </section>

        <section className="panel">
          <h3>Import a file instead</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            No relay? Fetch the roster yourself and load the JSON here.
          </p>
          <pre className="cmd">
            curl -H &quot;X-API-KEY: YOUR_KEY&quot; \{'\n'}
            {'  '}https://api.tacticusgame.com/api/v1/player &gt; player.json
          </pre>
          <div className="row" style={{ marginTop: 12 }}>
            <label className="button">
              Choose file…
              <input
                type="file"
                accept="application/json,.json"
                onChange={onFile}
                style={{ display: 'none' }}
              />
            </label>
            <button onClick={() => setShowPaste((v) => !v)}>
              {showPaste ? 'Hide paste box' : 'Paste JSON'}
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
                Import pasted JSON
              </button>
            </>
          )}
        </section>
      </div>

      <RelaySetup />

      <p className="small muted" style={{ marginTop: 24 }}>
        Game database: version {db.sources.gameInfoVersion ?? 'unknown'} · {db.stats.units}{' '}
        units · {db.stats.items} items · {db.stats.abilities} abilities.
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
      .catch(() => setSource('Could not load the worker source.'));
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
        <h3 style={{ margin: 0 }}>Set up a hosted relay</h3>
        <span style={{ flex: 1 }} />
        <button onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Show steps'}</button>
      </div>

      {open && (
        <>
          <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              Open{' '}
              <a
                href="https://workers.cloudflare.com/playground"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                workers.cloudflare.com/playground
              </a>{' '}
              — a plain editor, no upload or build step.
            </li>
            <li>Select everything there, delete it, and paste the code below.</li>
            <li>Deploy, and name it something you will recognise.</li>
            <li>
              Open the Worker URL in a browser. A small JSON reply means it is live.
            </li>
            <li>
              In the Worker&apos;s Settings → Variables, set{' '}
              <code className="inline">ALLOWED_ORIGINS</code> to the site that will use it
              — that is what keeps other pages out. Leave{' '}
              <code className="inline">RELAY_KEY</code> unset: this app sends no relay
              key, and a key baked into a public page is readable by anyone who opens it.
            </li>
            <li>
              Rebuild the app with{' '}
              <code className="inline">VITE_DEFAULT_RELAY</code> set to the Worker URL.
              There is no field for it here — it belongs to the build, so a fresh browser
              needs only the API key.
            </li>
          </ol>

          <div className="row" style={{ marginBottom: 8 }}>
            <button className="primary" onClick={() => void copy()} disabled={!source}>
              {copied ? 'Copied' : 'Copy worker code'}
            </button>
            <a
              className="button"
              href={`${import.meta.env.BASE_URL}cloudflare-worker.js`}
              target="_blank"
              rel="noreferrer"
            >
              Open raw
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
