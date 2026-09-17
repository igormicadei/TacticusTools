import { useMemo, useState, Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';

import { parseRarity } from '@lib/gamedata/enums.js';
import { currentState, markProgress, resolvePlan } from '@lib/gamedata/plan.js';
import { computeTierStarLevel, computeUnitStats } from '@lib/gamedata/stats.js';
import { resolveAbility, unitCombat } from '@lib/gamedata/combat.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse, Unit } from '@lib/types/player.js';

import { buildRoster, humaniseFaction, rarityLabel } from '../data/roster.ts';
import { plansStore } from '../data/plans.ts';
import { PlanForm } from './PlansPage.tsx';
import {
  abilityIcon,
  attackIcon,
  damageIcon,
  factionIcon,
  rankIcon,
  rarityIcon,
  requirementIcon,
  uiIcon,
  unitIcon,
} from '../data/icons.ts';
import { Icon, useIcons } from '../components/Icon.tsx';
import { localAlliance, localDamage, localNumber, localRank, localRarity } from '../i18n/game.ts';
import { t, tn, type StringKey } from '../i18n/locale.ts';

function plain(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\{\[([^\]]+)\]\}/g, '⟨$1⟩')
    .replace(/\s+/g, ' ')
    .trim();
}

function humaniseSlot(slot: string): string {
  return slot.replace(/^I_/, '').replace(/_/g, ' ');
}

