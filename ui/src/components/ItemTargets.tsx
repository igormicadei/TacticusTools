import { useMemo, useState } from 'react';

import { parseRarity, type Rarity } from '@lib/gamedata/enums.js';
import { itemOptionsForSlot } from '@lib/gamedata/items.js';
import { projectedItemStats, resolveItemTarget, type ItemPlan, type ItemTarget } from '@lib/gamedata/itemPlan.js';
import { computeUnitStats, type ComputedUnitStats } from '@lib/gamedata/stats.js';
import { RosterUnit } from '@lib/gamedata/teams.js';
import type { GameDatabase, ItemDefinition, UnitDefinition } from '@lib/gamedata/types.js';
import { UNIT_ITEM_SLOTS } from '@lib/types/player.js';
import type { PlayerResponse, Unit, UnitItem, UnitItemSlot } from '@lib/types/player.js';

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

  const set = (slotId: UnitItemSlot, patch: { itemId: string; level: number } | undefined) => {
    const rest = value.filter((v) => v.slotId !== slotId);
    onChange(patch ? [...rest, { slotId, ...patch }] : rest);
  };

  return (
    <div className="item-target-editor">
      {unitDef.itemSlots.map((itemType, index) => {
        const slotId = UNIT_ITEM_SLOTS[index];
        if (!slotId) return null;
        return (
          // Keyed on the unit too: switching units must start each slot's
          // rarity/level filter fresh rather than carry over a choice that
          // may no longer mean anything for the new unit's slots.
          <ItemSlotEditor
            key={`${unitDef.id}:${slotId}`}
            db={db}
            unit={unit}
            unitDef={unitDef}
            slotId={slotId}
            itemType={itemType}
            worn={unit?.items.find((i) => i.slotId === slotId)}
            current={targetFor(value, slotId)}
            onChange={(patch) => set(slotId, patch)}
          />
        );
      })}

      {unit && value.length > 0 && (
        <ItemTargetsSummary db={db} player={player} unit={unit} targets={value} />
      )}
    </div>
  );
}

/**
 * One slot's target, chosen by narrowing rather than searching: rarity first,
 * then the level that rarity is being planned to, then a button per item that
 * qualifies — which is usually one, since the game standardises how many
 * levels a rarity carries, but Mythic's ascension branches can leave more than
 * one candidate at the same rarity and level.
 *
 * The button already shows what picking it grants at the chosen level, since
 * that is exactly the number the rarity+level choice fixed — no need to pick
 * an item first to find out.
 */
/** Item categories where the choice is genuinely chance vs. damage. */
const CRIT_TRADEOFF_TYPES = new Set(['I_Crit', 'I_Booster_Crit']);

/**
 * Expected damage per attack with `item` (at `level`) worn in `slotId`,
 * everything else about the unit unchanged.
 *
 * Swaps a synthetic item into the unit's own item list — leaving the other two
 * slots as actually equipped — and reads {@link RosterUnit.expectedDamage},
 * which already folds crit chance and crit damage into `hits x (perHit +
 * chance x critDmg)`, picking the unit's best attack. That formula is exactly
 * what makes a hard-hitting single strike favour Crit Damage while a
 * five-hit weapon favours Crit Chance: chance compounds once per hit, damage
 * only once per crit. Nothing here reimplements that; it just asks the
 * library for the number under each candidate.
 */
function expectedDamageWithItem(
  unit: Unit,
  db: GameDatabase,
  slotId: UnitItemSlot,
  itemId: string,
  level: number,
): number {
  const hypothetical: Unit = {
    ...unit,
    items: [...unit.items.filter((i) => i.slotId !== slotId), { slotId, id: itemId, level }],
  };
  return new RosterUnit(hypothetical, db).expectedDamage;
}

