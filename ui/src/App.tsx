import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { loadGameData } from './data/gamedata.ts';
import { fetchPlayer, storage } from './data/player.ts';
import { BadgesPage } from './routes/BadgesPage.tsx';
import { UpgradesPage } from './routes/UpgradesPage.tsx';
import { currentLang, t, useLang } from './i18n/locale.ts';
import { PlanDetailPage } from './routes/PlanDetailPage.tsx';
import { TeamDetailPage } from './routes/TeamDetailPage.tsx';
import { TeamsPage } from './routes/TeamsPage.tsx';
import { PlansPage } from './routes/PlansPage.tsx';
import { TimelinePage } from './routes/TimelinePage.tsx';
import { PlayerDataPage } from './routes/PlayerDataPage.tsx';
import { UnitDetailPage } from './routes/UnitDetailPage.tsx';
import { UnitsPage } from './routes/UnitsPage.tsx';

import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

/**
 * How old a stored roster may be before it is refreshed on its own.
 *
 * Short, because the API does not cache: `metaData.lastUpdatedOn` comes back
 * within seconds of the request, so a refresh genuinely reflects the game. The
 * limit exists to avoid refetching on every tab switch, not to hide staleness.
 */
const STALE_AFTER_MS = 2 * 60 * 1000;

export function App() {
  // Subscribed at the root: a language change has to repaint the whole tree,
  // and every screen below reads `t` directly rather than through a prop.
  useLang();
  const [db, setDb] = useState<GameDatabase>();
  const [player, setPlayer] = useState<PlayerResponse | undefined>(() => storage.readPlayer());
  const [fetchedAt, setFetchedAt] = useState<number | undefined>(() => storage.readFetchedAt());
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const inFlight = useRef(false);
  // Shown whenever a key is stored, not only once a roster has loaded: a failed
  // first fetch would otherwise leave no way to retry from here.
  const hasKey = Boolean(storage.readCredentials().apiKey);

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

  /**
   * Fetch the roster with the stored credentials.
   *
   * `force` is what the toolbar button uses; without it the call is skipped
   * while the stored copy is still fresh, so returning to the tab does not
   * refetch every time.
   */
  const refresh = useCallback(
    async (force = false) => {
      const credentials = storage.readCredentials();
      if (!credentials.apiKey || inFlight.current) return;
      if (!force && Date.now() - (storage.readFetchedAt() ?? 0) < STALE_AFTER_MS) return;
      inFlight.current = true;
      setRefreshing(true);
      try {
        handleLoaded(await fetchPlayer(credentials));
        setRefreshError(undefined);
      } catch (e: unknown) {
        // A refresh that quietly does nothing is indistinguishable from one
        // that found no changes, so say so here rather than only on the Player
        // data page — that is where the settings to fix it live, but the person
        // pressing the button is looking at this bar.
        setRefreshError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.current = false;
        setRefreshing(false);
      }
    },
    [handleLoaded],
  );

  // On load, and whenever the tab is brought back into view — the usual rhythm
  // is to play, switch back, and expect the roster to have caught up.
  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">TACTICUS TOOLS</span>
        <nav>
          <NavLink to="/units" className={({ isActive }) => (isActive ? 'active' : '')}>
            {t('nav.units')}
          </NavLink>
          <NavLink to="/plans" className={({ isActive }) => (isActive ? 'active' : '')}>
            {t('nav.plans')}
          </NavLink>
          <NavLink to="/teams" className={({ isActive }) => (isActive ? 'active' : '')}>
            {t('nav.teams')}
          </NavLink>
          <NavLink to="/upgrades" className={({ isActive }) => (isActive ? 'active' : '')}>
            {t('nav.upgrades')}
          </NavLink>
          <NavLink to="/badges" className={({ isActive }) => (isActive ? 'active' : '')}>
            {t('nav.badges')}
          </NavLink>
          <NavLink to="/player" className={({ isActive }) => (isActive ? 'active' : '')}>
            {t('nav.player')}
          </NavLink>
        </nav>
        <span className="spacer" />
        {hasKey && (
          <span className="session row small muted">
            {player && (
              <>
                {/* Dropped on a phone, where the nav and the refresh button are
                    the only things worth the width. */}
                <span className="session-name">
                  {t('shell.power', {
                    name: player.player.details.name,
                    power: player.player.details.powerLevel,
                  })}
                </span>
                <span className="session-age" title={syncedAtTitle(player, fetchedAt)}>
                  {age(player, fetchedAt)}
                </span>
              </>
            )}
            {refreshError && (
              <NavLink to="/player" className="chip warn" title={refreshError}>
                {t('shell.refreshFailed')}
              </NavLink>
            )}
            <button
              className="small"
              onClick={() => void refresh(true)}
              disabled={refreshing}
              title={t('shell.refreshHint')}
            >
              {refreshing ? t('shell.refreshing') : t('shell.refresh')}
            </button>
          </span>
        )}
      </header>

      <main className="content">
        {error && <div className="notice error">{error}</div>}
        {!db && !error && <div className="empty">{t('shell.loadingDb')}</div>}

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
              path="/plans"
              element={
                player ? <PlansPage db={db} player={player} /> : <Navigate to="/player" replace />
              }
            />
            {/* Before the :planId route, or "timeline" is read as a plan id. */}
            <Route
              path="/plans/timeline"
              element={
                player ? (
                  <TimelinePage db={db} player={player} />
                ) : (
                  <Navigate to="/player" replace />
                )
              }
            />
            <Route
              path="/plans/:planId"
              element={
                player ? (
                  <PlanDetailPage db={db} player={player} />
                ) : (
                  <Navigate to="/player" replace />
                )
              }
            />
            <Route
              path="/teams"
              element={
                player ? <TeamsPage db={db} player={player} /> : <Navigate to="/player" replace />
              }
            />
            <Route
              path="/teams/:teamId"
              element={
                player ? (
                  <TeamDetailPage db={db} player={player} />
                ) : (
                  <Navigate to="/player" replace />
                )
              }
            />
            <Route
              path="/upgrades"
              element={
                player ? <UpgradesPage db={db} player={player} /> : <Navigate to="/player" replace />
              }
            />
            {/* The page was called Items before it was named after the game's
                own word for these. Kept so an existing bookmark still lands. */}
            <Route path="/items" element={<Navigate to="/upgrades" replace />} />
            <Route
              path="/badges"
              element={
                player ? <BadgesPage db={db} player={player} /> : <Navigate to="/player" replace />
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

/**
 * Age of the roster, measured from the game's own sync time.
 *
 * `metaData.lastUpdatedOn` is when the API last took data from the game, which
 * is the number that matters; the time we fetched only says when we asked.
 */
function age(player: PlayerResponse, fetchedAt: number | undefined): string {
  const syncedAt = (player.metaData.lastUpdatedOn || 0) * 1000 || fetchedAt;
  if (!syncedAt) return '';
  const minutes = Math.floor((Date.now() - syncedAt) / 60000);
  if (minutes < 1) return t('shell.justNow');
  if (minutes < 60) return t('shell.minutesAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 24
    ? t('shell.hoursAgo', { n: hours })
    : t('shell.daysAgo', { n: Math.floor(hours / 24) });
}

function syncedAtTitle(player: PlayerResponse, fetchedAt: number | undefined): string {
  const locale = currentLang() === 'pt' ? 'pt-BR' : 'en-GB';
  const synced = player.metaData.lastUpdatedOn
    ? new Date(player.metaData.lastUpdatedOn * 1000).toLocaleString(locale)
    : t('shell.unknown');
  const got = fetchedAt ? new Date(fetchedAt).toLocaleString(locale) : t('shell.unknown');
  return t('shell.syncedTitle', { synced, got });
}
