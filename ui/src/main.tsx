import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import { App } from './App.tsx';
import './styles.css';

/**
 * Register the service worker, which is what makes the app installable and what
 * makes it work with no network.
 *
 * After the load event on purpose: registration competes for bandwidth with the
 * page's own assets, and the first paint matters more than being ready offline
 * a second earlier. A failure here is not worth surfacing — the app works
 * exactly as before without it, it simply cannot be installed.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => undefined);
  });
}

// Hash routing keeps deep links working on GitHub Pages, which serves no
// rewrite rules and would 404 on a refreshed sub-path.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
