import { useMemo, useState } from 'react';

import { costOfSpan } from '@lib/gamedata/itemPlan.js';
import { compatibleUnits } from '@lib/gamedata/items.js';
import type { GameDatabase, ItemDefinition, UnitDefinition } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { requirementIcon, unitIcon } from '../data/icons.ts';
import { Icon, useIcons } from '../components/Icon.tsx';
import { slotCategoryLabel } from '../components/ItemTargets.tsx';
import { SearchField, SegmentedControl, SelectField, SwitchField, Toolbar, ToolbarCounts } from '../components/Toolbar.tsx';
import { localNumber, localRarity } from '../i18n/game.ts';
import { t, tn } from '../i18n/locale.ts';

interface EquipmentEntry {
  def: ItemDefinition;
  units: UnitDefinition[];
  loose: { level: number; amount: number }[];
  worn: { unitId: string; unitName: string; level: number; slotId: string }[];
  cost: { dust: number; gold: number; mythicDust: number };
}

const CATEGORIES = ['I_Crit', 'I_Defensive', 'I_Block', 'I_Booster_Crit', 'I_Booster_Block'];

export function EquipmentPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [rarity, setRarity] = useState('');
  const [heldOnly, setHeldOnly] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // One pass over the roster and the inventory, so a row's "who holds this"
  // answer is a lookup rather than a scan repeated per row.
  const catalogue = useMemo<EquipmentEntry[]>(() => {
    const looseByItem = new Map<string, { level: number; amount: number }[]>();
    for (const held of player.player.inventory.items) {
      const list = looseByItem.get(held.id) ?? [];
      list.push({ level: held.level ?? 1, amount: held.amount });
      looseByItem.set(held.id, list);
    }
    const wornByItem = new Map<string, EquipmentEntry['worn']>();
    for (const unit of player.player.units) {
      for (const equipped of unit.items) {
        const list = wornByItem.get(equipped.id) ?? [];
        list.push({
          unitId: unit.id,
          unitName: unit.name ?? unit.id,
          level: equipped.level,
          slotId: equipped.slotId,
        });
        wornByItem.set(equipped.id, list);
      }
    }

    return Object.values(db.items).map((def) => ({
      def,
      units: compatibleUnits(def, db),
      loose: looseByItem.get(def.id) ?? [],
      worn: wornByItem.get(def.id) ?? [],
      cost: costOfSpan(def, 0, def.levels.length || 1),
    }));
  }, [db, player]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalogue
      .filter((row) => {
        if (category && row.def.itemType !== category) return false;
        if (rarity !== '' && row.def.rarity !== Number(rarity)) return false;
        if (heldOnly && row.loose.length === 0 && row.worn.length === 0) return false;
        if (!q) return true;
        return row.def.name.toLowerCase().includes(q) || row.def.id.toLowerCase().includes(q);
      })
      .sort(
        (a, b) =>
          a.def.itemType.localeCompare(b.def.itemType) ||
          (a.def.rarity ?? 0) - (b.def.rarity ?? 0) ||
          a.def.name.localeCompare(b.def.name),
      );
  }, [catalogue, query, category, rarity, heldOnly]);

  const held = catalogue.filter((row) => row.loose.length > 0 || row.worn.length > 0).length;

  return (
    <>
      <Toolbar>
        <SegmentedControl
          value={category}
          onChange={setCategory}
          options={[
            { value: '', label: t('equip.filterAll') },
            ...CATEGORIES.map((c) => ({ value: c, label: slotCategoryLabel(c) })),
          ]}
        />
        <SelectField label={t('common.rarity')} value={rarity} onChange={setRarity}>
          <option value="">{t('equip.rarityAll')}</option>
          {[0, 1, 2, 3, 4, 5].map((r) => (
            <option value={r} key={r}>
              {localRarity(r)}
            </option>
          ))}
        </SelectField>
        <SwitchField checked={heldOnly} onChange={setHeldOnly} label={t('equip.filterHeld')} />
        <SearchField value={query} onChange={setQuery} placeholder={t('equip.search')} />
        <ToolbarCounts
          items={[
            { value: held, label: t('equip.count.held') },
            { value: catalogue.length, label: t('equip.count.known') },
          ]}
        />
      </Toolbar>

      <section className="panel">
        <p className="small muted" style={{ marginTop: 0 }}>
          {t('equip.blurb')}
        </p>
        {rows.length === 0 ? (
          <div className="empty">{t('equip.noMatch', { query })}</div>
        ) : (
          <ul className="item-list" style={{ paddingLeft: 0 }}>
            {rows.map((row) => (
              <EquipmentRow
                key={row.def.id}
                row={row}
                expanded={open.has(row.def.id)}
                onToggle={() => toggle(row.def.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function EquipmentRow({
  row,
  expanded,
  onToggle,
}: {
  row: EquipmentEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const held = row.loose.reduce((n, l) => n + l.amount, 0) + row.worn.length;
  return (
    <li className={`item-row${held > 0 ? ' complete' : ''}`}>
      <button className="item-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="chevron">{expanded ? '▾' : '▸'}</span>
        <span className="count">{held > 0 ? `${held}×` : '—'}</span>
        <Icon src={requirementIcon(`upgrade:${row.def.id}`)} size={22} className="portrait" reserve />
        <span className="item-name">
          {row.def.name}
          {row.def.rarity !== undefined && (
            <span className="muted small"> · {localRarity(row.def.rarity)}</span>
          )}
        </span>
        <span className="row-tail">
          {row.cost.dust > 0 && <span className="chip">{t('itemplan.dust', { n: localNumber(row.cost.dust) })}</span>}
          {row.cost.gold > 0 && <span className="chip gold">{t('itemplan.gold', { n: localNumber(row.cost.gold) })}</span>}
          {row.cost.mythicDust > 0 && (
            <span className="chip">{t('itemplan.mythicDust', { n: localNumber(row.cost.mythicDust) })}</span>
          )}
          <span className="muted small">
            {row.units.length === 0
              ? t('equip.noOneCan')
              : tn(row.units.length, 'equip.usableBy', 'equip.usableByPlural')}
          </span>
        </span>
      </button>
      {expanded && <EquipmentDetail row={row} />}
    </li>
  );
}

function EquipmentDetail({ row }: { row: EquipmentEntry }) {
  return (
    <div className="source-note">
      {row.worn.length > 0 && (
        <div className="small muted" style={{ marginBottom: 6 }}>
          {row.worn.map((w) => (
            <div className="row" key={`${w.unitId}:${w.slotId}`}>
              <Icon src={unitIcon(w.unitId)} size={18} className="portrait" />
              {t('equip.worn', { unit: w.unitName, level: w.level })}
            </div>
          ))}
        </div>
      )}
      {row.loose.length > 0 && (
        <div className="small muted" style={{ marginBottom: 6 }}>
          {row.loose.map((l) => (
            <div key={l.level}>{t('equip.loose', { n: l.amount, level: l.level })}</div>
          ))}
        </div>
      )}
      <div className="small muted" style={{ marginBottom: 4 }}>
        {t('equip.compatibleHeading')}
      </div>
      <div className="row wrap">
        {row.units.map((unit) => (
          <span className="chip" key={unit.id} title={unit.fullName ?? unit.name}>
            <Icon src={unitIcon(unit.id)} size={16} />
            {unit.name}
          </span>
        ))}
      </div>
    </div>
  );
}
