import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Rarity } from '@lib/gamedata/enums.js';
import {
  BattleBrief,
  EquipmentPool,
  ItemOptimiser,
  RarityCeiling,
  RosterUnit,
  Team,
  TeamOptimiser,
  buildRosterUnits,
  type Assignment,
  type Objective,
  type PoolScope,
} from '@lib/gamedata/teams.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { Icon, useIcons } from '../components/Icon.tsx';
import { campaignIcon, rankIcon, rarityIcon, requirementIcon, unitIcon } from '../data/icons.ts';
import { teamsStore } from '../data/teams.ts';
import { RosterPicker, humanise } from './TeamsPage.tsx';
import { localNumber, localRank, localRarity } from '../i18n/game.ts';
import { t, tn, type StringKey } from '../i18n/locale.ts';

const RARITIES: Rarity[] = [
  Rarity.Common,
  Rarity.Uncommon,
  Rarity.Rare,
  Rarity.Epic,
  Rarity.Legendary,
  Rarity.Mythic,
];

const OBJECTIVES: { key: Objective; label: StringKey; hint: StringKey }[] = [
  { key: 'defence', label: 'td.obj.defence', hint: 'td.obj.defenceHint' },
  { key: 'offence', label: 'td.obj.offence', hint: 'td.obj.offenceHint' },
  { key: 'health', label: 'td.obj.health', hint: 'td.obj.healthHint' },
  { key: 'armour', label: 'td.obj.armour', hint: 'td.obj.armourHint' },
];

const SCOPES: { key: PoolScope; label: StringKey; hint: StringKey }[] = [
  { key: 'team', label: 'td.pool.team', hint: 'td.pool.teamHint' },
  { key: 'team+inventory', label: 'td.pool.teamInventory', hint: 'td.pool.teamInventoryHint' },
  { key: 'all', label: 'td.pool.all', hint: 'td.pool.allHint' },
];

