import { useCallback, useState, type ChangeEvent } from 'react';

import {
  InvalidPlayerDataError,
  parsePlayerResponse,
} from '../data/player.ts';

import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

/**
 * Player data is imported by hand rather than fetched.
 *
 * The Tacticus API answers a browser preflight with `403 Invalid CORS request`
 * and sends no `access-control-allow-origin`, so a static page cannot read a
 * roster no matter where it is hosted. The user fetches it once themselves and
 * pastes or drops the result here.
 */
export function ImportPage({
  db,
  player,
  onImport,
  onClear,
}: {
  db: GameDatabase;
  player: PlayerResponse | undefined;
  onImport: (response: PlayerResponse) => void;
  onClear: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();

  const submit = useCallback(
    (raw: string) => {
      try {
        onImport(parsePlayerResponse(raw));
        setError(undefined);
        setText('');
      } catch (e) {
        setError(
          e instanceof InvalidPlayerDataError ? e.message : 'Could not read that file.',
        );
      }
    },
    [onImport],
  );

  const onFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void file.text().then(submit);
    },
    [submit],
  );

  return (
    <>
      {player && (
        <div className="notice">
          <div className="row">
            <div>
              <strong>{player.player.details.name}</strong>{' '}
              <span className="muted small">
                · power {player.player.details.powerLevel} · {player.player.units.length}{' '}
                units · updated{' '}
                {new Date(player.metaData.lastUpdatedOn * 1000).toLocaleString()}
              </span>
            </div>
            <span className="spacer" style={{ flex: 1 }} />
            <button className="danger" onClick={onClear}>
              Remove
            </button>
          </div>
        </div>
      )}

      <div className="panels">
        <section className="panel">
          <h3>1 · Fetch your roster</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            The game API sends no CORS headers, so this page cannot call it for you. Run
            this once with your own API key:
          </p>
          <pre className="cmd">
            curl -H &quot;X-API-KEY: YOUR_KEY&quot; \{'\n'}
            {'  '}https://api.tacticusgame.com/api/v1/player &gt; player.json
          </pre>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Get a key from the{' '}
            <a
              href="https://api.tacticusgame.com/settings"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              Tacticus API settings
            </a>
            . Your key is never entered here and never leaves your machine — only the
            resulting roster is stored, in this browser&apos;s local storage.
          </p>
        </section>

        <section className="panel">
          <h3>2 · Import it</h3>
          {error && <div className="notice error">{error}</div>}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Paste the JSON response here, starting with {"player":…'
          />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={!text.trim()} onClick={() => submit(text)}>
              Import pasted JSON
            </button>
            <label className="button">
              Choose file…
              <input
                type="file"
                accept="application/json,.json"
                onChange={onFile}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </section>
      </div>

      <p className="small muted" style={{ marginTop: 24 }}>
        Game database: version {db.sources.gameInfoVersion ?? 'unknown'} · {db.stats.units}{' '}
        units · {db.stats.items} items · {db.stats.abilities} abilities.
      </p>
    </>
  );
}
