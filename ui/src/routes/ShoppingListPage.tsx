import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { Rarity } from '@lib/gamedata/enums.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { Icon, useIcons } from '../components/Icon.tsx';
import { forgeBadgesHeld } from '../components/ItemTargets.tsx';
import { requirementIcon, unitIcon } from '../data/icons.ts';
import { plansStore } from '../data/plans.ts';
import { buildShoppingList, type ShoppingListRow } from '../data/shoppingList.ts';
import { localNumber, localRarity } from '../i18n/game.ts';
import { t } from '../i18n/locale.ts';

const ACCOUNT_KEY = 'tacticus-tools:shoppingList-accountForInventory';

export function ShoppingListPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const [accountForInventory, setAccountForInventory] = useState(
    () => localStorage.getItem(ACCOUNT_KEY) === '1',
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const toggleAccount = (checked: boolean) => {
    setAccountForInventory(checked);
    try {
      localStorage.setItem(ACCOUNT_KEY, checked ? '1' : '0');
    } catch {
      /* The choice still holds for this render. */
    }
  };
  const toggleOpen = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const plans = useMemo(() => plansStore.list(), []);
  const { rows, totals } = useMemo(
    () => buildShoppingList(plans, player.player.units, db, player, accountForInventory),
    [plans, player, db, accountForInventory],
  );

  const outstanding = rows.filter((row) => row.plan.legs.length > 0);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; rows: ShoppingListRow[] }>();
    for (const row of outstanding) {
      const key = row.target.itemId;
      const bucket = map.get(key);
      if (bucket) bucket.rows.push(row);
      else map.set(key, { name: row.plan.target.name, rows: [row] });
    }
    return [...map.entries()]
      .map(([itemId, bucket]) => ({ itemId, ...bucket }))
      .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
  }, [outstanding]);

  if (plans.length === 0) {
    return (
      <>
        <Link to="/plans" className="back">
          {t('nav.backPlans')}
        </Link>
        <div className="empty">{t('shopping.none')}</div>
      </>
    );
  }

  return (
    <>
      <Link to="/plans" className="back">
        {t('nav.backPlans')}
      </Link>

      <div className="detail-head">
        <div>
          <h1>{t('shopping.heading')}</h1>
          <div className="muted">
            {t('shopping.acrossPlans', { n: new Set(outstanding.map((r) => r.planId)).size })}
          </div>
        </div>
        <label className="switch" style={{ marginLeft: 'auto' }} title={t('shopping.accountHint')}>
          <input
            type="checkbox"
            checked={accountForInventory}
            onChange={(e) => toggleAccount(e.target.checked)}
          />
          <span>{t('shopping.account')}</span>
        </label>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <p className="small muted" style={{ marginTop: 0 }}>
          {t('shopping.blurb')}
        </p>
        {outstanding.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>{t('shopping.allMet')}</p>
        ) : (
          <div className="row wrap" style={{ gap: 8 }}>
            {totals.dust > 0 && <span className="chip">{t('itemplan.dust', { n: localNumber(totals.dust) })}</span>}
            {totals.gold > 0 && <span className="chip gold">{t('itemplan.gold', { n: localNumber(totals.gold) })}</span>}
            {totals.mythicDust > 0 && (
              <span className="chip">{t('itemplan.mythicDust', { n: localNumber(totals.mythicDust) })}</span>
            )}
            {Object.entries(totals.forgeBadges).map(([rarity, need]) => {
              const rarityValue = Number(rarity) as Rarity;
              const held = forgeBadgesHeld(player, rarityValue);
              return (
                <span className={`chip${held < (need ?? 0) ? ' warn' : ''}`} key={rarity}>
                  {t('itemplan.forgeBadges', { held, need: need ?? 0, rarity: localRarity(rarityValue) })}
                </span>
              );
            })}
          </div>
        )}
      </section>

      {groups.length === 0 ? (
        <div className="empty">{t('shopping.allMet')}</div>
      ) : (
        <section className="panel">
          <ul className="item-list" style={{ paddingLeft: 0 }}>
            {groups.map((group) => (
              <ItemGroupRow
                key={group.itemId}
                itemId={group.itemId}
                name={group.name}
                rows={group.rows}
                expanded={open.has(group.itemId)}
                onToggle={() => toggleOpen(group.itemId)}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ItemGroupRow({
  itemId,
  name,
  rows,
  expanded,
  onToggle,
}: {
  itemId: string;
  name: string;
  rows: ShoppingListRow[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="item-row">
      <button className="item-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
        <span className="count">{rows.length}×</span>
        <Icon src={requirementIcon(`upgrade:${itemId}`)} size={22} className="portrait" reserve />
        <span className="item-name">{name}</span>
        <span className="row-tail">
          <span className="muted small">
            {rows.length === 1
              ? t('shopping.oneUnit')
              : t('shopping.manyUnits', { n: rows.length })}
          </span>
        </span>
      </button>
      {expanded && (
        <ul className="item-list nested">
          {rows.map((row) => (
            <ShoppingListLine key={`${row.planId}:${row.target.slotId}`} row={row} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ShoppingListLine({ row }: { row: ShoppingListRow }) {
  const { plan } = row;
  return (
    <li className="item-row">
      <div className="item-head static">
        <span className="chevron" />
        <Icon src={unitIcon(row.unitId)} size={22} className="portrait" reserve />
        <span className="item-name">
          <Link to={`/plans/${row.planId}`}>{row.unitName}</Link>
          <span className="muted small"> · {t('itemplan.toLevel', { n: plan.target.level })}</span>
        </span>
        <span className="row-tail">
          {plan.cost.dust > 0 && <span className="chip">{t('itemplan.dust', { n: localNumber(plan.cost.dust) })}</span>}
          {plan.cost.gold > 0 && <span className="chip gold">{t('itemplan.gold', { n: localNumber(plan.cost.gold) })}</span>}
          {plan.cost.mythicDust > 0 && (
            <span className="chip">{t('itemplan.mythicDust', { n: localNumber(plan.cost.mythicDust) })}</span>
          )}
          {row.fromLoose && (
            <span className="chip ok-chip" title={t('shopping.fromLooseHint')}>
              {t('shopping.fromLoose', { n: row.fromLoose.level })}
            </span>
          )}
        </span>
      </div>
    </li>
  );
}
