import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  currentState,
  markProgress,
  resolvePlan,
  type PlanStep,
  type PlanStepKind,
} from '@lib/gamedata/plan.js';
import {
  allocateHoldings,
  farmTargets,
  ownedByKey,
  planCosts,
  type AllocatedItem,
  type FarmTarget,
} from '@lib/gamedata/requirements.js';
import { battleLevelOf, campaignFamily, isMirrorType, type BattleLevel } from '@lib/gamedata/teams.js';
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { Icon, useIcons } from '../components/Icon.tsx';
import { ItemRow, toggleOpen } from '../components/StepItems.tsx';
import { unitIcon } from '../data/icons.ts';
import { plansStore } from '../data/plans.ts';
import { localCampaignType, localStepLabel } from '../i18n/game.ts';
import { t } from '../i18n/locale.ts';

/** Every kind a step can be, in the order they read best as filter chips. */
const KIND_ORDER: readonly PlanStepKind[] = ['rank', 'level', 'ability', 'ascension', 'promotion'];

/** Same three-level order the team picker offers, for the same reason. */
const LEVEL_ORDER: readonly BattleLevel[] = ['Standard', 'Elite', 'Extremis'];

/** A campaign, pulled apart into the same three axes the game's own screen
 * and the team picker use — see `BattlePicker` in `TeamDetailPage.tsx`. */
interface CampaignOption {
  campaignId: string;
  family: string;
  mirror: boolean;
  level: BattleLevel;
}

interface StepRow {
  planId: string;
  unitId: string;
  unitName: string;
  kind: PlanStepKind;
  step: PlanStep;
  items: AllocatedItem[];
  /** Where each item's shortfall can be farmed, keyed by the item's own key. */
  targetsByItem: Map<string, FarmTarget[]>;
}

/**
 * Every plan's immediate next step, in one list — the same figure each Plans
 * card already shows under "Next step", collected across the whole roster so
 * a farming session can be planned campaign-first instead of unit-first.
 *
 * Filtering by step type answers "what kind of work is left"; filtering by
 * campaign answers the question a player standing at a campaign screen
 * actually asks — "of what I still need, what does *this* place drop" —
 * which is why picking a campaign narrows the item list inside a row rather
 * than only deciding whether the row shows at all.
 */
