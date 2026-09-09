/**
 * Everything the library works out rather than reads.
 *
 * These are the same functions the web app's screens are built on, so an
 * answer here and the figure on the corresponding page are the same
 * arithmetic — not a second implementation that agrees for now.
 */

import { z } from 'zod';

import {
  BattleBrief,
  EquipmentPool,
  ItemOptimiser,
  RarityCeiling,
  Team,
  TeamOptimiser,
  allocateHoldings,
  badgeCatalogue,
  buildRosterUnits,
  buildTimeline,
  computeUnitStats,
  currentState,
  energyCandidates,
  farmTargets,
  farmingCost,
  indexMaterialUses,
  markProgress,
  planCosts,
  projectedStats,
  raidsToday,
  rankName,
  resolvePlan,
  runsPerDrop,
  type Rarity,
} from '../../../dist/gamedata/index.js';

import { db, findUnit, player } from '../context.js';
import { rarityLabel } from '../labels.js';
import type { Registrar } from '../register.js';
import { store } from '../store.js';

/** The evolution target every planning tool takes, in one place. */
const targetSchema = {
  rank: z.number().int().min(0).max(16).optional().describe('Rank to reach, 0 Stone I … 16 Diamond III'),
  rarity: z.number().int().min(0).max(5).optional().describe('0 Common … 5 Mythic'),
  xpLevel: z.number().int().min(1).max(50).optional(),
  progressionIndex: z.number().int().min(0).max(19).optional().describe('Rung of the star ladder'),
  activeAbilityLevel: z.number().int().min(1).max(50).optional(),
  passiveAbilityLevel: z.number().int().min(1).max(50).optional(),
};

type TargetArgs = { [K in keyof typeof targetSchema]: z.infer<(typeof targetSchema)[K]> };

const toTarget = (args: TargetArgs) =>
  Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));

