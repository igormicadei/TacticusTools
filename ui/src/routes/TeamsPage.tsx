import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { rankName, Rarity } from '@lib/gamedata/enums.js';
import {
  BattleBrief,
  RarityCeiling,
  RosterQuery,
  RosterUnit,
  Team,
  buildRosterUnits,
  type SortKey,
  type UnitFilter,
} from '@lib/gamedata/teams.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { Icon, useIcons } from '../components/Icon.tsx';
import { factionIcon, rankIcon, rarityIcon, unitIcon } from '../data/icons.ts';
import { teamsStore, type StoredTeam } from '../data/teams.ts';
import { localRarity } from '../i18n/game.ts';
import { t, type StringKey } from '../i18n/locale.ts';

const SORTS: { key: SortKey; label: StringKey }[] = [
  { key: 'effectiveNormal', label: 'teams.sort.effectiveNormal' },
  { key: 'effectiveAbility', label: 'teams.sort.effectiveAbility' },
  { key: 'effective', label: 'teams.sort.effective' },
  { key: 'damage', label: 'teams.sort.damage' },
  { key: 'health', label: 'teams.sort.health' },
  { key: 'armour', label: 'teams.sort.armour' },
  { key: 'rank', label: 'common.rank' },
  { key: 'name', label: 'common.name' },
];

const RARITIES: Rarity[] = [
  Rarity.Common,
  Rarity.Uncommon,
  Rarity.Rare,
  Rarity.Epic,
  Rarity.Legendary,
  Rarity.Mythic,
];

