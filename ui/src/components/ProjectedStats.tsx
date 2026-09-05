import type { ComputedUnitStats } from '@lib/gamedata/stats.js';

import { localNumber } from '../i18n/game.ts';
import { t } from '../i18n/locale.ts';

/**
 * Where a unit's three attributes land, against where they are now.
 *
 * Shown as a transition rather than a single figure because the figure alone
 * answers nothing: 1285 health is only meaningful beside the 1083 it comes
 * from. The "to" side carries the accent so a glance reads the gain.
 *
 * A step that moves nothing — levelling, which gates upgrades rather than
 * granting stats — says so rather than printing the same number twice and
 * leaving the reader to compare digits.
 */
export function ProjectedStats({
  from,
  to,
  compact,
}: {
  from: ComputedUnitStats | undefined;
  to: ComputedUnitStats | undefined;
  /** Card version: shorter labels, one line. */
  compact?: boolean;
}) {
  if (!from || !to) return null;

  const rows = [
    { key: 'stat.hp' as const, from: from.health, to: to.health },
    { key: 'stat.dmg' as const, from: from.damage, to: to.damage },
    { key: 'stat.armour' as const, from: from.armour, to: to.armour },
  ];
  if (rows.every((r) => r.from === r.to)) {
    return <span className="muted small">{t('proj.unchanged')}</span>;
  }

  return (
    <span className={`projected${compact ? ' compact' : ''}`} title={t('proj.cardHint')}>
      {rows.map((row) => (
        <span className="projected-stat" key={row.key}>
          <span className="from">{localNumber(row.from)}</span>
          <span className="arrow">→</span>
          <span className="to">{localNumber(row.to)}</span>
          <span className="unit">{t(row.key)}</span>
        </span>
      ))}
    </span>
  );
}