export function TeamDetailPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const { teamId = '' } = useParams();
  const [revision, setRevision] = useState(0);
  const stored = useMemo(() => teamsStore.get(teamId), [teamId, revision]);

  const [objective, setObjective] = useState<Objective>('defence');
  const [scope, setScope] = useState<PoolScope>('team+inventory');
  const [layout, setLayout] = useState<Assignment[] | undefined>();

  const cap = useMemo(
    () => (stored?.capRarity !== undefined ? new RarityCeiling(stored.capRarity, db) : undefined),
    [stored?.capRarity, db],
  );
  const roster = useMemo(() => buildRosterUnits(player, db, cap), [player, db, cap]);

  const battles = useMemo(() => BattleBrief.all(db), [db]);
  const brief = useMemo(
    () => (stored?.battleKey ? battles.find((b) => b.battle.key === stored.battleKey) : undefined),
    [battles, stored?.battleKey],
  );

  if (!stored) {
    return (
      <>
        <Link to="/teams" className="back">
          {t('nav.backTeams')}
        </Link>
        <div className="empty">{t('td.gone')}</div>
      </>
    );
  }

  const team = new Team(stored.id, stored.name, stored.memberIds, stored.capRarity);
  const members = team.members(roster);
  const totals = team.totals(members);
  const selected = new Set(stored.memberIds);
  const save = (changes: Parameters<typeof teamsStore.update>[1]) => {
    teamsStore.update(stored.id, changes);
    setLayout(undefined);
    setRevision((v) => v + 1);
  };

  const toggleMember = (id: string) => {
    const next = selected.has(id)
      ? stored.memberIds.filter((m) => m !== id)
      : [...stored.memberIds, id];
    save({ memberIds: next });
  };

  const optimiseItems = () => {
    const pool = EquipmentPool.from(player, db, scope, stored.memberIds);
    setLayout(new ItemOptimiser(pool, db, objective).optimise(members));
  };

  const fillFromBattle = () => {
    if (!brief) return;
    const picks = new TeamOptimiser(brief, objective).recommend(roster);
    save({ memberIds: picks.map((p) => p.unit.id) });
  };

  return (
    <>
      <Link to="/teams" className="back">
        {t('nav.backTeams')}
      </Link>

      <div className="detail-head">
        <div>
          <h1>
            <input
              className="title-input"
              value={stored.name}
              onChange={(e) => save({ name: e.target.value })}
              aria-label={t('td.teamName')}
            />
          </h1>
          <div className="muted">
            {members.length} unit{members.length === 1 ? '' : 's'}
            {cap && t('td.playedAt', { rarity: localRarity(team.capRarity) })}
            {brief && ` · ${brief.campaignName} node ${brief.battle.nodeNumber}`}
          </div>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h3>{t('td.conditions')}</h3>
        <div className="form-grid">
          <label>
            <span>{t('td.rarityCap')}</span>
            <select
              value={stored.capRarity ?? ''}
              onChange={(e) =>
                save({ capRarity: e.target.value === '' ? undefined : (Number(e.target.value) as Rarity) })
              }
            >
              <option value="">{t('td.uncapped')}</option>
              {RARITIES.map((rarity) => (
                <option key={rarity} value={rarity}>
                  {localRarity(rarity)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('td.battle')}</span>
            <select
              value={stored.battleKey ?? ''}
              onChange={(e) => save({ battleKey: e.target.value || undefined })}
            >
              <option value="">{t('td.noNode')}</option>
              {battles.map((b) => (
                <option key={b.battle.key} value={b.battle.key}>
                  {t('td.nodeSlots', { campaign: b.campaignName, node: b.battle.nodeNumber, slots: b.slots })}
                </option>
              ))}
            </select>
          </label>
        </div>

        {cap && <CapExplainer cap={cap} members={members} />}
        {brief && <BattlePanel brief={brief} onFill={fillFromBattle} />}
      </section>

      {members.length > 0 && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h3>{t('td.squad')}</h3>
          <div className="stat-grid" style={{ marginBottom: 12 }}>
            <Stat label={t('common.health')} value={totals.health} />
            <Stat label={t('teams.attack')} value={totals.damage} />
            <Stat label={t('common.armour')} value={totals.armour} />
            <Stat label={t('td.throughNormal')} value={Math.round(totals.effectiveNormal)} />
            <Stat label={t('td.throughAbility')} value={Math.round(totals.effectiveAbility)} />
          </div>
          <ul className="item-list" style={{ paddingLeft: 0 }}>
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                brief={brief}
                assignments={layout?.filter((a) => a.unitId === member.id) ?? []}
                onRemove={() => toggleMember(member.id)}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="panel" style={{ marginBottom: 16 }}>
        <h3>{t('td.optimise')}</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          {t('td.objectiveBlurb')}
        </p>
        <div className="form-grid">
          <label>
            <span>{t('td.optimiseFor')}</span>
            <select value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
              {OBJECTIVES.map((o) => (
                <option key={o.key} value={o.key} title={t(o.hint)}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('td.drawingFrom')}</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as PoolScope)}>
              {SCOPES.map((s) => (
                <option key={s.key} value={s.key} title={t(s.hint)}>
                  {t(s.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <button className="primary" onClick={optimiseItems} disabled={members.length === 0}>
            {t('td.workOutLayout')}
          </button>
          {layout && (
            <button className="small" onClick={() => setLayout(undefined)}>
              Clear
            </button>
          )}
          {layout && (
            <span className="muted small">
              {layout.length === 0
                ? t('td.nothingBetter')
                : tn(layout.length, 'td.swapCount', 'td.swapCountPlural')}
            </span>
          )}
        </div>
        {layout && layout.length > 0 && <LayoutTable layout={layout} db={db} roster={roster} />}
      </section>

      <RosterPicker
        roster={roster}
        selected={selected}
        onToggle={toggleMember}
        brief={brief}
      />
    </>
  );
}

/** A rarity that may not be known, for the two sides of a cap. */
function rarityLabel(rarity: Rarity | undefined): string {
  return rarity === undefined ? t('td.rarityUnknown') : localRarity(rarity);
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value.toLocaleString()}</div>
    </div>
  );
}

/**
 * What the cap actually did, per unit.
 *
 * Shown rather than silently applied: a squad's numbers dropping by half is
 * alarming without the reason, and the reason is four separate reductions —
 * rarity, stars, rank and equipment — that the game bundles under one word.
 */
function CapExplainer({ cap, members }: { cap: RarityCeiling; members: RosterUnit[] }) {
  const affected = members.filter((m) => m.isCapped);
  return (
    <>
      <p className="small muted" style={{ marginBottom: affected.length ? 8 : 0 }}>
        {t('td.capBlurb', {
          rarity: localRarity(cap.rarity),
          level: cap.levelCap,
          rank: localRank(cap.rankCap),
        })}
      </p>
      {affected.length > 0 && (
        <ul className="item-list nested">
          {affected.map((member) => {
            const effect = cap.describe(member.unit);
            return (
              <li className="item-row" key={member.id}>
                <div className="item-head static">
                  <span className="chevron" />
                  <Icon src={unitIcon(member.id)} size={22} className="portrait" reserve />
                  <span className="item-name">{member.name}</span>
                  <span className="row-tail muted small">
                    {rarityLabel(effect.rarity.from)} → {rarityLabel(effect.rarity.to)}
                    {effect.rank.from !== effect.rank.to &&
                      ` · ${localRank(effect.rank.from)} → ${localRank(effect.rank.to)}`}
                    {effect.xpLevel.from !== effect.xpLevel.to &&
                      t('td.capLevel', { from: effect.xpLevel.from, to: effect.xpLevel.to })}
                    {effect.items.length > 0 &&
                      tn(effect.items.length, 'td.capItems', 'td.capItemsPlural')}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * The node's own numbers.
 *
 * Campaign nodes carry no required or forbidden units — the game imposes none —
 * so "fill the squad" is a recommendation from the enemies' armour and health,
 * not a roster the data handed over.
 */
function BattlePanel({ brief, onFill }: { brief: BattleBrief; onFill: () => void }) {
  return (
    <>
      <div className="row wrap" style={{ marginTop: 12, marginBottom: 8 }}>
        <Icon src={campaignIcon(brief.battle.campaignId)} size={24} className="portrait" reserve />
        <b>
          {brief.campaignName} node {brief.battle.nodeNumber}
        </b>
        <span className="chip">{brief.slots} slots</span>
        <span className="chip">{brief.enemyCount} enemies</span>
        <span className="chip">
                {t('td.totalHpValue', { n: localNumber(brief.enemyHealth) })}
              </span>
        <span className="chip">
                {t('td.meanArmourValue', { n: brief.meanEnemyArmour.toFixed(0) })}
              </span>
        {brief.enemyFactions.map((faction) => (
          <span className="chip" key={faction}>
            {faction}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={onFill}>{t('td.fillFromNode')}</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {t('td.nodeBlurb')}
      </p>
    </>
  );
}

function MemberRow({
  member,
  brief,
  assignments,
  onRemove,
}: {
  member: RosterUnit;
  brief: BattleBrief | undefined;
  assignments: Assignment[];
  onRemove: () => void;
}) {
  return (
    <li className="item-row">
      <div className="item-head static">
        <span className="chevron" />
        <Icon src={unitIcon(member.id)} size={30} className="portrait" reserve />
        <span className="item-name">
          <Link to={`/units/${encodeURIComponent(member.id)}`}>{member.name}</Link>
          <span className="muted small">
            {' · '}
            {localRank(member.effective.rank)}
          </span>
        </span>
        <span className="row-tail">
          <span className="row-icons">
            <Icon src={rarityIcon(member.stats?.rarity)} size={16} />
            <Icon src={rankIcon(member.effective.rank)} size={18} reserve />
          </span>
          <span className="muted small">
            {t('td.memberStats', {
              hp: localNumber(member.stats?.health ?? 0),
              dmg: localNumber(member.stats?.damage ?? 0),
              armour: localNumber(member.stats?.armour ?? 0),
            })}
          </span>
          {!brief && (
            <span className="muted small" title={t('td.throughHint')}>
              {Math.round(member.normalEffectiveDamage)} /{' '}
              {Math.round(member.abilityEffectiveDamage)}
            </span>
          )}
          {brief && (
            <>
              <span className="chip ok-chip" title={t('teams.nodeNormalHint')}>
                {Math.round(brief.normalDamageAgainst(member))} normal
              </span>
              <span
                className="chip slot-active"
                title={t('teams.nodeAbilityHint')}
              >
                {Math.round(brief.abilityDamageAgainst(member))} ability
              </span>
            </>
          )}
          {member.isCapped && <span className="chip caution">capped</span>}
          <button className="small" onClick={onRemove}>
            Remove
          </button>
        </span>
      </div>
      {assignments.length > 0 && (
        <ul className="item-list nested">
          {assignments.map((a) => (
            <li className="item-row" key={`${a.slotId}:${a.item.id}`}>
              <div className="item-head static">
                <span className="chevron" />
                <Icon
                  src={requirementIcon(`upgrade:${a.item.id}`)}
                  size={22}
                  className="portrait"
                  reserve
                />
                <span className="item-name">
                  {a.item.name}
                  <span className="muted small">
                    {' '}
                    lv {a.item.level} · {a.slotId}
                    {a.replaces && t('td.replacing', { name: a.replaces.name, level: a.replaces.level })}
                  </span>
                </span>
                <span className="row-tail">
                  <span className="chip ok-chip">+{Math.round(a.gain).toLocaleString()}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function LayoutTable({
  layout,
  db,
  roster,
}: {
  layout: Assignment[];
  db: GameDatabase;
  roster: RosterUnit[];
}) {
  const nameOf = (id: string) => roster.find((u) => u.id === id)?.name ?? id;
  return (
    <div className="table-wrap">
      <table className="steps stacked">
        <thead>
          <tr>
            <th>{t('common.unit')}</th>
            <th>{t('td.slot')}</th>
            <th>{t('td.equip')}</th>
            <th>{t('td.insteadOf')}</th>
            <th style={{ textAlign: 'right' }}>{t('td.gain')}</th>
            <th>{t('td.currentlyOn')}</th>
          </tr>
        </thead>
        <tbody>
          {layout.map((a) => (
            <tr key={`${a.unitId}:${a.slotId}`}>
              <td data-label="" className="card-title-cell">
                <b>{nameOf(a.unitId)}</b>
              </td>
              <td data-label={t('td.slot')} className="muted">
                {humanise(db.items[a.item.id]?.itemType ?? a.slotId)}
              </td>
              <td data-label={t('td.equip')}>
                {a.item.name} <span className="muted">lv {a.item.level}</span>
              </td>
              <td data-label={t('td.insteadOf')} className="muted">
                {a.replaces ? `${a.replaces.name} lv ${a.replaces.level}` : 'nothing'}
              </td>
              <td data-label={t('td.gain')} style={{ textAlign: 'right' }}>
                +{Math.round(a.gain).toLocaleString()}
              </td>
              <td data-label={t('td.currentlyOn')} className="muted">
                {a.item.wornBy ? nameOf(a.item.wornBy) : 'inventory'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
