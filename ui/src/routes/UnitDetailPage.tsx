import { Fragment, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';

import { parseRarity } from '@lib/gamedata/enums.js';
import { computeTierStarLevel, computeUnitStats } from '@lib/gamedata/stats.js';
import { resolveAbility, unitCombat } from '@lib/gamedata/combat.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse, Unit } from '@lib/types/player.js';

import { buildRoster, humaniseFaction, rarityLabel } from '../data/roster.ts';
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

/**
 * Make game-config text readable.
 *
 * Descriptions carry client markup and unresolved template placeholders like
 * `{[nrOfHits]}`, whose values depend on ability level through a formula no
 * source publishes. The placeholders are shown as `⟨nrOfHits⟩` rather than
 * dropped, so the sentence still reads and the missing value is visible.
 */
function plain(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\{\[([^\]]+)\]\}/g, '⟨$1⟩')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `I_Booster_Block` -> `Booster Block`. */
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
  const entry = useMemo(
    () => buildRoster(player, db).find((e) => e.id === decodeURIComponent(unitId)),
    [player, db, unitId],
  );

  if (!entry) {
    return (
      <>
        <Link to="/units" className="back">
          {t('nav.backUnits')}
        </Link>
        <div className="empty">{t('ud.unknownUnit', { id: unitId })}</div>
      </>
    );
  }

  const { unit, definition } = entry;

  return (
    <>
      <Link to="/units" className="back">
        {t('nav.backUnits')}
      </Link>

      <div className="detail-head">
        <Icon src={unitIcon(entry.id)} alt="" size={72} className="portrait ornate" />
        <div>
          <h1>{entry.name}</h1>
          <div className="muted row">
            {definition?.fullName && definition.fullName !== entry.name
              ? `${definition.fullName} · `
              : ''}
            <Icon src={factionIcon(entry.factionId)} size={16} className="crest" />
            {humaniseFaction(entry.factionId)}
            {definition?.isMachineOfWar ? ` · ${t('card.machineOfWar')}` : ''}
          </div>
        </div>
        <div className="row wrap" style={{ marginLeft: 'auto' }}>
          {entry.rarity !== undefined && (
            <span
              className="chip rarity"
              style={{ '--rarity': `var(--rarity-${entry.rarity})` } as React.CSSProperties}
            >
              <Icon src={rarityIcon(entry.rarity)} size={14} />
              {rarityLabel(entry.rarity)}
            </span>
          )}
          {unit ? (
            <span className="chip">{starsLabel(computeTierStarLevel(unit.progressionIndex, db))}</span>
          ) : (
            <span className="chip">
              {entry.status === 'unlockable' ? `${entry.shards} shards` : t('ud.notUnlocked')}
            </span>
          )}
        </div>
      </div>

      {!unit && <NotOwned entry={entry} />}

      {unit && (
        <div className="panels">
          <Progress unit={unit} db={db} />
          <Attributes unit={unit} db={db} />
          <Attacks unit={unit} db={db} />
          <Abilities unit={unit} db={db} />
          <Equipment unit={unit} db={db} />
          <Shards unit={unit} entry={entry} db={db} />
          <Badges unit={unit} player={player} />
          {definition && definition.traits.length > 0 && (
            <Traits unit={unit} db={db} />
          )}
        </div>
      )}
    </>
  );
}

