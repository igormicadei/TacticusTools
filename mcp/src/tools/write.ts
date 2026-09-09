/**
 * The parts a caller can change: the plans and the teams.
 *
 * Both are stored in the shapes the web app uses, so a file written here would
 * load there unchanged. Nothing else is writable — the roster comes from the
 * game and the database is a snapshot, and letting either be edited would put
 * numbers on screen that the game never said.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { currentState, resolvePlan } from '../../../dist/gamedata/index.js';

import { db, findUnit, player } from '../context.js';
import type { Registrar } from '../register.js';
import { store, type StoredPlan, type StoredTeam } from '../store.js';

export function registerWriteTools(tool: Registrar): void {
  /* ---- plans ------------------------------------------------------------ */

  tool('list_plans', 'Every saved plan, with the unit and target each carries.', {}, async () => {
    const plans = await store.readPlans();
    const { roster } = await player();
    return {
      plans: plans.map((plan) => ({
        id: plan.id,
        unitId: plan.unitId,
        unit: roster.find((unit) => unit.id === plan.unitId)?.name ?? plan.unitId,
        target: plan.target,
        priority: plan.priority,
        createdAt: new Date(plan.createdAt).toISOString(),
      })),
    };
  });

  tool(
    'save_plan',
    'Create a plan, or replace one by id. The target is checked against the unit before it is stored, so a plan that could not be resolved is refused rather than saved to fail later.',
    {
      planId: z.string().optional().describe('Omit to create; give an existing id to replace it'),
      unit: z.string().describe('Unit id or name'),
      rank: z.number().int().min(0).max(16).optional(),
      rarity: z.number().int().min(0).max(5).optional(),
      xpLevel: z.number().int().min(1).max(50).optional(),
      progressionIndex: z.number().int().min(0).max(19).optional(),
      activeAbilityLevel: z.number().int().min(1).max(50).optional(),
      passiveAbilityLevel: z.number().int().min(1).max(50).optional(),
      priority: z
        .enum(['health', 'damage', 'armour'])
        .optional()
        .describe('Attribute to favour for this unit when spending energy'),
    },
    async ({ planId, unit: wanted, priority, ...targetFields }) => {
      const { roster } = await player();
      const database = await db();
      const unit = findUnit(roster, wanted);

      const target = Object.fromEntries(
        Object.entries(targetFields).filter(([, value]) => value !== undefined),
      );
      if (Object.keys(target).length === 0) {
        throw new Error('A plan needs a target — give at least one of rank, rarity, xpLevel or progressionIndex.');
      }
      // Resolving it now is the check: an unreachable target throws here rather
      // than every time the plan is later read.
      const plan = resolvePlan(unit.unit, target as never, database);

      const plans = await store.readPlans();
      const existing = planId ? plans.findIndex((p) => p.id === planId) : -1;
      if (planId && existing < 0) throw new Error(`No plan "${planId}" to replace.`);

      const saved: StoredPlan = {
        id: planId ?? randomUUID(),
        unitId: unit.id,
        target,
        // Anchors the route, so a step already finished stays on the page marked
        // done rather than vanishing the moment it is completed.
        origin: currentState(unit.unit, database),
        ...(priority ? { priority } : {}),
        createdAt: existing >= 0 ? plans[existing]!.createdAt : Date.now(),
      };
      if (existing >= 0) plans[existing] = saved;
      else plans.push(saved);
      await store.writePlans(plans);

      return {
        saved: saved.id,
        replaced: existing >= 0,
        unit: unit.name,
        target,
        steps: plan.steps.map((step) => step.label),
      };
    },
  );

  tool(
    'delete_plan',
    'Delete a saved plan for good — there is no undo, so read list_plans first and delete by the id it gives rather than by a name.',
    { planId: z.string().describe('The id from list_plans') },
    async ({ planId }) => {
      const plans = await store.readPlans();
      const remaining = plans.filter((plan) => plan.id !== planId);
      if (remaining.length === plans.length) throw new Error(`No plan "${planId}".`);
      await store.writePlans(remaining);
      return { deleted: planId, remaining: remaining.length };
    },
  );

  /* ---- teams ------------------------------------------------------------ */

  tool('list_teams', 'Every saved team, with its members and the node it is built for.', {}, async () => {
    const teams = await store.readTeams();
    const { roster } = await player();
    return {
      teams: teams.map((team) => ({
        id: team.id,
        name: team.name,
        battleKey: team.battleKey,
        capRarity: team.capRarity,
        members: team.memberIds.map(
          (id) => roster.find((unit) => unit.id === id)?.name ?? id,
        ),
        memberIds: team.memberIds,
        createdAt: new Date(team.createdAt).toISOString(),
      })),
    };
  });

  tool(
    'save_team',
    'Create a team, or replace one by id. Members are resolved by id or name and stored as ids; a name that matches nothing on the roster is refused rather than stored as a dangling reference.',
    {
      teamId: z.string().optional().describe('Omit to create; give an existing id to replace it'),
      name: z.string().min(1),
      members: z.array(z.string()).describe('Unit ids or names'),
      battleKey: z.string().optional().describe('Node this team is built for, e.g. campaign1_10'),
      capRarity: z.number().int().min(0).max(5).optional(),
    },
    async ({ teamId, name, members, battleKey, capRarity }) => {
      const { roster } = await player();
      const database = await db();
      const memberIds = members.map((member) => findUnit(roster, member).id);
      if (battleKey) {
        const known = Object.values(database.campaigns).some((campaign) =>
          Object.values(campaign.battles).some((battle) => battle.key === battleKey),
        );
        if (!known) throw new Error(`No node "${battleKey}". Use campaign_nodes to find one.`);
      }

      const teams = await store.readTeams();
      const existing = teamId ? teams.findIndex((team) => team.id === teamId) : -1;
      if (teamId && existing < 0) throw new Error(`No team "${teamId}" to replace.`);

      const saved: StoredTeam = {
        id: teamId ?? randomUUID(),
        name,
        memberIds,
        ...(battleKey ? { battleKey } : {}),
        ...(capRarity !== undefined ? { capRarity } : {}),
        createdAt: existing >= 0 ? teams[existing]!.createdAt : Date.now(),
      };
      if (existing >= 0) teams[existing] = saved;
      else teams.push(saved);
      await store.writeTeams(teams);

      return {
        saved: saved.id,
        replaced: existing >= 0,
        name,
        members: memberIds.map((id) => roster.find((unit) => unit.id === id)?.name ?? id),
      };
    },
  );

  tool(
    'delete_team',
    'Delete a saved team for good — there is no undo, so read list_teams first and delete by the id it gives rather than by a name. The units themselves are untouched.',
    { teamId: z.string().describe('The id from list_teams') },
    async ({ teamId }) => {
      const teams = await store.readTeams();
      const remaining = teams.filter((team) => team.id !== teamId);
      if (remaining.length === teams.length) throw new Error(`No team "${teamId}".`);
      await store.writeTeams(remaining);
      return { deleted: teamId, remaining: remaining.length };
    },
  );
}
