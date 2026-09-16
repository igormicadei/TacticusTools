import { localNumber } from '../i18n/game.ts';
import { Icon, useIcons } from './Icon.tsx';

export interface StatCardRow {
  key: string;
  icon: string | undefined;
  label: string;
  /** Current value, or the value reached when `from` is also given. */
  value: number;
  /** Present for a projection; omitted for a plain "as it stands" reading. */
  from?: number;
}

/**
 * A unit's headline stats as their own small card: one row per stat, an icon
 * leading each one, stacked rather than run together on one line.
 *
 * Two readings share this: a plain current value (the units roster), and a
 * from → to projection (a plan card, a plan's own page) — the row only grows
 * an arrow when `from` differs from `value`, so a stat a step does not touch
 * still reads as one settled number rather than "160 → 160".
 */
export function StatCard({ rows }: { rows: StatCardRow[] }) {
  useIcons();
  if (rows.length === 0) return null;
  return (
    <div className="stat-card">
      {rows.map((row) => {
        const changed = row.from !== undefined && row.from !== row.value;
        return (
          <div className="stat-card-row" key={row.key}>
            <Icon src={row.icon} size={16} reserve />
            {changed && (
              <>
                <span className="from">{localNumber(row.from!)}</span>
                <span className="arrow">→</span>
              </>
            )}
            <span className={changed ? 'to changed' : 'to'}>{localNumber(row.value)}</span>
            <span className="stat-card-label">{row.label}</span>
          </div>
        );
      })}
    </div>
  );
}
