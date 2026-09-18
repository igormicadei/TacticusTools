import { useMemo, useState } from 'react';
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
import type { GameDatabase } from '@lib/gamedata/types.js';
import type { PlayerResponse } from '@lib/types/player.js';

import { Icon, useIcons } from '../components/Icon.tsx';
import { ItemRow, toggleOpen } from '../components/StepItems.tsx';
import { campaignIcon, unitIcon } from '../data/icons.ts';
import { plansStore } from '../data/plans.ts';
import { localStepLabel } from '../i18n/game.ts';
import { t } from '../i18n/locale.ts';

/** Every kind a step can be, in the order they read best as filter chips. */
const KIND_ORDER: readonly PlanStepKind[] = ['rank', 'level', 'ability', 'ascension', 'promotion'];

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
  const [campaigns, setCampaigns] = useState<ReadonlySet<string>>(() => new Set());
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
  // under the step-type filter already chosen — actually drops in. Counted
  // once per item, not once per node, so a material with several nodes in
  // the same campaign does not inflate the number beside it.
  const availableCampaigns = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const row of kindFiltered) {
      for (const item of row.items) {
        const seenForItem = new Set<string>();
        for (const target of row.targetsByItem.get(item.key) ?? []) {
          for (const node of target.nodes) {
            if (seenForItem.has(node.campaignId)) continue;
            seenForItem.add(node.campaignId);
            const entry = map.get(node.campaignId) ?? { name: node.campaignName, count: 0 };
            entry.count += 1;
            map.set(node.campaignId, entry);
          }
        }
      }
    }
    return [...map.entries()].sort(
      (a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name),
    );
  }, [kindFiltered]);

  const visible = useMemo(() => {
    return kindFiltered
      .map((row) => {
        if (campaigns.size === 0) return row;
        const items = row.items.filter((item) =>
          (row.targetsByItem.get(item.key) ?? []).some((target) =>
            target.nodes.some((node) => campaigns.has(node.campaignId)),
          ),
        );
        return { ...row, items };
      })
      .filter((row) => campaigns.size === 0 || row.items.length > 0);
  }, [kindFiltered, campaigns]);

  const toggleKind = (kind: PlanStepKind) =>
    setKinds((current) => {
      const next = new Set(current);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });
  const toggleCampaign = (id: string) =>
    setCampaigns((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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

      {(presentKinds.length > 0 || availableCampaigns.length > 0) && (
        <section className="panel" style={{ marginBottom: 16 }}>
          {presentKinds.length > 0 && (
            <>
              <h3 style={{ marginTop: 0 }}>{t('nextSteps.filterByType')}</h3>
              <div className="counts" style={{ marginBottom: availableCampaigns.length > 0 ? 16 : 0 }}>
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

          {availableCampaigns.length > 0 && (
            <>
              <h3 style={{ marginTop: 0 }}>{t('nextSteps.filterByCampaign')}</h3>
              <p className="small muted" style={{ marginTop: 0 }}>{t('nextSteps.campaignBlurb')}</p>
              <div className="counts">
                {availableCampaigns.map(([id, campaign]) => (
                  <button
                    key={id}
                    type="button"
                    className={`count filterable with-icon${campaigns.has(id) ? ' active' : ''}`}
                    onClick={() => toggleCampaign(id)}
                  >
                    <Icon src={campaignIcon(id)} size={16} reserve />
                    {campaign.name}
                    <b>{campaign.count}</b>
                  </button>
                ))}
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