function NotOwned({ entry }: { entry: ReturnType<typeof buildRoster>[number] }) {
  return (
    <div className="panel">
      <h3>{t('ud.notUnlocked')}</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        {entry.shards > 0
          ? t('ud.shardsCollected', { n: entry.shards })
          : t('ud.noShards')}{' '}
        {/* The unlock threshold is its own value in the game's progression panel
            and no data source publishes it, so no target is shown here. */}
        {t('ud.shardsUnknown')}
      </p>
      {entry.definition && (
        <dl className="kv">
          <dt>{t('ud.baseRarity')}</dt>
          <dd>
            {entry.definition.baseRarity !== undefined
              ? localRarity(entry.definition.baseRarity)
              : '—'}
          </dd>
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
  const star = db.progressionRequirements.find(
    (r) => r.progressionIndex === unit.progressionIndex,
  );
  const cap = star?.rarity !== undefined
    ? db.rarityCaps.find((c) => c.rarity === star.rarity)?.maxLevel
    : undefined;

  const current = db.xpLevels.find((l) => l.level === unit.xpLevel);
  const next = db.xpLevels.find((l) => l.level === unit.xpLevel + 1);
  const intoLevel = current ? unit.xp - current.totalXp : 0;
  const span = current && next ? next.totalXp - current.totalXp : 0;
  const pct = span > 0 ? Math.min(100, Math.round((intoLevel / span) * 100)) : 0;

  return (
    <section className="panel">
      <h3>{t('ud.progression')}</h3>
      <div className="stat-grid">
        <div className="stat">
          <div className="label">{t('common.level')}</div>
          <div className="value">
            {unit.xpLevel}
            {cap !== undefined && <small> / {cap}</small>}
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('common.rank')}</div>
          <div className="value row" style={{ fontSize: 15 }}>
            <Icon src={rankIcon(unit.rank)} size={22} />
            {localRank(unit.rank)}
          </div>
        </div>
        <div className="stat">
          <div className="label">{t('ud.stars')}</div>
          <div className="value">
            {computeTierStarLevel(unit.progressionIndex, db) ?? '—'}
            {star?.starLevel !== undefined && <small> ({star.starLevel} total)</small>}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="row small muted" style={{ justifyContent: 'space-between' }}>
          <span>{t('ud.totalXpValue', { n: localNumber(unit.xp) })}</span>
          {next && (
            <span>{t('ud.toNextValue', { n: localNumber(next.totalXp - unit.xp) })}</span>
          )}
        </div>
        <div className="bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      {cap !== undefined && unit.xpLevel >= cap && (
        <p className="small" style={{ color: 'var(--accent)', marginBottom: 0 }}>
          {t('ud.levelCapped')}
        </p>
      )}
    </section>
  );
}

const ITEM_STAT_LABELS: Record<string, string> = {
  critChance: t('ud.critChance'),
  critDmg: t('ud.critDamage'),
  blockChance: t('ud.blockChance'),
  blockDmg: t('ud.blockDamage'),
  hp: 'Health',
  fixedArmor: 'Armour',
};

const PERCENT_STATS = new Set(['critChance', 'blockChance']);

/**
 * Where an attack comes from.
 *
 * Read off the unit's own ability slots, so it is structural. A normal attack is
 * the weapon; everything else is the ability that carries it.
 */
const SLOT_LABEL: Record<string, StringKey> = {
  active: 'slot.active',
  passive: 'slot.passive',
  mythic: 'slot.mythic',
};

/**
 * Equipment stats the game folds into the headline figures rather than showing
 * on their own; the crit and block stats are the ones it lists separately.
 */
const FOLDED_INTO_ATTRIBUTES = new Set(['hp', 'fixedArmor']);

