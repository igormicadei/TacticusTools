import { NavLink } from 'react-router-dom';

function Glyph({ kind }: { kind: 'roster' | 'favorite' | 'compare' | 'planner' }) {
  const common = { width: 25, height: 25, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true as const };
  if (kind === 'roster') return <svg {...common}><path d="M6 3h12v18H6z" stroke="currentColor" strokeWidth="1.7"/><path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
  if (kind === 'favorite') return <svg {...common}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>;
  if (kind === 'compare') return <svg {...common}><rect x="4" y="4" width="6" height="16" rx="1" stroke="currentColor" strokeWidth="1.7"/><rect x="14" y="7" width="6" height="13" rx="1" stroke="currentColor" strokeWidth="1.7"/></svg>;
  return <svg {...common}><path d="M5 4h14v16H5zM8 8h8M8 12h6M8 16h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
}

export function MobileBottomNav() {
  return (
    <nav className="mobile-bottom-nav" aria-label="Roster tools">
      <NavLink to="/units" className={({ isActive }) => isActive ? 'active' : ''}><Glyph kind="roster" /><span>Roster</span></NavLink>
      <button type="button" className="mobile-bottom-action"><Glyph kind="favorite" /><span>Favorites</span></button>
      <button type="button" className="mobile-bottom-action"><Glyph kind="compare" /><span>Compare</span></button>
      <NavLink to="/plans" className={({ isActive }) => isActive ? 'active' : ''}><Glyph kind="planner" /><span>Planner</span></NavLink>
    </nav>
  );
}
