import { useMemo } from 'react';

import { parseRarity, type Rarity } from '@lib/gamedata/enums.js';
import { itemOptionsForSlot } from '@lib/gamedata/items.js';
import { projectedItemStats, resolveItemTarget, type ItemPlan, type ItemTarget } from '@lib/gamedata/itemPlan.js';
import { computeUnitStats, type ComputedUnitStats } from '@lib/gamedata/stats.js';
import type { GameDatabase, UnitDefinition } from '@lib/gamedata/types.js';
import { UNIT_ITEM_SLOTS } from '@lib/types/player.js';
import type { PlayerResponse, Unit, UnitItemSlot } from '@lib/types/player.js';

import { requirementIcon } from '../data/icons.ts';
import { Icon, useIcons } from './Icon.tsx';
import { localNumber, localRarity, localStat } from '../i18n/game.ts';
import { t } from '../i18n/locale.ts';

/** `I_Booster_Block` -> `Booster Block`. */
export function slotCategoryLabel(itemType: string): string {
  return itemType.replace(/^I_/, '').replace(/_/g, ' ');
}

/** One target per slot, `undefined` where the plan leaves the slot alone. */
function targetFor(targets: readonly ItemTarget[], slotId: string): ItemTarget | undefined {
  return targets.find((target) => target.slotId === slotId);
}

/**
 * Forge Badges of one rarity the player currently holds.
 *
 * The player API spells a badge's rarity as a name (`"Uncommon"`), not the
 * ordinal `db.items` uses, so it is parsed the same tolerant way every other
 * source spelling is.
 */
export function forgeBadgesHeld(player: PlayerResponse, rarity: Rarity): number {
  return player.player.inventory.forgeBadges
    .filter((b) => parseRarity(b.rarity) === rarity)
    .reduce((sum, b) => sum + b.amount, 0);
}

/**
 * Pick, per slot, what to put there and at what level.
 *
 * Every unit slot gets a row regardless of whether the unit owns anything to
 * put there yet — the point of planning ahead is choosing a target before you
 * have farmed it. Compatibility is checked against the unit's slot category
 * and its faction/unit restriction, not its current rarity, since a plan is
 * allowed to outrun where the unit stands today.
 */
