import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { rarityName } from '@lib/gamedata/enums.js';
import { badgeCatalogue, type BadgeEntry, type BadgeUse } from '@lib/gamedata/materials.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { Icon, useIcons } from '../components/Icon.tsx';
import { abilityIcon, requirementIcon, unitIcon } from '../data/icons.ts';

const SLOT_LABEL = { active: 'Active', passive: 'Passive', mythic: 'Mythic' } as const;

export function BadgesPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // Only the abilities this badge can pay for right now, which is the usual
  // question; the full ladder is a click away.
  const [nextOnly, setNextOnly] = useState(true);

  const badges = useMemo(() => badgeCatalogue(player, db), [player, db]);

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const byAlliance = useMemo(() => {
    const map = new Map<string, BadgeEntry[]>();
    for (const badge of badges) {
      const list = map.get(badge.alliance);
      if (list) list.push(badge);
      else map.set(badge.alliance, [badge]);
    }
    return [...map.entries()];
  }, [badges]);

  if (badges.length === 0) {
    return <div className="empty">No ability badges in your inventory.</div>;
  }

  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          <button className={nextOnly ? 'active' : ''} onClick={() => setNextOnly(true)}>
            Next level only
          </button>
          <button className={nextOnly ? '' : 'active'} onClick={() => setNextOnly(false)}>
            Every level it covers
          </button>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Badges belong to a grand alliance, not to a unit, which is why the game cannot tell you
          where one goes — the answer is every ability of every unit on that side. Listed here are
          only the abilities whose remaining levels actually charge that rarity, with what each
          level costs. An ability appears under more than one rarity when its ladder crosses from
          one to the next.
        </p>
      </section>

      {byAlliance.map(([alliance, rows]) => (
        <section className="group" key={alliance}>
          <div className="group-head">
            <h2>{alliance}</h2>
            <span className="pill">{rows.reduce((n, b) => n + b.owned, 0)} held</span>
          </div>
          <div className="panel">
            {rows.map((badge) => (
              <BadgeRow
                key={badge.key}
                badge={badge}
                nextOnly={nextOnly}
                expanded={open.has(badge.key)}
                onToggle={() => toggle(badge.key)}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function BadgeRow({
  badge,
  nextOnly,
  expanded,
  onToggle,
}: {
  badge: BadgeEntry;
  nextOnly: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const uses = nextOnly ? badge.uses.filter((u) => u.next !== undefined) : badge.uses;
  const need = nextOnly ? badge.nextTotal : badge.grandTotal;
  const short = Math.max(0, need - badge.owned);

  return (
    <div className={`item-row${uses.length === 0 ? ' dim' : ''}`}>
      <button className="item-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
        <span className="count">{badge.owned}×</span>
        <Icon src={requirementIcon(badge.key)} size={26} className="portrait" reserve />
        <span className="item-name">
          {rarityName(badge.rarity)} {badge.alliance} badges
        </span>
        {uses.length === 0 ? (
          <span className="muted small">nothing to spend these on yet</span>
        ) : (
          <>
            <span className="muted small">
              {uses.length} {nextOnly ? 'ability upgrade' : 'ability'}
              {uses.length === 1 ? '' : 's'}
            </span>
            <span className={`chip${short === 0 ? ' ok-chip' : ''}`}>
              {need}× {nextOnly ? 'for the next level of each' : 'to finish every level'}
              {short > 0 ? ` · ${short} short` : ''}
            </span>
          </>
        )}
      </button>
      {expanded && <BadgeUses uses={uses} nextOnly={nextOnly} owned={badge.owned} />}
    </div>
  );
}

/**
 * Which abilities a badge can be spent on.
 *
 * Ordered by what the next level costs, so the cheapest upgrade the player can
 * actually afford is at the top. The running total is what makes the list
 * decidable: badges are pooled, so spending them on one ability is spending
 * them on none of the others, and the cut-off line says where the stock runs
 * out if taken in this order.
 */
function BadgeUses({
  uses,
  nextOnly,
  owned,
}: {
  uses: BadgeUse[];
  nextOnly: boolean;
  owned: number;
}) {
  if (uses.length === 0) {
    return (
      <p className="source-note muted small">
        Every ability on this side is either at a level this rarity does not pay for, or already
        maxed.
      </p>
    );
  }

  const sorted = [...uses].sort(
    (a, b) =>
      (a.next ?? a.total) - (b.next ?? b.total) || a.unitName.localeCompare(b.unitName),
  );

  let running = 0;
  return (
    <div className="source-note">
      <ul className="item-list nested">
        {sorted.map((use, i) => {
          const cost = nextOnly ? (use.next ?? 0) : use.total;
          const before = running;
          running += cost;
          const affordable = running <= owned;
          return (
            <li className={`item-row${affordable ? '' : ' dim'}`} key={`${use.unitId}:${use.abilityId}:${i}`}>
              <div className="item-head static">
                <span className="chevron" />
                <span className="count">{cost}×</span>
                <Icon src={unitIcon(use.unitId)} size={22} className="portrait" reserve />
                <Icon
                  src={use.slot === 'mythic' ? undefined : abilityIcon(use.unitId, use.slot)}
                  size={22}
                  className="portrait"
                  reserve
                />
                <span className="item-name">
                  <Link to={`/units/${encodeURIComponent(use.unitId)}`}>{use.unitName}</Link>
                  {' · '}
                  {use.abilityName}
                </span>
                <span className={`chip slot-${use.slot}`}>{SLOT_LABEL[use.slot]}</span>
                <span className="muted small">
                  {nextOnly
                    ? `level ${use.level} → ${use.level + 1}`
                    : `levels ${use.steps[0]?.from} → ${use.steps.at(-1)?.to}`}
                </span>
                <span className="muted small" title="Running total if you spend down this list in order">
                  {before} → {running}
                </span>
              </div>
              {!nextOnly && use.steps.length > 1 && (
                <p className="source-note muted small" style={{ padding: '2px 0 8px 46px' }}>
                  {use.steps
                    .map((s) => `${s.from}→${s.to}: ${s.badges}× + ${s.gold.toLocaleString()} gold`)
                    .join(' · ')}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        Badges are pooled, so the running total is what one order of spending would use. Rows past
        where it passes {owned} are dimmed: they are what your stock does not stretch to.
      </p>
    </div>
  );
}