export function UnitDetailPage({
  db,
  player,
}: {
  db: GameDatabase;
  player: PlayerResponse;
}) {
  useIcons();
  const { unitId = '' } = useParams();
  const [tab, setTab] = useState<UnitTab>('overview');
  const entry = useMemo(
    () => buildRoster(player, db).find((e) => e.id === decodeURIComponent(unitId)),
    [player, db, unitId],
  );

  if (!entry) {
    return (
      <>
        <Link to="/units" className="back">{t('nav.backUnits')}</Link>
        <div className="empty">{t('ud.unknownUnit', { id: unitId })}</div>
      </>
    );
  }

  const { unit, definition } = entry;

  return (
    <>
      <Link to="/units" className="back">{t('nav.backUnits')}</Link>

      <div className="detail-head">
        <Icon src={unitIcon(entry.id)} alt="" size={104} className="portrait ornate" />
        <div>
          <h1>{entry.name}</h1>
          <div className="muted row wrap">
            {definition?.fullName && definition.fullName !== entry.name ? `${definition.fullName} · ` : ''}
            <Icon src={factionIcon(entry.factionId)} size={16} className="crest" />
            {humaniseFaction(entry.factionId)}
            {definition?.isMachineOfWar ? ` · ${t('card.machineOfWar')}` : ''}
          </div>
        </div>
        <div className="row wrap" style={{ marginLeft: 'auto' }}>
          {entry.rarity !== undefined && (
            <span className="chip rarity" style={{ '--rarity': `var(--rarity-${entry.rarity})` } as React.CSSProperties}>
              <Icon src={rarityIcon(entry.rarity)} size={14} />
              {rarityLabel(entry.rarity)}
            </span>
          )}
          {unit ? (
            <span className="chip">{starsLabel(computeTierStarLevel(unit.progressionIndex, db))}</span>
          ) : (
            <span className="chip">{entry.status === 'unlockable' ? `${entry.shards} shards` : t('ud.notUnlocked')}</span>
          )}
        </div>
      </div>

      {!unit && <NotOwned entry={entry} />}

      {unit && (
        <>
          <UnitTabs value={tab} onChange={setTab} />
          <div className="unit-tab-panel">
            {tab === 'overview' && (
              <div className="panels">
                <Progress unit={unit} db={db} />
                <Plans unit={unit} db={db} player={player} />
                <Attributes unit={unit} db={db} compact />
              </div>
            )}
            {tab === 'combat' && (
              <div className="panels">
                <Attacks unit={unit} db={db} />
                <Attributes unit={unit} db={db} />
                {definition && definition.traits.length > 0 && <Traits unit={unit} db={db} />}
              </div>
            )}
            {tab === 'abilities' && (
              <div className="panels">
                <Abilities unit={unit} db={db} />
              </div>
            )}
            {tab === 'equipment' && (
              <div className="panels">
                <Equipment unit={unit} db={db} />
              </div>
            )}
            {tab === 'resources' && (
              <div className="panels">
                <Shards unit={unit} entry={entry} db={db} />
                <Badges unit={unit} player={player} />
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

type UnitTab = 'overview' | 'combat' | 'abilities' | 'equipment' | 'resources';

function UnitTabs({ value, onChange }: { value: UnitTab; onChange: (value: UnitTab) => void }) {
  const tabs: { id: UnitTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'combat', label: 'Combat' },
    { id: 'abilities', label: 'Abilities' },
    { id: 'equipment', label: 'Equipment' },
    { id: 'resources', label: 'Resources' },
  ];

  return (
    <div className="unit-tabs" role="tablist" aria-label="Unit details">
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className={value === item.id ? 'active' : ''}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function NotOwned({ entry }: { entry: ReturnType<typeof buildRoster>[number] }) {
  return (
    <div className="panel">
      <h3>{t('ud.notUnlocked')}</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        {entry.shards > 0 ? t('ud.shardsCollected', { n: entry.shards }) : t('ud.noShards')} {t('ud.shardsUnknown')}
      </p>
      {entry.definition && (
        <dl className="kv">
          <dt>{t('ud.baseRarity')}</dt>
          <dd>{entry.definition.baseRarity !== undefined ? localRarity(entry.definition.baseRarity) : '—'}</dd>
          <dt>{t('common.movement')}</dt>
          <dd>{entry.definition.movement ?? '—'}</dd>
          <dt>{t('ud.equipmentSlots')}</dt>
          <dd>{entry.definition.itemSlots.map(humaniseSlot).join(', ') || '—'}</dd>
        </dl>
      )}
    </div>
  );
}

function Progress({ unit, db }: { unit: Unit; db: GameDatabase }) {
  const star = db.progressionRequirements.find((r) => r.progressionIndex === unit.progressionIndex);
  const cap = star?.rarity !== undefined ? db.rarityCaps.find((c) => c.rarity === star.rarity)?.maxLevel : undefined;
  const current = db.xpLevels.find((l) => l.level === unit.xpLevel);
  const next = db.xpLevels.find((l) => l.level === unit.xpLevel + 1);
  const intoLevel = current ? unit.xp - current.totalXp : 0;
  const span = current && next ? next.totalXp - current.totalXp : 0;
  const pct = span > 0 ? Math.min(100, Math.round((intoLevel / span) * 100)) : 0;

  return (
    <section className="panel">
      <h3>{t('ud.progression')}</h3>
      <div className="stat-grid">
        <div className="stat"><div className="label">{t('common.level')}</div><div className="value">{unit.xpLevel}{cap !== undefined && <small> / {cap}</small>}</div></div>
        <div className="stat"><div className="label">{t('common.rank')}</div><div className="value row" style={{ fontSize: 15 }}><Icon src={rankIcon(unit.rank)} size={22} />{localRank(unit.rank)}</div></div>
        <div className="stat"><div className="label">{t('ud.stars')}</div><div className="value">{computeTierStarLevel(unit.progressionIndex, db) ?? '—'}{star?.starLevel !== undefined && <small> ({star.starLevel} total)</small>}</div></div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="row small muted" style={{ justifyContent: 'space-between' }}><span>{t('ud.totalXpValue', { n: localNumber(unit.xp) })}</span>{next && <span>{t('ud.toNextValue', { n: localNumber(next.totalXp - unit.xp) })}</span>}</div>
        <div className="bar"><span style={{ width: `${pct}%` }} /></div>
      </div>
      {cap !== undefined && unit.xpLevel >= cap && <p className="small" style={{ color: 'var(--accent)', marginBottom: 0 }}>{t('ud.levelCapped')}</p>}
    </section>
  );
}

function Plans({ unit, db, player }: { unit: Unit; db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const [revision, setRevision] = useState(0);
  const stored = useMemo(() => plansStore.get(unit.id), [unit.id, revision]);
  const plan = useMemo(() => markProgress(resolvePlan(unit, stored.target, db, stored.origin), currentState(unit, db)), [unit, stored, db]);
  const left = plan.steps.filter((s) => !s.done).length;
  const hasTarget = Object.keys(stored.target).length > 0 || (stored.itemTargets?.length ?? 0) > 0;

  return (
    <section className="panel">
      <div className="row wrap" style={{ marginBottom: 8 }}><h3 style={{ margin: 0 }}>{t('ud.plan')}</h3><span style={{ flex: 1 }} />{hasTarget && <><span className="chip">{left === 0 ? t('common.complete') : t('common.stepsLeft', { n: left, total: plan.steps.length })}</span><Link className="chip" to={`/plans/${unit.id}`}>{t('ud.viewFullPlan')}</Link></>}</div>
      <PlanForm db={db} player={player} unit={unit} onSaved={() => setRevision((v) => v + 1)} />
    </section>
  );
}

const ITEM_STAT_LABELS: Record<string, string> = {
  critChance: t('ud.critChance'), critDmg: t('ud.critDamage'), blockChance: t('ud.blockChance'), blockDmg: t('ud.blockDamage'), hp: 'Health', fixedArmor: 'Armour',
};
const PERCENT_STATS = new Set(['critChance', 'blockChance']);
const SLOT_LABEL: Record<string, StringKey> = { active: 'slot.active', passive: 'slot.passive', mythic: 'slot.mythic' };
const FOLDED_INTO_ATTRIBUTES = new Set(['hp', 'fixedArmor']);

function Attributes({ unit, db, compact = false }: { unit: Unit; db: GameDatabase; compact?: boolean }) {
  const definition = db.units[unit.id];
  const stats = computeUnitStats(unit, db);
  return (
    <section className={`panel ${compact ? 'compact-attributes' : ''}`}>
      <h3>{t('ud.attributesAt', { rank: localRank(unit.rank) })}</h3>
      {stats ? <>
        <div className="stat-grid">
          <div className="stat"><div className="label"><Icon src={uiIcon('health')} size={12} /> Health</div><div className="value">{stats.health.toLocaleString()}</div></div>
          <div className="stat"><div className="label"><Icon src={uiIcon('damage')} size={12} /> Damage</div><div className="value">{stats.damage.toLocaleString()}</div></div>
          <div className="stat"><div className="label"><Icon src={uiIcon('armour')} size={12} /> Armour</div><div className="value">{stats.armour.toLocaleString()}</div></div>
        </div>
        {!compact && <>
          <p className="small muted" style={{ marginBottom: 0 }}>{t('ud.statsBase', { hp: stats.base.health, dmg: stats.base.damage, arm: stats.base.armour, multiplier: stats.starMultiplier.toFixed(2), stars: stats.starLevel ?? 0 })}{stats.rankUpgradesApplied > 0 && t('ud.statsRankUpgrades', { hp: stats.rankUpgrades.health, dmg: stats.rankUpgrades.damage, arm: stats.rankUpgrades.armour, applied: stats.rankUpgradesApplied, available: stats.rankUpgradesAvailable })}{(stats.equipment.health > 0 || stats.equipment.armour > 0) && t('ud.statsEquipment', { parts: [stats.equipment.health > 0 ? t('ud.statsEquipHealth', { n: stats.equipment.health }) : undefined, stats.equipment.armour > 0 ? t('ud.statsEquipArmour', { n: stats.equipment.armour }) : undefined].filter(Boolean).join(t('ud.and')) })}.</p>
          <p className="small muted" style={{ marginTop: 0, marginBottom: 0 }}>{t('ud.armourNote')}</p>
        </>}
      </> : <p className="muted small" style={{ margin: 0 }}>{t('ud.noStatBlock')}</p>}
      {!compact && stats && Object.keys(stats.itemBonuses).length > 0 && <>
        <h3 style={{ marginTop: 16 }}>{t('ud.fromEquipment')}</h3>
        <dl className="kv">{Object.entries(stats.itemBonuses).map(([key, value]) => <Fragment key={key}><dt>{ITEM_STAT_LABELS[key] ?? humaniseStat(key)}</dt><dd>+{value}{PERCENT_STATS.has(key) ? '%' : ''}{FOLDED_INTO_ATTRIBUTES.has(key) && <span className="muted small"> {t('ud.countedAbove')}</span>}</dd></Fragment>)}</dl>
      </>}
      {definition && !compact && <dl className="kv" style={{ marginTop: 12 }}><dt>{t('common.movement')}</dt><dd>{definition.movement ?? '—'}</dd><dt>{t('ud.grandAlliance')}</dt><dd>{unit.grandAlliance ? localAlliance(unit.grandAlliance) : '—'}</dd><dt>{t('ud.powerScore')}</dt><dd className="muted">{t('ud.notPublished')}</dd></dl>}
      {!compact && <p className="small muted" style={{ marginBottom: 0 }}>{t('ud.rarityAbilitiesNote')}</p>}
    </section>
  );
}

function Abilities({ unit, db }: { unit: Unit; db: GameDatabase }) {
  useIcons();
  const definition = db.units[unit.id];
  const slotOf = (id: string): 'active' | 'passive' | 'mythic' | undefined => id === definition?.activeAbilityId ? 'active' : id === definition?.passiveAbilityId ? 'passive' : definition?.mythicAbilityIds.includes(id) ? 'mythic' : undefined;
  return (
    <section className="panel"><h3>{t('ud.abilities')}</h3>{unit.abilities.length === 0 && <p className="muted small">None.</p>}{unit.abilities.map((ability) => {
      const def = db.abilities[ability.id];
      const cost = db.abilityUpgradeCosts.find((c) => c.level === ability.level);
      const resolved = def ? resolveAbility(def, ability.level, computeUnitStats(unit, db)?.rarity, db) : undefined;
      return <div className="list-item" key={ability.id}><div className="title"><strong className="row"><Icon src={(() => { const slot = slotOf(ability.id); return slot ? abilityIcon(unit.id, slot) : undefined; })()} size={28} className="portrait" />{def?.name ?? ability.id}</strong><span className="chip">{ability.level === 0 ? t('ud.locked') : t('ud.levelN', { n: ability.level })}</span>{resolved?.attack && <span className="chip ok-chip">{resolved.attack.hits}× {resolved.attack.perHit.mid} {resolved.attack.damageProfile}</span>}</div>{resolved?.description && <div className="desc">{truncate(plain(resolved.description), 320)}</div>}{cost && <div className="desc">{t('ud.nextLevel')} <span>{t('ud.badgeCost', { n: cost.amount, type: cost.badgeType.replace(/^abilityToken/, '') })}</span>{cost.gold > 0 && <>{' · '}<span>{t('ud.goldCost', { n: localNumber(cost.gold) })}</span></>}</div>}</div>;
    })}</section>
  );
}

function Equipment({ unit, db }: { unit: Unit; db: GameDatabase }) {
  useIcons();
  const definition = db.units[unit.id];
  return <section className="panel"><h3>{t('ud.equipment')}</h3>{unit.items.length === 0 && <p className="muted small">{t('ud.nothingEquipped')}</p>}{unit.items.map((item) => { const def = db.items[item.id]; const level = def?.levels[item.level - 1]; return <div className="list-item" key={item.slotId}><div className="title"><strong className="row"><Icon src={requirementIcon(`upgrade:${item.id}`)} size={28} className="portrait" />{item.name ?? def?.name ?? item.id}</strong><span className="chip">{t('ud.slotLevel', { slot: item.slotId, level: item.level })}{def ? ` / ${def.levels.length}` : ''}</span></div><div className="desc">{item.rarity ?? def?.rarity ?? ''}{level && Object.keys(level.stats).length > 0 && <> {' · '}{Object.entries(level.stats).map(([k, v]) => `${humaniseStat(k)} ${v}`).join(', ')}</>}</div></div>; })}{definition && definition.itemSlots.length > unit.items.length && <p className="small muted" style={{ marginBottom: 0 }}>Slots: {definition.itemSlots.map(humaniseSlot).join(', ')}</p>}</section>;
}

function Shards({ unit, entry, db }: { unit: Unit; entry: ReturnType<typeof buildRoster>[number]; db: GameDatabase }) {
  useIcons();
  const next = db.progressionRequirements.find((r) => r.progressionIndex === unit.progressionIndex + 1);
  const held = next?.shardType === 'mythic' ? unit.mythicShards : unit.shards;
  const short = next?.shards !== undefined ? Math.max(0, next.shards - held) : undefined;
  return <section className="panel"><h3>{t('ud.shards')}</h3><dl className="kv"><dt className="row"><Icon src={requirementIcon(`shard:${unit.id}`)} size={20} className="portrait" />Shards</dt><dd>{unit.shards.toLocaleString()}</dd><dt className="row"><Icon src={requirementIcon(`shard:${unit.id}:mythic`)} size={20} className="portrait" />{t('ud.mythicShards')}</dt><dd>{unit.mythicShards.toLocaleString()}</dd><dt>{t('ud.starLevel')}</dt><dd>{unit.progressionIndex}{entry.rarity !== undefined ? ` · ${localRarity(entry.rarity)}` : ''}</dd></dl>{next && <><div className="bar"><span style={{ width: `${next.shards ? Math.min(100, Math.round((held / next.shards) * 100)) : 0}%` }} /></div><p className="small muted" style={{ marginBottom: 0 }}>Next star ({next.kind === 'ascension' ? 'ascension' : 'promotion'}): {next.shards ?? '?'} {next.shardType ?? ''} shards{next.orbs ? t('ud.orbs', { n: next.orbs, rarity: localRarity(next.orbRarity ?? 0) }) : ''}{short !== undefined && short > 0 ? ` — ${short} short` : ' — ready'}</p></>}</section>;
}

function Badges({ unit, player }: { unit: Unit; player: PlayerResponse }) {
  useIcons();
  const alliance = unit.grandAlliance;
  const badges = alliance ? player.player.inventory.abilityBadges[alliance] : undefined;
  return <section className="panel"><h3>{t('ud.abilityBadges', { alliance: alliance ?? t('ud.unknownAlliance') })}</h3>{!badges || badges.length === 0 ? <p className="muted small" style={{ margin: 0 }}>{t('ud.noBadges')}</p> : <dl className="kv">{badges.map((badge) => <Fragment key={`${badge.rarity}-${badge.name ?? ''}`}><dt className="row"><Icon src={requirementIcon(`badge:${alliance}:${parseRarity(badge.rarity)}`)} size={20} className="portrait" />{badge.name ?? badge.rarity}</dt><dd>{badge.amount.toLocaleString()}</dd></Fragment>)}</dl>}<p className="small muted" style={{ marginBottom: 0 }}>{t('ud.badgesShared')}</p></section>;
}

function Traits({ unit, db }: { unit: Unit; db: GameDatabase }) {
  const stats = computeUnitStats(unit, db);
  const { traits } = unitCombat(unit, stats?.damage ?? 0, stats?.rarity, db);
  return <section className="panel"><h3>{t('ud.traits')}</h3><p className="small muted" style={{ marginTop: 0 }}>{t('ud.traitsNote')}</p>{traits.map((trait) => <div className="list-item" key={trait.id}><div className="title"><strong>{trait.name}</strong></div>{trait.description && <div className="desc">{trait.description}</div>}</div>)}</section>;
}

function Attacks({ unit, db }: { unit: Unit; db: GameDatabase }) {
  const stats = computeUnitStats(unit, db);
  const combat = unitCombat(unit, stats?.damage ?? 0, stats?.rarity, db);
  return <section className="panel"><h3>{t('ud.attacks')}</h3>{combat.attacks.map((attack) => <div className="list-item" key={attack.id}><div className="title"><strong className="row"><Icon src={attackIcon(attack.id)} size={24} className="portrait" />{attack.name}</strong><span className="chip">{attack.range ? `Range ${attack.range}` : 'Melee'}</span><span className="chip">{attack.hits}× {localNumber(attack.perHit.mid)} {localDamage(attack.damageProfile)}</span></div><div className="desc">{attack.pierce !== undefined ? `${Math.round(attack.pierce * 100)}% pierce` : ''}{attack.min !== undefined ? ` · ${localNumber(attack.min)}–${localNumber(attack.max ?? attack.min)} damage after armour` : ''}</div></div>)}</section>;
}

function starsLabel(n: number | undefined): string {
  return n === undefined ? '—' : `${n}★`;
}

function humaniseFaction(id: string): string {
  return id.replace(/^faction[_-]?/i, '').replace(/[_-]/g, ' ');
}

function humaniseStat(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