export function ItemTargetsEditor({
  db,
  player,
  unitDef,
  unit,
  value,
  onChange,
}: {
  db: GameDatabase;
  player: PlayerResponse;
  unitDef: UnitDefinition | undefined;
  /** The unit's live state, for what already sits in each slot. */
  unit: Unit | undefined;
  value: ItemTarget[];
  onChange: (next: ItemTarget[]) => void;
}) {
  useIcons();
  if (!unitDef || unitDef.itemSlots.length === 0) return null;

  const set = (slotId: UnitItemSlot, patch: Partial<ItemTarget> | undefined) => {
    const rest = value.filter((v) => v.slotId !== slotId);
    if (!patch) {
      onChange(rest);
      return;
    }
    const existing = targetFor(value, slotId);
    const itemId = patch.itemId ?? existing?.itemId ?? '';
    if (!itemId) {
      onChange(rest);
      return;
    }
    onChange([...rest, { slotId, itemId, level: patch.level ?? existing?.level ?? 1 }]);
  };

  return (
    <div className="item-target-editor">
      {unitDef.itemSlots.map((itemType, index) => {
        const slotId = UNIT_ITEM_SLOTS[index];
        if (!slotId) return null;
        const options = itemOptionsForSlot(unitDef, slotId, db);
        const current = targetFor(value, slotId);
        const worn = unit?.items.find((i) => i.slotId === slotId);
        const chosenDef = current ? db.items[current.itemId] : undefined;
        const cap = chosenDef?.levels.length ?? 1;

        return (
          <div className="form-grid" key={slotId} style={{ marginBottom: 8 }}>
            <label>
              <span>
                {slotCategoryLabel(itemType)}
                {worn && (
                  <span className="muted small"> · {t('itemplan.currently', { item: worn.name ?? worn.id, level: worn.level })}</span>
                )}
              </span>
              <select
                value={current?.itemId ?? ''}
                onChange={(e) => set(slotId, e.target.value ? { itemId: e.target.value, level: 1 } : undefined)}
              >
                <option value="">{t('itemplan.noTarget')}</option>
                {options.map((opt) => (
                  <option value={opt.id} key={opt.id}>
                    {opt.name}
                    {opt.rarity !== undefined ? ` · ${localRarity(opt.rarity)}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {current && (
              <label>
                <span>{t('common.level')}</span>
                <select
                  value={current.level}
                  onChange={(e) => set(slotId, { level: Number(e.target.value) })}
                >
                  {Array.from({ length: cap }, (_, i) => i + 1).map((n) => (
                    <option value={n} key={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        );
      })}

      {unit && value.length > 0 && (
        <ItemTargetsSummary db={db} player={player} unit={unit} targets={value} />
      )}
    </div>
  );
}

/** Stat keys worth showing a delta for: the headline two, plus whatever gear grants. */
function statRows(
  before: ComputedUnitStats | undefined,
  after: ComputedUnitStats | undefined,
): { label: string; from: number; to: number }[] {
  if (!before || !after) return [];
  const rows: { label: string; from: number; to: number }[] = [];
  if (before.health !== after.health) {
    rows.push({ label: t('common.health'), from: before.health, to: after.health });
  }
  if (before.armour !== after.armour) {
    rows.push({ label: t('common.armour'), from: before.armour, to: after.armour });
  }
  const keys = new Set([...Object.keys(before.itemBonuses), ...Object.keys(after.itemBonuses)]);
  for (const key of keys) {
    const from = before.itemBonuses[key] ?? 0;
    const to = after.itemBonuses[key] ?? 0;
    if (from !== to) rows.push({ label: localStat(key), from, to });
  }
  return rows;
}

/**
 * Read-only cost and stat impact of a set of item targets, for the plan card
 * and the plan detail page alike.
 *
 * Each slot is projected on its own, against the unit as it stands today —
 * not stacked with the others — since the point is "what does putting this
 * here get me", not a compound hypothetical no single purchase produces.
 */
export function ItemTargetsSummary({
  db,
  player,
  unit,
  targets,
  compact,
}: {
  db: GameDatabase;
  player: PlayerResponse;
  unit: Unit;
  targets: readonly ItemTarget[];
  compact?: boolean | undefined;
}) {
  useIcons();
  const now = useMemo(() => computeUnitStats(unit, db), [unit, db]);
  const rows = useMemo(
    () =>
      targets.map((target) => ({
        target,
        plan: resolveItemTarget(unit, target, db),
        after: projectedItemStats(unit, target, db),
      })),
    [targets, unit, db],
  );

  if (rows.length === 0) return null;

  return (
    <div className={`item-target-summary${compact ? ' compact' : ''}`}>
      {rows.map(({ target, plan, after }) => (
        <ItemTargetRow
          key={target.slotId}
          plan={plan}
          player={player}
          stats={statRows(now, after)}
          compact={compact}
        />
      ))}
    </div>
  );
}

function ItemTargetRow({
  plan,
  player,
  stats,
  compact,
}: {
  plan: ItemPlan;
  player: PlayerResponse;
  stats: { label: string; from: number; to: number }[];
  compact?: boolean | undefined;
}) {
  if (plan.blocked) {
    return <p className="small muted">{plan.blocked}</p>;
  }

  const heldNote = !plan.connected
    ? plan.current
      ? t('itemplan.notOnChain', { item: plan.target.name, from: plan.current.name })
      : t('itemplan.freshStart', { item: plan.target.name })
    : undefined;

  return (
    <div className="item-target-row">
      <div className="row wrap">
        <Icon src={requirementIcon(`upgrade:${plan.target.itemId}`)} size={22} className="portrait" reserve />
        <strong>{plan.target.name}</strong>
        <span className="muted small">{t('itemplan.toLevel', { n: plan.target.level })}</span>
        {plan.legs.length === 0 ? (
          <span className="chip ok-chip">{t('itemplan.alreadyMet')}</span>
        ) : (
          <>
            {plan.cost.dust > 0 && <span className="chip">{t('itemplan.dust', { n: localNumber(plan.cost.dust) })}</span>}
            {plan.cost.gold > 0 && <span className="chip gold">{t('itemplan.gold', { n: localNumber(plan.cost.gold) })}</span>}
            {plan.cost.mythicDust > 0 && (
              <span className="chip">{t('itemplan.mythicDust', { n: localNumber(plan.cost.mythicDust) })}</span>
            )}
            {Object.entries(plan.cost.forgeBadges).map(([rarity, need]) => {
              const rarityValue = Number(rarity) as Rarity;
              const held = forgeBadgesHeld(player, rarityValue);
              return (
                <span className={`chip${held < (need ?? 0) ? ' warn' : ''}`} key={rarity}>
                  {t('itemplan.forgeBadges', { held, need: need ?? 0, rarity: localRarity(rarityValue) })}
                </span>
              );
            })}
          </>
        )}
      </div>
      {heldNote && <p className="small muted" style={{ margin: '2px 0 0' }}>{heldNote}</p>}
      {!compact && stats.length > 0 && (
        <div className="row wrap" style={{ marginTop: 4 }}>
          {stats.map((row) => (
            <span className="projected-stat" key={row.label}>
              <span className="from">{localNumber(row.from)}</span>
              <span className="arrow">→</span>
              <span className="to">{localNumber(row.to)}</span>
              <span className="unit">{row.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
