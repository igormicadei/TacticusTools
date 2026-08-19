import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { loadGameData } from './data/gamedata.ts';
import { fetchPlayer, storage } from './data/player.ts';
import { PlayerDataPage } from './routes/PlayerDataPage.tsx';
import { UnitDetailPage } from './routes/UnitDetailPage.tsx';
import { UnitsPage } from './routes/UnitsPage.tsx';

import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

/** Refresh in the background if the stored roster is older than this. */
const STALE_AFTER_MS = 60 * 60 * 1000;

export function App() {
  const [db, setDb] = useState<GameDatabase>();
  const [player, setPlayer] = useState<PlayerResponse | undefined>(() => storage.readPlayer());
  const [fetchedAt, setFetchedAt] = useState<number | undefined>(() => storage.readFetchedAt());
  const [error, setError] = useState<string>();
  const refreshed = useRef(false);

  useEffect(() => {
    loadGameData().then(setDb, (e: unknown) => setError(String(e)));
  }, []);

  const handleLoaded = useCallback((response: PlayerResponse) => {
    storage.writePlayer(response);
    setPlayer(response);
    setFetchedAt(storage.readFetchedAt());
  }, []);

  const handleClear = useCallback(() => {
    storage.clearPlayer();
    setPlayer(undefined);
    setFetchedAt(undefined);
  }, []);

  // With a key saved, keep the roster current without the user asking. Failures
  // are silent here: the Player data page is where problems get reported.
  useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    const credentials = storage.readCredentials();
    if (!credentials.apiKey) return;
    const age = Date.now() - (storage.readFetchedAt() ?? 0);
    if (player && age < STALE_AFTER_MS) return;
    fetchPlayer(credentials).then(handleLoaded, () => undefined);
  }, [player, handleLoaded]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">TACTICUS TOOLS</span>
        <nav>
          <NavLink to="/units" className={({ isActive }) => (isActive ? 'active' : '')}>
            Units
          </NavLink>
          <NavLink to="/player" className={({ isActive }) => (isActive ? 'active' : '')}>
            Player data
          </NavLink>
        </nav>
        <span className="spacer" />
        {player && (
          <span className="small muted">
            {player.player.details.name} · power {player.player.details.powerLevel}
          </span>
        )}
      </header>

      <main className="content">
        {error && <div className="notice error">{error}</div>}
        {!db && !error && <div className="empty">Loading game database…</div>}

        {db && (
          <Routes>
            <Route path="/" element={<Navigate to="/units" replace />} />
            <Route
              path="/units"
              element={
                player ? <UnitsPage db={db} player={player} /> : <Navigate to="/player" replace />
              }
            />
            <Route
              path="/units/:unitId"
              element={
                player ? (
                  <UnitDetailPage db={db} player={player} />
                ) : (
                  <Navigate to="/player" replace />
                )
              }
            />
            <Route
              path="/player"
              element={
                <PlayerDataPage
                  db={db}
                  player={player}
                  fetchedAt={fetchedAt}
                  onLoaded={handleLoaded}
                  onClear={handleClear}
                />
              }
            />
            <Route path="*" element={<Navigate to="/units" replace />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
