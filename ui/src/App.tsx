import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { loadGameData } from './data/gamedata.ts';
import { localPlayerSource } from './data/player.ts';
import { ImportPage } from './routes/ImportPage.tsx';
import { UnitDetailPage } from './routes/UnitDetailPage.tsx';
import { UnitsPage } from './routes/UnitsPage.tsx';

import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

export interface AppData {
  db: GameDatabase;
  player: PlayerResponse;
}

export function App() {
  const [db, setDb] = useState<GameDatabase>();
  const [player, setPlayer] = useState<PlayerResponse | undefined>(() =>
    localPlayerSource.read(),
  );
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadGameData().then(setDb, (e: unknown) => setError(String(e)));
  }, []);

  const handleImport = useCallback((response: PlayerResponse) => {
    localPlayerSource.write(response);
    setPlayer(response);
  }, []);

  const handleClear = useCallback(() => {
    localPlayerSource.clear();
    setPlayer(undefined);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">TACTICUS TOOLS</span>
        <nav>
          <NavLink to="/units" className={({ isActive }) => (isActive ? 'active' : '')}>
            Units
          </NavLink>
          <NavLink to="/import" className={({ isActive }) => (isActive ? 'active' : '')}>
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
                player ? (
                  <UnitsPage db={db} player={player} />
                ) : (
                  <Navigate to="/import" replace />
                )
              }
            />
            <Route
              path="/units/:unitId"
              element={
                player ? (
                  <UnitDetailPage db={db} player={player} />
                ) : (
                  <Navigate to="/import" replace />
                )
              }
            />
            <Route
              path="/import"
              element={
                <ImportPage
                  db={db}
                  player={player}
                  onImport={handleImport}
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