function Attributes({ unit, db }: { unit: Unit; db: GameDatabase }) {
  const definition = db.units[unit.id];
  const stats = computeUnitStats(unit, db);
  return (
    <section className="panel">
      <h3>{t('ud.attributesAt', { rank: localRank(unit.rank) })}</h3>
      {stats ? (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">
                <Icon src={uiIcon('health')} size={12} /> Health
              </div>
              <div className="value">{stats.health.toLocaleString()}</div>
            </div>
            <div className="stat">
              <div className="label">
                <Icon src={uiIcon('damage')} size={12} /> Damage
              </div>
              <div className="value">{stats.damage.toLocaleString()}</div>
            </div>
            <div className="stat">
              <div className="label">
                <Icon src={uiIcon('armour')} size={12} /> Armour
              </div>
              <div className="value">{stats.armour.toLocaleString()}</div>
            </div>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Base {stats.base.health}/{stats.base.damage}/{stats.base.armour} × 
            {stats.starMultiplier.toFixed(2)} ({stats.starLevel ?? 0} cumulative stars, +10%
            each)
            {stats.rankUpgradesApplied > 0 && (
              <>
                , then +{stats.rankUpgrades.health}/{stats.rankUpgrades.damage}/
                {stats.rankUpgrades.armour} from {stats.rankUpgradesApplied} of{' '}
                {stats.rankUpgradesAvailable} rank upgrades
              </>
            )}
            {(stats.equipment.health > 0 || stats.equipment.armour > 0) && (
              <>
                , plus{' '}
                {[
                  stats.equipment.health > 0 ? `+${stats.equipment.health} health` : undefined,
                  stats.equipment.armour > 0 ? `+${stats.equipment.armour} armour` : undefined,
                ]
                  .filter(Boolean)
                  .join(' and ')}{' '}
                from equipment, which lands outside the multiplier
              </>
            )}
            .
          </p>
          <p className="small muted" style={{ marginTop: 0, marginBottom: 0 }}>
            {t('ud.armourNote')}
          </p>
        </>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          {t('ud.noStatBlock')}
        </p>
      )}

      {stats && Object.keys(stats.itemBonuses).length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>{t('ud.fromEquipment')}</h3>
          <dl className="kv">
            {Object.entries(stats.itemBonuses).map(([key, value]) => (
              <Fragment key={key}>
                <dt>{ITEM_STAT_LABELS[key] ?? humaniseStat(key)}</dt>
                <dd>
                  +{value}
                  {PERCENT_STATS.has(key) ? '%' : ''}
                  {FOLDED_INTO_ATTRIBUTES.has(key) && (
                    <span className="muted small"> {t('ud.countedAbove')}</span>
                  )}
                </dd>
              </Fragment>
            ))}
          </dl>
        </>
      )}

      {definition && (
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>{t('common.movement')}</dt>
          <dd>{definition.movement ?? '—'}</dd>
          <dt>{t('ud.grandAlliance')}</dt>
          <dd>{unit.grandAlliance ? localAlliance(unit.grandAlliance) : '—'}</dd>
          <dt>{t('ud.powerScore')}</dt>
          <dd className="muted">{t('ud.notPublished')}</dd>
        </dl>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        Rarity adds +20% per tier to <em>ability</em> values, not to these — stars scale
        a unit's stats, rarity scales its abilities, and the two never cross.
      </p>
    </section>
  );
}

function Abilities({ unit, db }: { unit: Unit; db: GameDatabase }) {
  useIcons();
  const definition = db.units[unit.id];
  // Art is filed per unit and slot rather than per ability, so the slot has to
  // be worked back out from which of the unit's two ability ids this is.
  const slotOf = (id: string): 'active' | 'passive' | 'mythic' | undefined =>
    id === definition?.activeAbilityId
      ? 'active'
      : id === definition?.passiveAbilityId
        ? 'passive'
        : definition?.mythicAbilityIds.includes(id)
          ? 'mythic'
          : undefined;
  return (
    <section className="panel">
      <h3>{t('ud.abilities')}</h3>
      {unit.abilities.length === 0 && <p className="muted small">None.</p>}
      {unit.abilities.map((ability) => {
        const def = db.abilities[ability.id];
        // A row is the cost of leaving its level, not of reaching it.
        const cost = db.abilityUpgradeCosts.find((c) => c.level === ability.level);
        // Values filled in at this level and rarity, so the text reads as the
        // game shows it rather than as "{[dmg]}".
        const resolved = def
          ? resolveAbility(def, ability.level, computeUnitStats(unit, db)?.rarity, db)
          : undefined;
        return (
          <div className="list-item" key={ability.id}>
            <div className="title">
              <strong className="row">
                <Icon
                  src={(() => {
                    const slot = slotOf(ability.id);
                    return slot ? abilityIcon(unit.id, slot) : undefined;
                  })()}
                  size={28}
                  className="portrait"
                />
                {def?.name ?? ability.id}
              </strong>
              <span className="chip">
                {ability.level === 0 ? t('ud.locked') : t('ud.levelN', { n: ability.level })}
              </span>
              {resolved?.attack && (
                <span className="chip ok-chip">
                  {resolved.attack.hits}× {resolved.attack.perHit.mid} {resolved.attack.damageProfile}
                </span>
              )}
            </div>
            {resolved?.description && (
              <div className="desc">{truncate(plain(resolved.description), 320)}</div>
            )}
            {cost && (
              <div className="desc">
                {t('ud.nextLevel')}{' '}
                <span>
                  {t('ud.badgeCost', {
                    n: cost.amount,
                    type: cost.badgeType.replace(/^abilityToken/, ''),
                  })}
                </span>
                {cost.gold > 0 && (
                  <>
                    {' · '}
                    <span>{t('ud.goldCost', { n: localNumber(cost.gold) })}</span>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Equipment({ unit, db }: { unit: Unit; db: GameDatabase }) {
  useIcons();
  const definition = db.units[unit.id];
  return (
    <section className="panel">
      <h3>{t('ud.equipment')}</h3>
      {unit.items.length === 0 && <p className="muted small">{t('ud.nothingEquipped')}</p>}
      {unit.items.map((item) => {
        const def = db.items[item.id];
        const level = def?.levels[item.level - 1];
        return (
          <div className="list-item" key={item.slotId}>
            <div className="title">
              <strong className="row">
                <Icon src={requirementIcon(`upgrade:${item.id}`)} size={28} className="portrait" />
                {item.name ?? def?.name ?? item.id}
              </strong>
              <span className="chip">
                {t('ud.slotLevel', { slot: item.slotId, level: item.level })}
                {def ? ` / ${def.levels.length}` : ''}
              </span>
            </div>
            <div className="desc">
              {item.rarity ?? def?.rarity ?? ''}
              {level && Object.keys(level.stats).length > 0 && (
                <>
                  {' · '}
                  {Object.entries(level.stats)
                    .map(([k, v]) => `${humaniseStat(k)} ${v}`)
                    .join(', ')}
                </>
              )}
            </div>
          </div>
        );
      })}
      {definition && definition.itemSlots.length > unit.items.length && (
        <p className="small muted" style={{ marginBottom: 0 }}>
          Slots: {definition.itemSlots.map(humaniseSlot).join(', ')}
        </p>
      )}
    </section>
  );
}

function Shards({
  unit,
  entry,
  db,
}: {
  unit: Unit;
  entry: ReturnType<typeof buildRoster>[number];
  db: GameDatabase;
}) {
  useIcons();
  const next = db.progressionRequirements.find(
    (r) => r.progressionIndex === unit.progressionIndex + 1,
  );
  const held = next?.shardType === 'mythic' ? unit.mythicShards : unit.shards;
  const short = next?.shards !== undefined ? Math.max(0, next.shards - held) : undefined;

  return (
    <section className="panel">
      <h3>{t('ud.shards')}</h3>
      <dl className="kv">
        <dt className="row">
          <Icon src={requirementIcon(`shard:${unit.id}`)} size={20} className="portrait" />
          Shards
        </dt>
        <dd>{unit.shards.toLocaleString()}</dd>
        <dt className="row">
          <Icon src={requirementIcon(`shard:${unit.id}:mythic`)} size={20} className="portrait" />
          {t('ud.mythicShards')}
        </dt>
        <dd>{unit.mythicShards.toLocaleString()}</dd>
        <dt>{t('ud.starLevel')}</dt>
        <dd>
          {unit.progressionIndex}
          {entry.rarity !== undefined ? ` · ${localRarity(entry.rarity)}` : ''}
        </dd>
      </dl>
      {next && (
        <>
          <div className="bar">
            <span
              style={{
                width: `${next.shards ? Math.min(100, Math.round((held / next.shards) * 100)) : 0}%`,
              }}
            />
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Next star ({next.kind === 'ascension' ? 'ascension' : 'promotion'}):{' '}
            {next.shards ?? '?'} {next.shardType ?? ''} shards
            {next.orbs
              ? t('ud.orbs', { n: next.orbs, rarity: localRarity(next.orbRarity ?? 0) })
              : ''}
            {short !== undefined && short > 0 ? ` — ${short} short` : ' — ready'}
          </p>
        </>
      )}
    </section>
  );
}

function Badges({ unit, player }: { unit: Unit; player: PlayerResponse }) {
  useIcons();
  const alliance = unit.grandAlliance;
  const badges = alliance ? player.player.inventory.abilityBadges[alliance] : undefined;
  return (
    <section className="panel">
      <h3>{t('ud.abilityBadges', { alliance: alliance ?? t('ud.unknownAlliance') })}</h3>
      {!badges || badges.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          {t('ud.noBadges')}
        </p>
      ) : (
        <dl className="kv">
          {badges.map((badge) => (
            <Fragment key={`${badge.rarity}-${badge.name ?? ''}`}>
              <dt className="row">
                <Icon
                  src={requirementIcon(`badge:${alliance}:${parseRarity(badge.rarity)}`)}
                  size={20}
                  className="portrait"
                />
                {badge.name ?? badge.rarity}
              </dt>
              <dd>{badge.amount.toLocaleString()}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        {t('ud.badgesShared')}
      </p>
    </section>
  );
}

function Traits({ unit, db }: { unit: Unit; db: GameDatabase }) {
  const stats = computeUnitStats(unit, db);
  const { traits } = unitCombat(unit, stats?.damage ?? 0, stats?.rarity, db);
  return (
    <section className="panel">
      <h3>{t('ud.traits')}</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('ud.traitsNote')}
      </p>
      {traits.map((trait) => (
        <div className="list-item" key={trait.id}>
          <div className="title">
            <strong>{trait.name}</strong>
          </div>
          {trait.description && <div className="desc">{trait.description}</div>}
        </div>
      ))}
    </section>
  );
}

/**
 * What the unit does when it attacks.
 *
 * The game shows damage per hit; the numbers that decide a fight are that times
 * the hit count, and the part of it armour cannot stop.
 */
function Attacks({ unit, db }: { unit: Unit; db: GameDatabase }) {
  useIcons();
  const stats = computeUnitStats(unit, db);
  if (!stats) return null;
  const combat = unitCombat(unit, stats.damage, stats.rarity, db, stats.itemBonuses.critChance);
  const rows = [
    ...(combat.melee ? [combat.melee] : []),
    ...(combat.ranged ? [combat.ranged] : []),
    ...combat.abilityAttacks,
  ];
  if (rows.length === 0) return null;

  return (
    <section className="panel">
      <h3>{t('ud.attacks')}</h3>
      {rows.map((attack, index) => (
        <div className="attack-row" key={`${attack.source}:${attack.label}:${index}`}>
          <div className="attack-head">
            <strong className="row">
              <Icon
                src={
                  attack.source === 'ability'
                    ? damageIcon(attack.damageProfile)
                    : (attackIcon(attack.source) ?? damageIcon(attack.damageProfile))
                }
                size={20}
              />
              {attack.source === 'melee'
                ? t('ud.melee')
                : attack.source === 'ranged'
                  ? t('ud.ranged')
                  : attack.label}
            </strong>
            <span className={`chip ${attack.slot ? `slot-${attack.slot}` : 'slot-normal'}`}>
              {attack.slot ? t(SLOT_LABEL[attack.slot] ?? 'ud.normal') : t('ud.normal')}
            </span>
            <span className="muted small">
              {attack.hits}× {attack.perHit.mid.toLocaleString()}
              {attack.perHit.high > attack.perHit.mid && ` ±${attack.perHit.high - attack.perHit.mid}`}
              {' '}
              {localDamage(attack.damageProfile)}
              {attack.pierceRatio !== undefined && (
                <span title={attack.pierceDescription}>
                  {' '}
                  {t('ud.pierce', { n: (attack.pierceRatio * 100).toFixed(0) })}
                </span>
              )}
              {attack.range !== undefined && t('ud.range', { n: attack.range })}
              {attack.attackRangeType !== undefined &&
                attack.source === 'ability' &&
                ` · ${attack.attackRangeType.toLowerCase()}`}
            </span>
          </div>
          <div className="attack-figures">
            {attack.effective ? (
              <Figure
                label={t('ud.min')}
                value={attack.effective}
                note={t('ud.throughAnyArmour')}
              />
            ) : (
              <span className="attack-figure">
                <em>{t('ud.min')}</em>{' '}
                <span className="muted">{t('ud.pierceNotPublished')}</span>
              </span>
            )}
            <Figure
              label={t('ud.max')}
              value={attack.total}
              strong
              note={t('ud.againstNoArmour')}
            />
          </div>
        </div>
      ))}

      <p className="small muted">
        <strong>{t('ud.min')}</strong> / <strong>{t('ud.max')}</strong>{' '}
        {t('ud.minMaxNote')}
        {armourNote(rows)}
        {t('ud.minMaxNoteEnd')}
      </p>

      {combat.critChain && (
        <p className="small muted" style={{ marginBottom: 0 }}>
          {t('ud.critNote', {
            chance: combat.critChain.chance,
            odds: combat.critChain.perAttack
              .map((p, i) =>
                tn(i + 1, 'ud.critOdds', 'ud.critOddsPlural', { pct: (p * 100).toFixed(1) }),
              )
              .join(', '),
          })}
        </p>
      )}
    </section>
  );
}

function Figure({
  label,
  value,
  strong,
  note,
}: {
  label: string;
  value: { mid: number; low: number; high: number };
  strong?: boolean;
  note?: string;
}) {
  const swing = value.high - value.mid;
  return (
    <span className="attack-figure">
      <em>{label}</em>{' '}
      {strong ? <strong>{value.mid.toLocaleString()}</strong> : value.mid.toLocaleString()}
      {swing > 0 && <span className="muted"> ±{swing}</span>}
      {note && <span className="muted attack-note"> {note}</span>}
    </span>
  );
}

/** A concrete reading of the armour floor for this unit's own attacks. */
function armourNote(rows: { label: string; source: string; armourFloorAt?: number; pierceRatio?: number }[]): string {
  const ranged = rows.find((r) => r.source === 'ranged') ?? rows[0];
  if (!ranged || ranged.armourFloorAt === undefined) return 'the ratio varies by damage type';
  if (ranged.pierceRatio === 1) {
    return `this unit's ${ranged.source} attack ignores armour entirely`;
  }
  return `for the ${ranged.source} attack that is ${ranged.armourFloorAt} armour`;
}

function starsLabel(stars: number | undefined): string {
  if (stars === undefined) return 'stars unknown';
  return `${stars} ${stars === 1 ? 'star' : 'stars'}`;
}

function humaniseStat(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
