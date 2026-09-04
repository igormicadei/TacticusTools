import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { rankName, rarityName, Rarity } from '@lib/gamedata/enums.js';
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

const RARITIES: Rarity[] = [
  Rarity.Common,
  Rarity.Uncommon,
  Rarity.Rare,
  Rarity.Epic,
  Rarity.Legendary,
  Rarity.Mythic,
];

const OBJECTIVES: { key: Objective; label: string; hint: string }[] = [
  { key: 'defence', label: 'Survive', hint: 'Health, plus what armour and Block save over ten hits' },
  { key: 'offence', label: 'Hit hardest', hint: 'Damage per attack with crits folded in at their odds' },
  { key: 'health', label: 'Health only', hint: 'Raw health, ignoring armour and Block' },
  { key: 'armour', label: 'Armour only', hint: 'Raw armour' },
];

const SCOPES: { key: PoolScope; label: string; hint: string }[] = [
  { key: 'team', label: "The team's own gear", hint: 'Shuffle only what these units already wear' },
  {
    key: 'team+inventory',
    label: 'Team gear + inventory',
    hint: "The team's gear plus everything unequipped",
  },
  { key: 'all', label: 'Everything I own', hint: 'Including gear worn by units outside the team' },
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
          ← All teams
        </Link>
        <div className="empty">That team no longer exists.</div>
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
        ← All teams
      </Link>

      <div className="detail-head">
        <div>
          <h1>
            <input
              className="title-input"
              value={stored.name}
              onChange={(e) => save({ name: e.target.value })}
              aria-label="Team name"
            />
          </h1>
          <div className="muted">
            {members.length} unit{members.length === 1 ? '' : 's'}
            {cap && ` · played at ${cap.name}`}
            {brief && ` · ${brief.campaignName} node ${brief.battle.nodeNumber}`}
          </div>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h3>Conditions</h3>
        <div className="form-grid">
          <label>
            <span>Rarity cap</span>
            <select
              value={stored.capRarity ?? ''}
              onChange={(e) =>
                save({ capRarity: e.target.value === '' ? undefined : (Number(e.target.value) as Rarity) })
              }
            >
              <option value="">Uncapped</option>
              {RARITIES.map((rarity) => (
                <option key={rarity} value={rarity}>
                  {rarityName(rarity)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Battle</span>
            <select
              value={stored.battleKey ?? ''}
              onChange={(e) => save({ battleKey: e.target.value || undefined })}
            >
              <option value="">No node</option>
              {battles.map((b) => (
                <option key={b.battle.key} value={b.battle.key}>
                  {b.campaignName} — node {b.battle.nodeNumber} ({b.slots} slots)
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
          <h3>The squad</h3>
          <div className="stat-grid" style={{ marginBottom: 12 }}>
            <Stat label="Health" value={totals.health} />
            <Stat label="Attack" value={totals.damage} />
            <Stat label="Armour" value={totals.armour} />
            <Stat label="Through armour" value={Math.round(totals.effective)} />
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
        <h3>Optimise equipment</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Equipment grants Crit and Block far more often than Health or Armour — 626 item levels
          carry Crit Chance against 215 carrying Health — so an objective that read only the
          headline stats would rate almost every Crit item as worthless. “Survive” and “Hit
          hardest” fold Block and Crit in at their own odds; the other two are the raw stat, for
          when that is what you actually want.
        </p>
        <div className="form-grid">
          <label>
            <span>Optimise for</span>
            <select value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
              {OBJECTIVES.map((o) => (
                <option key={o.key} value={o.key} title={o.hint}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Drawing from</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as PoolScope)}>
              {SCOPES.map((s) => (
                <option key={s.key} value={s.key} title={s.hint}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <button className="primary" onClick={optimiseItems} disabled={members.length === 0}>
            Work out a layout
          </button>
          {layout && (
            <button className="small" onClick={() => setLayout(undefined)}>
              Clear
            </button>
          )}
          {layout && (
            <span className="muted small">
              {layout.length === 0
                ? 'Nothing in that pool beats what they already wear.'
                : `${layout.length} swap${layout.length === 1 ? '' : 's'} — shown against each unit below.`}
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
  return rarity === undefined ? 'unknown' : rarityName(rarity);
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
        A {cap.name} cap holds every unit to level {cap.levelCap} and {rankName(cap.rankCap)},
        drops stars to the last of that rarity, and swaps equipment above the cap for its own
        series’ member at {cap.name} — a Bolt Pistol chain runs Standard-Issue → Battle-Hardened →
        Sanctified → Master-Crafted → Artificer, and the cap takes the {cap.name} link at its top
        level. Nothing is ever raised: a unit already below the cap is untouched.
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
                  <span className="muted small">
                    {rarityLabel(effect.rarity.from)} → {rarityLabel(effect.rarity.to)}
                    {effect.rank.from !== effect.rank.to &&
                      ` · ${rankName(effect.rank.from)} → ${rankName(effect.rank.to)}`}
                    {effect.xpLevel.from !== effect.xpLevel.to &&
                      ` · level ${effect.xpLevel.from} → ${effect.xpLevel.to}`}
                    {effect.items.length > 0 &&
                      ` · ${effect.items.length} item${effect.items.length === 1 ? '' : 's'} scaled`}
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
        <span className="chip">{brief.enemyHealth.toLocaleString()} total HP</span>
        <span className="chip">{brief.meanEnemyArmour.toFixed(0)} mean armour</span>
        {brief.enemyFactions.map((faction) => (
          <span className="chip" key={faction}>
            {faction}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={onFill}>Fill the squad from this node</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Campaign nodes name no required units — the game does not restrict who you deploy — so
        this picks the {brief.slots} that land the most through this board’s armour while
        surviving it. The “on this node” column in the picker is each unit’s damage after these
        enemies’ armour, which is why a Psychic attacker outranks a bigger Physical one here.
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
            {rankName(member.effective.rank)}
          </span>
        </span>
        <Icon src={rarityIcon(member.stats?.rarity)} size={16} />
        <Icon src={rankIcon(member.effective.rank)} size={18} reserve />
        <span className="muted small">
          {member.stats?.health.toLocaleString()} HP · {member.stats?.damage.toLocaleString()} dmg ·{' '}
          {member.stats?.armour.toLocaleString()} armour
        </span>
        {brief && (
          <span className="chip ok-chip">
            {Math.round(brief.damageAgainst(member))} through armour
          </span>
        )}
        {member.isCapped && <span className="chip caution">capped</span>}
        <button className="small" onClick={onRemove}>
          Remove
        </button>
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
                    {a.replaces && ` · replacing ${a.replaces.name} lv ${a.replaces.level}`}
                  </span>
                </span>
                <span className="chip ok-chip">+{Math.round(a.gain).toLocaleString()}</span>
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
    <table className="steps">
      <thead>
        <tr>
          <th>Unit</th>
          <th>Slot</th>
          <th>Equip</th>
          <th>Instead of</th>
          <th style={{ textAlign: 'right' }}>Gain</th>
          <th>Currently on</th>
        </tr>
      </thead>
      <tbody>
        {layout.map((a) => (
          <tr key={`${a.unitId}:${a.slotId}`}>
            <td>{nameOf(a.unitId)}</td>
            <td className="muted">{humanise(db.items[a.item.id]?.itemType ?? a.slotId)}</td>
            <td>
              {a.item.name} <span className="muted">lv {a.item.level}</span>
            </td>
            <td className="muted">
              {a.replaces ? `${a.replaces.name} lv ${a.replaces.level}` : 'nothing'}
            </td>
            <td style={{ textAlign: 'right' }}>+{Math.round(a.gain).toLocaleString()}</td>
            <td className="muted">
              {a.item.wornBy ? nameOf(a.item.wornBy) : 'inventory'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
