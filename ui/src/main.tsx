import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import { App } from './App.tsx';
import './styles.css';

// Hash routing keeps deep links working on GitHub Pages, which serves no
// rewrite rules and would 404 on a refreshed sub-path.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