export function TeamsPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const navigate = useNavigate();
  const [teams, setTeams] = useState(() => teamsStore.list());

  const roster = useMemo(() => buildRosterUnits(player, db), [player, db]);

  const create = () => {
    const created = teamsStore.create({ name: t('teams.newName'), memberIds: [] });
    setTeams(teamsStore.list());
    navigate(`/teams/${created.id}`);
  };

  const remove = (id: string) => {
    teamsStore.remove(id);
    setTeams(teamsStore.list());
  };

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('teams.heading')}</h1>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={create}>
          {t('teams.new')}
        </button>
      </div>

      {teams.length === 0 ? (
        <div className="empty">{t('teams.none')}</div>
      ) : (
        <div className="grid">
          {teams.map((stored) => (
            <TeamCard
              key={stored.id}
              stored={stored}
              roster={roster}
              db={db}
              onDelete={() => remove(stored.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function TeamCard({
  stored,
  roster,
  db,
  onDelete,
}: {
  stored: StoredTeam;
  roster: RosterUnit[];
  db: GameDatabase;
  onDelete: () => void;
}) {
  // The card shows the team as it would actually be played, so a capped team
  // reports its capped figures rather than the roster's headline ones.
  const team = new Team(stored.id, stored.name, stored.memberIds, stored.capRarity);
  const members = useMemo(() => {
    const cap =
      stored.capRarity !== undefined ? new RarityCeiling(stored.capRarity, db) : undefined;
    const pool = cap ? roster.map((unit) => new RosterUnit(unit.unit, db, cap)) : roster;
    return team.members(pool);
  }, [roster, db, stored.capRarity, stored.memberIds.join(',')]);
  const totals = team.totals(members);

  return (
    <div
      className="card"
      style={{ '--status': 'var(--status-unlockable)' } as React.CSSProperties}
    >
      <Link to={`/teams/${stored.id}`}>
        <div className="name">{stored.name || t('teams.untitled')}</div>
        <div className="sub">
          {members.length} unit{members.length === 1 ? '' : 's'}
          {stored.capRarity !== undefined && t('teams.cappedTo', { rarity: localRarity(stored.capRarity) })}
        </div>
        <div className="row wrap" style={{ marginTop: 8, gap: 4 }}>
          {members.map((member) => (
            <Icon
              key={member.id}
              src={unitIcon(member.id)}
              size={30}
              className="portrait"
              title={member.name}
              reserve
            />
          ))}
        </div>
        {members.length > 0 && (
          <div className="meta">
            <span className="chip">{totals.health.toLocaleString()} HP</span>
            <span className="chip">{totals.damage.toLocaleString()} dmg</span>
            <span className="chip">{totals.armour.toLocaleString()} armour</span>
          </div>
        )}
      </Link>
      <div className="row" style={{ marginTop: 10 }}>
        <Link className="button small" to={`/teams/${stored.id}`}>
          Open
        </Link>
        <button className="danger small" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The roster picker, reused by the detail page                               */
/* -------------------------------------------------------------------------- */

export function RosterPicker({
  roster,
  selected,
  onToggle,
  brief,
}: {
  roster: RosterUnit[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  brief?: BattleBrief | undefined;
}) {
  useIcons();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('effectiveNormal');
  const [factions, setFactions] = useState<string[]>([]);
  const [rarities, setRarities] = useState<Rarity[]>([]);
  const [minRank, setMinRank] = useState<number | undefined>();
  const [damageTypes, setDamageTypes] = useState<string[]>([]);
  const [traits, setTraits] = useState<string[]>([]);

  // Derived from the roster rather than the whole game, so the pickers only
  // ever offer values that would actually match something.
  const options = useMemo(() => {
    const collect = (pick: (u: RosterUnit) => readonly string[]) =>
      [...new Set(roster.flatMap((u) => pick(u)))].sort();
    return {
      factions: collect((u) => [u.factionId]),
      damageTypes: collect((u) => u.damageTypes),
      traits: collect((u) => u.traits),
    };
  }, [roster]);

  const filter: UnitFilter = {
    ...(query ? { query } : {}),
    ...(factions.length ? { factions } : {}),
    ...(rarities.length ? { rarities } : {}),
    ...(minRank !== undefined ? { minRank: minRank as never } : {}),
    ...(damageTypes.length ? { damageTypes } : {}),
    ...(traits.length ? { traits } : {}),
  };
  const rows = useMemo(
    () => new RosterQuery(filter, sort, true).run(roster),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster, sort, query, factions, rarities, minRank, damageTypes, traits],
  );

  const toggleIn = <T,>(list: T[], value: T, set: (next: T[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <section className="panel">
      <h3>{t('teams.chooseUnits')}</h3>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <input
          className="search"
          placeholder={t('teams.searchUnits')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="inline-field">
          <span>{t('teams.sortBy')}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {t(s.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span>{t('teams.minRank')}</span>
          <select
            value={minRank ?? ''}
            onChange={(e) => setMinRank(e.target.value === '' ? undefined : Number(e.target.value))}
          >
            <option value="">{t('teams.any')}</option>
            {Array.from({ length: 20 }, (_, rank) => (
              <option key={rank} value={rank}>
                {rankName(rank)}
              </option>
            ))}
          </select>
        </label>
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          {rows.length} of {roster.length}
        </span>
      </div>

      <ChipFilter
        label={t('common.rarity')}
        options={RARITIES.map((r) => ({ value: String(r), label: localRarity(r) }))}
        selected={rarities.map(String)}
        onToggle={(value) => toggleIn(rarities, Number(value) as Rarity, setRarities)}
      />
      <ChipFilter
        label={t('teams.faction')}
        options={options.factions.map((f) => ({ value: f, label: humanise(f) }))}
        selected={factions}
        onToggle={(value) => toggleIn(factions, value, setFactions)}
      />
      <ChipFilter
        label={t('teams.damageType')}
        options={options.damageTypes.map((d) => ({ value: d, label: humanise(d) }))}
        selected={damageTypes}
        onToggle={(value) => toggleIn(damageTypes, value, setDamageTypes)}
      />
      <ChipFilter
        label={t('teams.trait')}
        options={options.traits.map((t) => ({ value: t, label: humanise(t) }))}
        selected={traits}
        onToggle={(value) => toggleIn(traits, value, setTraits)}
      />

      {rows.length === 0 ? (
        <div className="empty">{t('teams.noMatch')}</div>
      ) : (
        <div className="table-wrap">
        <table className="steps split-head stacked">
          <thead>
            <tr>
              <th rowSpan={2} />
              <th rowSpan={2}>{t('common.unit')}</th>
              <th rowSpan={2}>{t('common.rank')}</th>
              <th rowSpan={2} style={{ textAlign: 'right' }}>
                Health
              </th>
              <th rowSpan={2} style={{ textAlign: 'right' }}>
                Attack
              </th>
              <th rowSpan={2} style={{ textAlign: 'right' }}>
                Armour
              </th>
              <th colSpan={2} style={{ textAlign: 'center' }}>
                Through armour
              </th>
              {brief && (
                <th colSpan={2} style={{ textAlign: 'center' }}>
                  On this node
                </th>
              )}
            </tr>
            <tr>
              {/* An active ability usually fires once a battle, so its damage
                  is an opening rather than a rate. Averaging it in with the
                  weapon hid exactly the difference that decides a pick. */}
              <th style={{ textAlign: 'right' }} title={t('teams.normalHint')}>
                Normal
              </th>
              <th style={{ textAlign: 'right' }} title={t('teams.abilityHint')}>
                Ability
              </th>
              {brief && (
                <>
                  <th style={{ textAlign: 'right' }} title={t('teams.nodeNormalHint')}>
                    Normal
                  </th>
                  <th style={{ textAlign: 'right' }} title={t('teams.nodeAbilityHint')}>
                    Ability
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((unit) => (
              <tr key={unit.id} className={selected.has(unit.id) ? 'picked' : ''}>
                <td data-label="" className="pick-cell">
                  <input
                    type="checkbox"
                    checked={selected.has(unit.id)}
                    onChange={() => onToggle(unit.id)}
                    aria-label={`Add ${unit.name}`}
                  />
                </td>
                <td data-label="" className="card-title-cell">
                  <span className="row" style={{ gap: 8 }}>
                    <Icon src={unitIcon(unit.id)} size={26} className="portrait" reserve />
                    <Link to={`/units/${encodeURIComponent(unit.id)}`}>{unit.name}</Link>
                    <Icon src={factionIcon(unit.factionId)} size={14} className="crest" />
                    {unit.isCapped && (
                      <span className="chip caution" title={t('teams.cappedHint')}>
                        capped
                      </span>
                    )}
                  </span>
                </td>
                <td data-label={t('common.rank')}>
                  <span className="row" style={{ gap: 6 }}>
                    <Icon src={rankIcon(unit.effective.rank)} size={16} reserve />
                    {rankName(unit.effective.rank)}
                    <Icon src={rarityIcon(unit.stats?.rarity)} size={14} />
                  </span>
                </td>
                <td data-label={t('common.health')} style={{ textAlign: 'right' }}>
                  {unit.stats?.health.toLocaleString() ?? '—'}
                </td>
                <td data-label={t('teams.attack')} style={{ textAlign: 'right' }}>
                  {unit.stats?.damage.toLocaleString() ?? '—'}
                </td>
                <td data-label={t('common.armour')} style={{ textAlign: 'right' }}>
                  {unit.stats?.armour.toLocaleString() ?? '—'}
                </td>
                <td data-label={t('teams.throughNormal')} style={{ textAlign: 'right' }}>
                  {Math.round(unit.normalEffectiveDamage) || '—'}
                </td>
                <td
                  data-label={t('teams.throughAbility')}
                  style={{ textAlign: 'right' }}
                  className="ability-figure"
                >
                  {Math.round(unit.abilityEffectiveDamage) || '—'}
                </td>
                {brief && (
                  <>
                    <td data-label={t('teams.nodeNormal')} style={{ textAlign: 'right' }}>
                      <b>{Math.round(brief.normalDamageAgainst(unit)) || '—'}</b>
                    </td>
                    <td
                      data-label={t('teams.nodeAbility')}
                      style={{ textAlign: 'right' }}
                      className="ability-figure"
                    >
                      <b>{Math.round(brief.abilityDamageAgainst(unit)) || '—'}</b>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}

function ChipFilter({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Long lists collapse: 22 factions and 32 traits at once is a wall, and the
  // ones already chosen are the ones worth keeping on screen.
  const shown = open ? options : options.filter((o) => selected.includes(o.value)).concat(
    options.filter((o) => !selected.includes(o.value)).slice(0, 8),
  );

  return (
    <div className="chip-filter">
      <span className="chip-filter-label">{label}</span>
      {shown.map((option) => (
        <button
          key={option.value}
          className={`chip toggle${selected.includes(option.value) ? ' on' : ''}`}
          onClick={() => onToggle(option.value)}
        >
          {option.label}
        </button>
      ))}
      {options.length > shown.length && (
        <button className="chip toggle" onClick={() => setOpen(true)}>
          +{options.length - shown.length} more
        </button>
      )}
      {open && options.length > 8 && (
        <button className="chip toggle" onClick={() => setOpen(false)}>
          Show fewer
        </button>
      )}
    </div>
  );
}

/** `AdeptusMechanicus` / `HeavyRound` -> `Adeptus Mechanicus` / `Heavy Round`. */
export function humanise(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}