function ItemSlotEditor({
  db,
  unit,
  unitDef,
  slotId,
  itemType,
  worn,
  current,
  onChange,
}: {
  db: GameDatabase;
  /** The unit's live state, used only to compare crit chance vs. crit damage picks. */
  unit: Unit | undefined;
  unitDef: UnitDefinition;
  slotId: UnitItemSlot;
  itemType: string;
  worn: UnitItem | undefined;
  current: ItemTarget | undefined;
  onChange: (patch: { itemId: string; level: number } | undefined) => void;
}) {
  const options = useMemo(
    () => itemOptionsForSlot(unitDef, slotId, db),
    [unitDef, slotId, db],
  );
  const currentDef = current ? db.items[current.itemId] : undefined;

  const [rarity, setRarity] = useState<Rarity | ''>(currentDef?.rarity ?? '');
  const [level, setLevel] = useState<number | ''>(current?.level ?? '');

  const rarities = useMemo(() => {
    const set = new Set<Rarity>();
    for (const opt of options) if (opt.rarity !== undefined) set.add(opt.rarity);
    return [...set].sort((a, b) => a - b);
  }, [options]);

  const atRarity = useMemo(
    () => (rarity === '' ? [] : options.filter((opt) => opt.rarity === rarity)),
    [options, rarity],
  );
  const maxLevel = atRarity.reduce((max, opt) => Math.max(max, opt.levels.length), 0);
  const levelOptions = Array.from({ length: maxLevel }, (_, i) => i + 1);
  const choices = level === '' ? [] : atRarity.filter((opt) => opt.levels.length >= level);

  /**
   * Expected damage per choice, only when there is an actual chance-vs-damage
   * decision to help with: two or more items at this same rarity and level,
   * in a slot category that trades crit chance against crit damage.
   */
  const expectedByItem = useMemo(() => {
    if (!unit || level === '' || choices.length < 2 || !CRIT_TRADEOFF_TYPES.has(itemType)) {
      return undefined;
    }
    const byId = new Map<string, number>();
    for (const item of choices) byId.set(item.id, expectedDamageWithItem(unit, db, slotId, item.id, level));
    const best = Math.max(...byId.values());
    // No attack resolved for this unit — nothing to compare against.
    if (best <= 0) return undefined;
    return { byId, best };
  }, [unit, db, slotId, itemType, choices, level]);

  const onRarity = (raw: string) => {
    setRarity(raw === '' ? '' : (Number(raw) as Rarity));
    setLevel('');
    if (current) onChange(undefined);
  };
  const onLevel = (raw: string) => {
    setLevel(raw === '' ? '' : Number(raw));
    if (current) onChange(undefined);
  };

  return (
    <div className="item-slot-editor">
      <div className="item-slot-head">
        {slotCategoryLabel(itemType)}
        {worn && (
          <span className="muted small">
            {' '}
            · {t('itemplan.currently', { item: worn.name ?? worn.id, level: worn.level })}
          </span>
        )}
      </div>
      <div className="form-grid" style={{ marginBottom: 8 }}>
        <label>
          <span>{t('common.rarity')}</span>
          <select value={rarity} onChange={(e) => onRarity(e.target.value)}>
            <option value="">{t('itemplan.noTarget')}</option>
            {rarities.map((r) => (
              <option value={r} key={r}>
                {localRarity(r)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('common.level')}</span>
          <select value={level} onChange={(e) => onLevel(e.target.value)} disabled={rarity === ''}>
            <option value="">{rarity === '' ? t('itemplan.pickRarityFirst') : '—'}</option>
            {levelOptions.map((n) => (
              <option value={n} key={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rarity !== '' && level !== '' && (
        <div className="item-choice-list">
          {choices.length === 0 ? (
            <p className="small muted">{t('itemplan.noItemsHere')}</p>
          ) : (
            <>
              {expectedByItem && (
                <p className="small muted" style={{ width: '100%', margin: '0 0 4px' }}>
                  {t('itemplan.critHint')}
                </p>
              )}
              {choices.map((item) => (
                <ItemChoiceButton
                  key={item.id}
                  item={item}
                  level={level}
                  selected={current?.itemId === item.id}
                  expectedDamage={expectedByItem?.byId.get(item.id)}
                  best={
                    expectedByItem !== undefined &&
                    expectedByItem.byId.get(item.id) === expectedByItem.best
                  }
                  onClick={() =>
                    onChange(current?.itemId === item.id ? undefined : { itemId: item.id, level })
                  }
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One item on offer at the slot's chosen rarity and level, as a button. */
function ItemChoiceButton({
  item,
  level,
  selected,
  expectedDamage,
  best,
  onClick,
}: {
  item: ItemDefinition;
  level: number;
  selected: boolean;
  /** This choice's expected damage per attack, when it is worth comparing at all. */
  expectedDamage?: number | undefined;
  /** Whether this choice is the (a) highest-expected-damage pick among its siblings. */
  best?: boolean | undefined;
  onClick: () => void;
}) {
  const levelData = item.levels[level - 1];
  const gains = levelData
    ? Object.entries(levelData.stats).map(([key, n]) =>
        t('si.slotGain', { n: localNumber(n), stat: localStat(key) }),
      )
    : [];
  return (
    <button
      type="button"
      className={`item-choice-btn${selected ? ' selected' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <Icon src={requirementIcon(`upgrade:${item.id}`)} size={28} className="portrait" reserve />
      <span className="item-choice-body">
        <span className="item-choice-name">
          {item.name}
          {best && <span className="chip ok-chip" style={{ marginLeft: 6 }}>{t('itemplan.critBest')}</span>}
        </span>
        {gains.length > 0 && <span className="item-choice-gain muted small">{gains.join(', ')}</span>}
        {expectedDamage !== undefined && (
          <span className="muted small">{t('itemplan.expectedDamage', { n: localNumber(Math.round(expectedDamage)) })}</span>
        )}
      </span>
    </button>
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
