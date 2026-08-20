import { Fragment, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';

import { rankName, rarityName } from '@lib/gamedata/enums.js';
import { computeTierStarLevel, computeUnitStats } from '@lib/gamedata/stats.js';
import { resolveAbility, unitCombat } from '@lib/gamedata/combat.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse, Unit } from '@lib/types/player.js';

import { buildRoster, humaniseFaction, rarityLabel } from '../data/roster.ts';

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
  const { unitId = '' } = useParams();
  const entry = useMemo(
    () => buildRoster(player, db).find((e) => e.id === decodeURIComponent(unitId)),
    [player, db, unitId],
  );

  if (!entry) {
    return (
      <>
        <Link to="/units" className="back">
          ← All units
        </Link>
        <div className="empty">Unknown unit “{unitId}”.</div>
      </>
    );
  }

  const { unit, definition } = entry;

  return (
    <>
      <Link to="/units" className="back">
        ← All units
      </Link>

      <div className="detail-head">
        <div>
          <h1>{entry.name}</h1>
          <div className="muted">
            {definition?.fullName && definition.fullName !== entry.name
              ? `${definition.fullName} · `
              : ''}
            {humaniseFaction(entry.factionId)}
            {definition?.isMachineOfWar ? ' · Machine of War' : ''}
          </div>
        </div>
        <div className="row wrap" style={{ marginLeft: 'auto' }}>
          {entry.rarity !== undefined && (
            <span
              className="chip rarity"
              style={{ '--rarity': `var(--rarity-${entry.rarity})` } as React.CSSProperties}
            >
              {rarityLabel(entry.rarity)}
            </span>
          )}
          {unit ? (
            <span className="chip">{starsLabel(computeTierStarLevel(unit.progressionIndex, db))}</span>
          ) : (
            <span className="chip">
              {entry.status === 'unlockable' ? `${entry.shards} shards` : 'Not unlocked'}
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
      <h3>Not unlocked</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        {entry.shards > 0
          ? `${entry.shards} shards collected.`
          : 'No shards collected for this unit yet.'}{' '}
        {/* The unlock threshold is its own value in the game's progression panel
            and no data source publishes it, so no target is shown here. */}
        The number of shards needed to unlock a character is not published in the
        data sources, so no target is shown.
      </p>
      {entry.definition && (
        <dl className="kv">
          <dt>Base rarity</dt>
          <dd>
            {entry.definition.baseRarity !== undefined
              ? rarityName(entry.definition.baseRarity)
              : '—'}
          </dd>
          <dt>Movement</dt>
          <dd>{entry.definition.movement ?? '—'}</dd>
          <dt>Equipment slots</dt>
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
      <h3>Progression</h3>
      <div className="stat-grid">
        <div className="stat">
          <div className="label">Level</div>
          <div className="value">
            {unit.xpLevel}
            {cap !== undefined && <small> / {cap}</small>}
          </div>
        </div>
        <div className="stat">
          <div className="label">Rank</div>
          <div className="value" style={{ fontSize: 15 }}>
            {rankName(unit.rank)}
          </div>
        </div>
        <div className="stat">
          <div className="label">Stars</div>
          <div className="value">
            {computeTierStarLevel(unit.progressionIndex, db) ?? '—'}
            {star?.starLevel !== undefined && <small> ({star.starLevel} total)</small>}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="row small muted" style={{ justifyContent: 'space-between' }}>
          <span>Total XP {unit.xp.toLocaleString()}</span>
          {next && <span>{(next.totalXp - unit.xp).toLocaleString()} to next level</span>}
        </div>
        <div className="bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      {cap !== undefined && unit.xpLevel >= cap && (
        <p className="small" style={{ color: 'var(--accent)', marginBottom: 0 }}>
          Level capped at this rarity — ascend to raise the cap.
        </p>
      )}
    </section>
  );
}

const ITEM_STAT_LABELS: Record<string, string> = {
  critChance: 'Crit chance',
  critDmg: 'Crit damage',
  blockChance: 'Block chance',
  blockDmg: 'Block damage',
  hp: 'Health',
  fixedArmor: 'Armour',
};

const PERCENT_STATS = new Set(['critChance', 'blockChance']);

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
      <h3>Attributes at {rankName(unit.rank)}</h3>
      {stats ? (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Health</div>
              <div className="value">{stats.health.toLocaleString()}</div>
            </div>
            <div className="stat">
              <div className="label">Damage</div>
              <div className="value">{stats.damage.toLocaleString()}</div>
            </div>
            <div className="stat">
              <div className="label">Armour</div>
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
            Armour subtracts from each incoming hit one for one, but never below that
            hit's pierce floor — so against a 100% pierce attack, Psychic or Direct, it
            does nothing at all. How much it is worth depends entirely on what is
            shooting at you.
          </p>
        </>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          No stat block published for this rank.
        </p>
      )}

      {stats && Object.keys(stats.itemBonuses).length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>From equipment</h3>
          <dl className="kv">
            {Object.entries(stats.itemBonuses).map(([key, value]) => (
              <Fragment key={key}>
                <dt>{ITEM_STAT_LABELS[key] ?? humaniseStat(key)}</dt>
                <dd>
                  +{value}
                  {PERCENT_STATS.has(key) ? '%' : ''}
                  {FOLDED_INTO_ATTRIBUTES.has(key) && (
                    <span className="muted small"> · counted above</span>
                  )}
                </dd>
              </Fragment>
            ))}
          </dl>
        </>
      )}

      {definition && (
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Movement</dt>
          <dd>{definition.movement ?? '—'}</dd>
          <dt>Grand alliance</dt>
          <dd>{unit.grandAlliance ?? '—'}</dd>
          <dt>Power score</dt>
          <dd className="muted">not published</dd>
        </dl>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        Rarity adds +20% per tier to <em>ability</em> stats, which the source data leaves
        as unresolved placeholders and this does not compute.
      </p>
    </section>
  );
}

function Abilities({ unit, db }: { unit: Unit; db: GameDatabase }) {
  return (
    <section className="panel">
      <h3>Abilities</h3>
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
              <strong>{def?.name ?? ability.id}</strong>
              <span className="chip">
                {ability.level === 0 ? 'Locked' : `Level ${ability.level}`}
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
                Next level: <span>{cost.amount}× {cost.badgeType.replace(/^abilityToken/, '')} badge</span>
                {cost.gold > 0 && <> · <span>{cost.gold.toLocaleString()} gold</span></>}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Equipment({ unit, db }: { unit: Unit; db: GameDatabase }) {
  const definition = db.units[unit.id];
  return (
    <section className="panel">
      <h3>Equipment</h3>
      {unit.items.length === 0 && <p className="muted small">Nothing equipped.</p>}
      {unit.items.map((item) => {
        const def = db.items[item.id];
        const level = def?.levels[item.level - 1];
        return (
          <div className="list-item" key={item.slotId}>
            <div className="title">
              <strong>{item.name ?? def?.name ?? item.id}</strong>
              <span className="chip">
                {item.slotId} · Lv {item.level}
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
  const next = db.progressionRequirements.find(
    (r) => r.progressionIndex === unit.progressionIndex + 1,
  );
  const held = next?.shardType === 'mythic' ? unit.mythicShards : unit.shards;
  const short = next?.shards !== undefined ? Math.max(0, next.shards - held) : undefined;

  return (
    <section className="panel">
      <h3>Shards</h3>
      <dl className="kv">
        <dt>Shards</dt>
        <dd>{unit.shards.toLocaleString()}</dd>
        <dt>Mythic shards</dt>
        <dd>{unit.mythicShards.toLocaleString()}</dd>
        <dt>Star level</dt>
        <dd>
          {unit.progressionIndex}
          {entry.rarity !== undefined ? ` · ${rarityName(entry.rarity)}` : ''}
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
            {next.orbs ? ` + ${next.orbs} ${rarityName(next.orbRarity ?? 0)} orbs` : ''}
            {short !== undefined && short > 0 ? ` — ${short} short` : ' — ready'}
          </p>
        </>
      )}
    </section>
  );
}

function Badges({ unit, player }: { unit: Unit; player: PlayerResponse }) {
  const alliance = unit.grandAlliance;
  const badges = alliance ? player.player.inventory.abilityBadges[alliance] : undefined;
  return (
    <section className="panel">
      <h3>Ability badges · {alliance ?? 'unknown alliance'}</h3>
      {!badges || badges.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          No badges held for this alliance.
        </p>
      ) : (
        <dl className="kv">
          {badges.map((badge) => (
            <Fragment key={`${badge.rarity}-${badge.name ?? ''}`}>
              <dt>{badge.name ?? badge.rarity}</dt>
              <dd>{badge.amount.toLocaleString()}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        Badges are shared across every unit of this alliance.
      </p>
    </section>
  );
}

function Traits({ unit, db }: { unit: Unit; db: GameDatabase }) {
  const stats = computeUnitStats(unit, db);
  const { traits } = unitCombat(unit, stats?.damage ?? 0, stats?.rarity, db);
  return (
    <section className="panel">
      <h3>Traits</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Traits are conditional — most apply only in a particular situation — so none
        of them is folded into the figures above.
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
      <h3>Attacks</h3>
      {rows.map((attack, index) => (
        <div className="attack-row" key={`${attack.source}:${attack.label}:${index}`}>
          <div className="attack-head">
            <strong>
              {attack.source === 'melee'
                ? 'Melee'
                : attack.source === 'ranged'
                  ? 'Ranged'
                  : attack.label}
            </strong>
            <span className="muted small">
              {attack.hits}× {humaniseStat(attack.damageProfile)}
              {attack.pierceRatio !== undefined && (
                <span title={attack.pierceDescription}>
                  {' '}
                  · {(attack.pierceRatio * 100).toFixed(0)}% pierce
                </span>
              )}
              {attack.range !== undefined && ` · range ${attack.range}`}
              {attack.source === 'ability' &&
                ` · ${attack.attackRangeType?.toLowerCase() ?? 'ability'}`}
            </span>
          </div>
          <div className="attack-figures">
            <Figure label="per hit" value={attack.perHit} />
            <Figure label="total" value={attack.total} strong />
            {attack.effective ? (
              <Figure label="effective" value={attack.effective} />
            ) : (
              <span className="attack-figure">
                <em>effective</em> <span className="muted">not published</span>
              </span>
            )}
          </div>
        </div>
      ))}

      <p className="small muted">
        <strong>Total</strong> is damage × hits, against no armour.{' '}
        <strong>Effective</strong> is total × pierce — the floor armour can never take
        away, not a prediction: against a lightly armoured target an attack lands for
        more. Each hit deals <code>max(damage − armour, damage × pierce)</code>, so
        armour stops mattering once it passes{' '}
        {rows[0]?.armourFloorAt !== undefined
          ? `damage × (1 − pierce)`
          : 'damage × (1 − pierce)'}{' '}
        — {armourNote(rows)}. Every attack rolls ±20% on its damage before armour, which
        is the ± shown on each figure.
      </p>

      {combat.critChain && (
        <p className="small muted" style={{ marginBottom: 0 }}>
          Crits chain: each hit is rolled separately and the chain stops at the first
          failure, so at {combat.critChain.chance}% crit chance the odds of{' '}
          {combat.critChain.perAttack
            .map((p, i) => `${i + 1} crit${i === 0 ? '' : 's'} ${(p * 100).toFixed(1)}%`)
            .join(', ')}
          . Crit chance is worth far more on a one-hit weapon than a multi-hit one.
        </p>
      )}
    </section>
  );
}

function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: { mid: number; low: number; high: number };
  strong?: boolean;
}) {
  const swing = value.high - value.mid;
  return (
    <span className="attack-figure">
      <em>{label}</em>{' '}
      {strong ? <strong>{value.mid.toLocaleString()}</strong> : value.mid.toLocaleString()}
      {swing > 0 && <span className="muted"> ±{swing}</span>}
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