export function NextStepsPage({ db, player }: { db: GameDatabase; player: PlayerResponse }) {
  useIcons();
  const [kinds, setKinds] = useState<ReadonlySet<PlanStepKind>>(() => new Set());
  const [family, setFamily] = useState('');
  const [mirror, setMirror] = useState(false);
  const [level, setLevel] = useState<BattleLevel>('Standard');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) => setOpen((current) => toggleOpen(current, id));

  const stored = useMemo(() => plansStore.list(), []);

  const rows = useMemo<StepRow[]>(() => {
    const out: StepRow[] = [];
    for (const saved of stored) {
      const unit = player.player.units.find((u) => u.id === saved.unitId);
      if (!unit) continue;
      const plan = markProgress(
        resolvePlan(unit, saved.target, db, saved.origin),
        currentState(unit, db),
      );
      const next = plan.steps.find((step) => !step.done);
      if (!next) continue;

      // Priced exactly as the plan's own "Next step" card prices it — the
      // one step, against the player's current holdings.
      const costs = planCosts(unit, { ...plan, steps: [next] }, db);
      const owned = ownedByKey(player, db);
      const allocated = allocateHoldings(costs, owned, db);
      const items = (allocated[0]?.items ?? []).filter(
        (item) => !item.applied && item.missing > 0,
      );

      const targetsByItem = new Map<string, FarmTarget[]>();
      for (const item of items) {
        targetsByItem.set(
          item.key,
          farmTargets(
            {
              kind: item.kind,
              key: item.key,
              name: item.name,
              ...(item.rarity !== undefined ? { rarity: item.rarity } : {}),
            },
            item.missing,
            db,
            player,
          ),
        );
      }

      out.push({
        planId: saved.id,
        unitId: unit.id,
        unitName: saved.name || unit.name || unit.id,
        kind: next.kind,
        step: next,
        items,
        targetsByItem,
      });
    }
    return out;
  }, [stored, player, db]);

  const presentKinds = useMemo(() => {
    const seen = new Set(rows.map((row) => row.kind));
    return KIND_ORDER.filter((kind) => seen.has(kind));
  }, [rows]);

  const kindFiltered = useMemo(
    () => rows.filter((row) => kinds.size === 0 || kinds.has(row.kind)),
    [rows, kinds],
  );

  // Campaigns worth offering as a filter: only ones something outstanding —
  // under the step-type filter already chosen — actually drops in. Pulled
  // apart into campaign/side/difficulty, the same three axes the team
  // picker offers, rather than one flat list of "Fall of Cadia Mirror Elite"
  // style names.
  const campaignOptions = useMemo(() => {
    const map = new Map<string, CampaignOption>();
    for (const row of kindFiltered) {
      for (const item of row.items) {
        for (const target of row.targetsByItem.get(item.key) ?? []) {
          for (const node of target.nodes) {
            if (map.has(node.campaignId)) continue;
            const campaign = db.campaigns[node.campaignId];
            // The raw db name, not `node.campaignName`: that one already has a
            // " Standard"/" Elite" disambiguator appended for two campaigns
            // that would otherwise share a display name (see `nodeStatuses`),
            // which `campaignFamily` does not know to strip back off — the
            // same reason the team picker (`BattleBrief.all`) reads the name
            // straight off `db.campaigns` rather than through that helper.
            map.set(node.campaignId, {
              campaignId: node.campaignId,
              family: campaignFamily(campaign?.name ?? node.campaignId),
              mirror: isMirrorType(campaign?.type),
              level: battleLevelOf(campaign?.type),
            });
          }
        }
      }
    }
    return [...map.values()];
  }, [kindFiltered, db]);

  const families = useMemo(
    () => [...new Set(campaignOptions.map((o) => o.family))].sort((a, b) => a.localeCompare(b)),
    [campaignOptions],
  );
  const inFamily = useMemo(
    () => campaignOptions.filter((o) => o.family === family),
    [campaignOptions, family],
  );
  const sides = useMemo(() => [...new Set(inFamily.map((o) => o.mirror))].sort(), [inFamily]);
  const onSide = useMemo(() => inFamily.filter((o) => o.mirror === mirror), [inFamily, mirror]);
  const levels = useMemo(
    () => LEVEL_ORDER.filter((l) => onSide.some((o) => o.level === l)),
    [onSide],
  );
  const campaignIds = useMemo(
    () => new Set(onSide.filter((o) => o.level === level).map((o) => o.campaignId)),
    [onSide, level],
  );

  // The previous step-type filter can drop the campaign currently picked
  // right out of the option list; fall back to "no campaign" rather than
  // leave the selects sitting on a combination with nothing behind it.
  useEffect(() => {
    if (family && !families.includes(family)) {
      setFamily('');
      setMirror(false);
      setLevel('Standard');
    }
  }, [family, families]);

  const visible = useMemo(() => {
    return kindFiltered
      .map((row) => {
        if (!family) return row;
        const items = row.items.filter((item) =>
          (row.targetsByItem.get(item.key) ?? []).some((target) =>
            target.nodes.some((node) => campaignIds.has(node.campaignId)),
          ),
        );
        return { ...row, items };
      })
      .filter((row) => !family || row.items.length > 0);
  }, [kindFiltered, family, campaignIds]);

  const toggleKind = (kind: PlanStepKind) =>
    setKinds((current) => {
      const next = new Set(current);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });

  /** Re-point side/difficulty at a combination the new campaign actually has,
   * the same way `BattlePicker` keeps its own three selects in step. */
  const chooseFamily = (nextFamily: string) => {
    const pool = campaignOptions.filter((o) => o.family === nextFamily);
    const nextMirror = pool.some((o) => o.mirror === mirror) ? mirror : (pool[0]?.mirror ?? false);
    const onThatSide = pool.filter((o) => o.mirror === nextMirror);
    const nextLevel = onThatSide.some((o) => o.level === level)
      ? level
      : (LEVEL_ORDER.find((l) => onThatSide.some((o) => o.level === l)) ?? 'Standard');
    setFamily(nextFamily);
    setMirror(nextMirror);
    setLevel(nextLevel);
  };
  const chooseMirror = (nextMirror: boolean) => {
    const onThatSide = inFamily.filter((o) => o.mirror === nextMirror);
    const nextLevel = onThatSide.some((o) => o.level === level)
      ? level
      : (LEVEL_ORDER.find((l) => onThatSide.some((o) => o.level === l)) ?? 'Standard');
    setMirror(nextMirror);
    setLevel(nextLevel);
  };

  if (stored.length === 0) {
    return (
      <>
        <Link to="/plans" className="back">
          {t('nav.backPlans')}
        </Link>
        <div className="empty">{t('nextSteps.none')}</div>
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
          <h1>{t('nextSteps.heading')}</h1>
          <div className="muted">{t('nextSteps.acrossUnits', { n: rows.length })}</div>
        </div>
      </div>

      {(presentKinds.length > 0 || families.length > 0) && (
        <section className="panel" style={{ marginBottom: 16 }}>
          {presentKinds.length > 0 && (
            <>
              <h3 style={{ marginTop: 0 }}>{t('nextSteps.filterByType')}</h3>
              <div className="counts" style={{ marginBottom: families.length > 0 ? 16 : 0 }}>
                {presentKinds.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`count filterable${kinds.has(kind) ? ' active' : ''}`}
                    onClick={() => toggleKind(kind)}
                  >
                    {t(`nextSteps.kind.${kind}`)}
                  </button>
                ))}
              </div>
            </>
          )}

          {families.length > 0 && (
            <>
              <h3 style={{ marginTop: 0 }}>{t('nextSteps.filterByCampaign')}</h3>
              <p className="small muted" style={{ marginTop: 0 }}>{t('nextSteps.campaignBlurb')}</p>
              <div className="form-grid">
                <label>
                  <span>{t('td.campaign')}</span>
                  <select value={family} onChange={(e) => chooseFamily(e.target.value)}>
                    <option value="">{t('td.noCampaign')}</option>
                    {families.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t('td.side')}</span>
                  <select
                    value={mirror ? 'mirror' : 'standard'}
                    onChange={(e) => chooseMirror(e.target.value === 'mirror')}
                    disabled={!family || sides.length < 2}
                  >
                    {(sides.length > 0 ? sides : [false]).map((isMirror) => (
                      <option key={String(isMirror)} value={isMirror ? 'mirror' : 'standard'}>
                        {isMirror ? localCampaignType('Mirror') : localCampaignType('Standard')}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t('td.level')}</span>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value as BattleLevel)}
                    disabled={!family || levels.length < 2}
                  >
                    {(levels.length > 0 ? levels : LEVEL_ORDER.slice(0, 1)).map((l) => (
                      <option key={l} value={l}>
                        {localCampaignType(l)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}
        </section>
      )}

      {visible.length === 0 ? (
        <div className="empty">
          {rows.length === 0 ? t('nextSteps.allDone') : t('nextSteps.noMatch')}
        </div>
      ) : (
        <section className="panel">
          {visible.map((row) => (
            <div className="step-block" key={row.planId}>
              <div className="step-block-head">
                <Icon src={unitIcon(row.unitId)} size={28} className="portrait" reserve />
                <Link to={`/plans/${row.planId}`}>{row.unitName}</Link>
                <span className="muted small">{localStepLabel(row.step)}</span>
              </div>
              {row.items.length === 0 ? (
                <p className="muted small" style={{ margin: '4px 0 0 30px' }}>
                  {t('si.allApplied')}
                </p>
              ) : (
                <ul className="item-list">
                  {row.items.map((item) => (
                    <ItemRow
                      key={`${row.planId}:${item.key}`}
                      id={`${row.planId}:${item.key}`}
                      item={item}
                      db={db}
                      player={player}
                      open={open}
                      onToggle={toggle}
                    />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