export function registerCalcTools(tool: Registrar): void {
  tool(
    'unit_stats',
    'Stats for a unit at any rank, level, star rung and rarity — the "what would it look like at Bronze III" question, answered without changing anything. Omitted fields keep the unit\'s current values.',
    {
      unit: z.string().describe('Unit id or name'),
      rank: z.number().int().min(0).max(16).optional(),
      xpLevel: z.number().int().min(1).max(50).optional(),
      progressionIndex: z.number().int().min(0).max(19).optional(),
      appliedUpgrades: z
        .array(z.number().int().min(0).max(5))
        .optional()
        .describe('Slot indices filled at that rank; omit to keep what is filled now'),
    },
    async ({ unit: wanted, rank, xpLevel, progressionIndex, appliedUpgrades }) => {
      const { roster } = await player();
      const database = await db();
      const unit = findUnit(roster, wanted);
      const hypothetical = {
        ...unit.effective,
        ...(rank !== undefined ? { rank } : {}),
        ...(xpLevel !== undefined ? { xpLevel } : {}),
        ...(progressionIndex !== undefined ? { progressionIndex } : {}),
        ...(appliedUpgrades !== undefined ? { upgrades: appliedUpgrades } : {}),
      };
      return {
        unit: unit.name,
        now: unit.stats,
        asked: computeUnitStats(hypothetical, database),
      };
    },
  );

  tool(
    'plan_preview',
    'Resolve a target into the steps it takes and what they cost, without saving anything. Energy counts only the shortfall — materials already held are not charged for again — and is Mercy-aware.',
    { unit: z.string().describe('Unit id or name'), ...targetSchema },
    async ({ unit: wanted, ...target }) => {
      const { roster, player: response, owned } = await player();
      const database = await db();
      const unit = findUnit(roster, wanted);
      const plan = resolvePlan(unit.unit, toTarget(target), database);
      const costs = planCosts(unit.unit, plan, database);
      const allocated = allocateHoldings(costs, new Map(owned), database);
      const items = allocated.flatMap((step) => step.items);
      return {
        unit: unit.name,
        from: currentState(unit.unit, database),
        steps: plan.steps.map((step) => ({
          kind: step.kind,
          label: step.label,
          from: step.from,
          to: step.to,
          reason: step.reason,
        })),
        cost: farmingCost(items, database, response),
        projected: projectedStats(unit.unit, plan, database),
      };
    },
  );

  tool(
    'plan_steps',
    'A saved plan in full: every step, what each still needs after the stock on hand, and where that leaves the unit. Marks the steps already done.',
    { planId: z.string() },
    async ({ planId }) => {
      const plans = await store.readPlans();
      const saved = plans.find((plan) => plan.id === planId);
      if (!saved) throw new Error(`No plan "${planId}". Use list_plans.`);
      const { roster, player: response, owned } = await player();
      const database = await db();
      const unit = findUnit(roster, saved.unitId);
      const plan = markProgress(
        resolvePlan(unit.unit, saved.target as never, database, saved.origin as never),
        currentState(unit.unit, database),
      );
      const allocated = allocateHoldings(planCosts(unit.unit, plan, database), new Map(owned), database);
      return {
        planId,
        unit: unit.name,
        steps: allocated.map((step) => ({
          kind: step.step.kind,
          label: step.step.label,
          done: step.step.done ?? false,
          gold: step.gold,
          items: step.items.map((item) => ({
            name: item.name,
            key: item.key,
            rarity: rarityLabel(item.rarity),
            needed: item.amount,
            held: item.covered,
            missing: item.missing,
            applied: item.applied ?? false,
          })),
          cost: farmingCost(step.items, database, response),
        })),
        total: farmingCost(allocated.flatMap((s) => s.items), database, response),
        projected: projectedStats(unit.unit, plan, database),
      };
    },
  );

  tool(
    'timeline',
    'One running order across every saved plan: bundles grouped by the rank they reach, cheapest first, with held stock spread over that order so two plans cannot both claim the same material.',
    {},
    async () => {
      const plans = await store.readPlans();
      if (plans.length === 0) return { bundles: [], note: 'No plans saved. Use save_plan first.' };
      const { roster, player: response } = await player();
      const database = await db();

      const entries = [];
      for (const saved of plans) {
        const unit = roster.find((u) => u.id === saved.unitId);
        if (!unit) continue;
        entries.push({
          id: saved.id,
          unit: unit.unit,
          plan: markProgress(
            resolvePlan(unit.unit, saved.target as never, database, saved.origin as never),
            currentState(unit.unit, database),
          ),
        });
      }
      const timeline = buildTimeline(entries, response, database);
      return {
        bundles: timeline.bundles.map((bundle) => ({
          planId: bundle.planId,
          unit: bundle.unitName,
          label: bundle.label,
          targetRank: bundle.targetRank === undefined ? undefined : rankName(bundle.targetRank),
          steps: bundle.steps.map((step) => step.label),
          missing: bundle.missing,
          unreachable: bundle.unreachable,
          gold: bundle.gold,
        })),
        byPlan: Object.fromEntries([...timeline.byPlan].map(([id, summary]) => [id, summary])),
      };
    },
  );

  tool(
    'energy_candidates',
    'Every upgrade slot the roster could fill at its units\' current ranks, priced on what is missing and ordered by stat gained per energy. This is the "what do I spend tonight" list.',
    {
      priority: z.enum(['health', 'damage', 'armour']).optional().describe('Favour one attribute'),
      budget: z.number().min(0).optional().describe('Keep only slots costing this much energy or less'),
      reachableToday: z
        .boolean()
        .default(false)
        .describe('Keep only slots today\'s remaining node attempts could finish'),
      limit: z.number().int().min(1).max(200).default(30),
    },
    async ({ priority, budget, reachableToday, limit }) => {
      const { roster, player: response } = await player();
      const database = await db();
      let rows = energyCandidates(
        roster.map((unit) => unit.unit),
        response,
        database,
        priority ? { priority } : {},
      );
      if (reachableToday) rows = rows.filter((row) => row.today !== undefined);
      if (budget !== undefined) rows = rows.filter((row) => row.energy <= budget);
      return {
        total: rows.length,
        candidates: rows.slice(0, limit).map((row) => ({
          unit: row.unitName,
          rank: rankName(row.rank),
          slot: row.slotIndex + 1,
          item: row.itemName,
          rarity: rarityLabel(row.rarity),
          copiesMissing: row.copies,
          stat: row.stat,
          gain: row.gain,
          energy: Math.round(row.energy),
          energyPerCopy: Number(row.energyPerCopy.toFixed(1)),
          raidsToday: row.today?.raids,
          toFarm: row.targets.map((target) => ({
            name: target.name,
            amount: target.amount,
            energy: target.energy === undefined ? undefined : Math.round(target.energy),
          })),
        })),
      };
    },
  );

  tool(
    'farm_targets',
    'What one material comes down to when the recipe is flattened, where each part drops, and what a copy costs. Prices count the Mercy counter, so they sit below the run cost divided by the base rate.',
    {
      itemId: z.string().describe('Upgrade id, e.g. upgArmU007'),
      copies: z.number().int().min(1).default(1),
      countStock: z
        .boolean()
        .default(true)
        .describe('Take what the player already holds off the top'),
    },
    async ({ itemId, copies, countStock }) => {
      const { player: response, owned } = await player();
      const database = await db();
      const upgrade = database.upgrades[itemId];
      if (!upgrade) throw new Error(`No upgrade "${itemId}". Try list_upgrades.`);
      const item = {
        kind: 'upgrade' as const,
        key: `upgrade:${itemId}`,
        name: upgrade.name,
        ...(upgrade.rarity !== undefined ? { rarity: upgrade.rarity } : {}),
      };
      const held = countStock ? new Map(owned) : new Map<string, number>();
      const targets = farmTargets(item, copies, database, response, held);
      const raids = raidsToday(item, copies, database, response, new Map(held));
      return {
        item: upgrade.name,
        copies,
        totalEnergy: Math.round(targets.reduce((n, t) => n + (t.energy ?? 0), 0)),
        raidsToday: raids?.raids,
        reachableToday: raids !== undefined,
        targets: targets.map((target) => ({
          name: target.name,
          amount: target.amount,
          rarity: rarityLabel(target.rarity),
          via: target.via,
          energyPerCopy: target.energyPerCopy === undefined ? undefined : Number(target.energyPerCopy.toFixed(1)),
          energy: target.energy === undefined ? undefined : Math.round(target.energy),
          nodes: target.nodes.slice(0, 6).map((node) => ({
            campaign: node.campaignName,
            node: node.nodeNumber,
            unlocked: node.unlocked,
            attemptsLeft: node.attemptsLeft,
            energyCost: node.energyCost,
            baseDropRate: node.dropRate,
            energyPerCopy: node.energyPerDrop === undefined ? undefined : Number(node.energyPerDrop.toFixed(1)),
          })),
        })),
      };
    },
  );

  tool(
    'drop_rate_math',
    'What a published base drop rate really costs in runs, once the Mercy counter is counted. The step between failures is inferred from a reward popup rather than published — see the repository notes.',
    { baseRate: z.number().min(0).max(2).describe('Published base chance, e.g. 0.4281') },
    async ({ baseRate }) => ({
      baseRate,
      runsPerDropWithMercy: Number(runsPerDrop(baseRate).toFixed(3)),
      runsPerDropIfPlainRoll: baseRate > 0 ? Number((1 / baseRate).toFixed(3)) : undefined,
      overstatedBy:
        baseRate > 0 && baseRate < 1
          ? `${(((1 / baseRate) / runsPerDrop(baseRate) - 1) * 100).toFixed(0)}%`
          : '0%',
    }),
  );

  tool(
    'material_uses',
    'Where an upgrade is used: which units want it at which rank and slot, directly or forged into something that is.',
    { itemId: z.string().describe('Upgrade id') },
    async ({ itemId }) => {
      const database = await db();
      const index = indexMaterialUses(database);
      const entry = index.get(itemId) ?? index.get(`upgrade:${itemId}`);
      if (!entry) throw new Error(`Nothing in the rank tables uses "${itemId}".`);
      return entry;
    },
  );

  tool(
    'badge_costs',
    'Ability badges: what each alliance and rarity is spent on, and how many an ability level asks for.',
    {},
    async () => {
      const database = await db();
      const { player: response } = await player();
      return badgeCatalogue(response, database);
    },
  );

  tool(
    'recommend_team',
    'A squad for a campaign node, ranked by what each unit lands through those enemies\' armour plus a share of its own toughness. Only units the node would actually let you deploy are offered.',
    {
      battleKey: z.string().describe('Node key, e.g. campaign1_10 — see campaign_nodes'),
      objective: z.enum(['effective', 'offence', 'defence']).default('defence'),
      capRarity: z.number().int().min(0).max(5).optional().describe('Play the squad at this rarity'),
    },
    async ({ battleKey, objective, capRarity }) => {
      const database = await db();
      const { player: response } = await player();
      const brief = BattleBrief.all(database).find((b) => b.battle.key === battleKey);
      if (!brief) throw new Error(`No node "${battleKey}". Use campaign_nodes to find one.`);
      const cap =
        capRarity === undefined ? undefined : new RarityCeiling(capRarity as Rarity, database);
      const roster = buildRosterUnits(response, database, cap);
      const picks = new TeamOptimiser(brief, objective).recommend(roster);
      return {
        node: `${brief.campaignName} node ${brief.battle.nodeNumber}`,
        slots: brief.slots,
        enemies: brief.enemyCount,
        enemyHealth: brief.enemyHealth,
        meanEnemyArmour: Math.round(brief.meanEnemyArmour),
        takes: brief.requiredFaction ?? brief.allowedAllianceName ?? 'anyone',
        squad: picks.map((pick) => ({
          unit: pick.unit.name,
          faction: pick.unit.factionId,
          damageThroughArmour: Math.round(pick.damage),
          effectiveHealth: Math.round(pick.toughness),
          reason: pick.reason,
        })),
      };
    },
  );

  tool(
    'optimise_equipment',
    'Fit the best equipment onto a saved team. A piece taken off a team-mate empties their slot, and the gain reported is the squad\'s net rather than the receiver\'s.',
    {
      teamId: z.string(),
      objective: z.enum(['health', 'armour', 'damage', 'effective', 'offence', 'defence']).default('defence'),
      scope: z.enum(['team', 'team+inventory', 'all']).default('team+inventory'),
    },
    async ({ teamId, objective, scope }) => {
      const teams = await store.readTeams();
      const saved = teams.find((team) => team.id === teamId);
      if (!saved) throw new Error(`No team "${teamId}". Use list_teams.`);
      const database = await db();
      const { player: response, roster } = await player();
      const team = new Team(saved.id, saved.name, saved.memberIds, saved.capRarity as never);
      const members = team.members(roster);
      const pool = EquipmentPool.from(response, database, scope, saved.memberIds);
      const layout = new ItemOptimiser(pool, database, objective).optimise(members);
      return {
        team: saved.name,
        moves: layout.map((move) => ({
          unit: roster.find((u) => u.id === move.unitId)?.name ?? move.unitId,
          slot: move.slotId,
          equip: `${move.item.name} lv ${move.item.level}`,
          insteadOf: move.replaces ? `${move.replaces.name} lv ${move.replaces.level}` : undefined,
          takeOff: move.takenFrom
            ? {
                unit: roster.find((u) => u.id === move.takenFrom!.unitId)?.name ?? move.takenFrom.unitId,
                slot: move.takenFrom.slotId,
                theyLose: Math.round(move.takenFrom.loss),
              }
            : undefined,
          squadGain: Math.round(move.gain),
        })),
      };
    },
  );
}
