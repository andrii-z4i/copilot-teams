/**
 * copilot-teams plan — submit, review, list plan approvals.
 */

import { parseFlags, resolveTeamName } from './helpers.js';
import { loadTeam } from '../team/index.js';
import {
  enterPlanMode,
  submitPlanForApproval,
  reviewPlan,
  getPendingPlans,
  getPlanHistory,
  getTeammateMode,
  setApprovalCriteria,
  getApprovalCriteria,
} from '../plan/index.js';

const HELP = `
Usage: copilot-teams plan <subcommand> [options]

Subcommands:
  enter <teammate> <task-id>       Put teammate in plan mode
  submit <teammate> <task-id>      Submit plan for approval
  review <request-id> <decision>   Approve or reject (decision: approved|rejected)
  pending                          List pending plan approvals
  history <teammate> <task-id>     Show plan revision history
  criteria                         Show or set approval criteria

Options (submit):
  --plan <text>         Plan text

Options (review):
  --feedback <text>     Feedback for rejection

Options (criteria):
  --set <description>   Set new criteria

Options:
  --team-name <name>
`.trim();

export async function cmdPlan(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const sub = positional[0];

  if (!sub || flags['help']) {
    console.log(HELP);
    return;
  }

  const teamName = resolveTeamName(flags);
  const team = loadTeam(teamName);
  const tid = team.teamId;

  switch (sub) {
    case 'enter': {
      const [, teammate, taskId] = positional;
      if (!teammate || !taskId) { console.error('Usage: copilot-teams plan enter <teammate> <task-id>'); process.exit(1); }
      await enterPlanMode(tid, teammate, taskId);
      console.log(`✓ ${teammate} entered plan mode for ${taskId}.`);
      break;
    }
    case 'submit': {
      const [, teammate, taskId] = positional;
      const plan = flags['plan'];
      if (!teammate || !taskId || !plan) {
        console.error('Usage: copilot-teams plan submit <teammate> <task-id> --plan "..."');
        process.exit(1);
      }
      const req = await submitPlanForApproval(tid, teammate, taskId, plan);
      console.log(`✓ Plan submitted (${req.id}, revision ${req.revision}).`);
      break;
    }
    case 'review': {
      const [, requestId, decision] = positional;
      if (!requestId || !decision || !['approved', 'rejected'].includes(decision)) {
        console.error('Usage: copilot-teams plan review <request-id> approved|rejected [--feedback "..."]');
        process.exit(1);
      }
      const result = await reviewPlan(tid, requestId, decision as 'approved' | 'rejected', flags['feedback']);
      console.log(`✓ Plan ${requestId}: ${result.status}`);
      if (result.feedback) console.log(`  Feedback: ${result.feedback}`);
      break;
    }
    case 'pending': {
      const pending = await getPendingPlans(tid);
      if (pending.length === 0) { console.log('No pending plans.'); return; }
      for (const p of pending) {
        console.log(`  ${p.id}: ${p.teammateName} → ${p.taskId} (rev ${p.revision})`);
      }
      break;
    }
    case 'history': {
      const [, teammate, taskId] = positional;
      if (!teammate || !taskId) { console.error('Usage: copilot-teams plan history <teammate> <task-id>'); process.exit(1); }
      const history = await getPlanHistory(tid, teammate, taskId);
      if (history.length === 0) { console.log('No plan history.'); return; }
      for (const p of history) {
        console.log(`  Rev ${p.revision} [${p.status}] ${p.submittedAt}`);
        if (p.feedback) console.log(`    Feedback: ${p.feedback}`);
      }
      break;
    }
    case 'criteria': {
      if (flags['set']) {
        await setApprovalCriteria(tid, { description: flags['set'] });
        console.log(`✓ Approval criteria set.`);
      } else {
        const criteria = await getApprovalCriteria(tid);
        if (criteria) {
          console.log(`Approval criteria: ${criteria.description}`);
        } else {
          console.log('No approval criteria set.');
        }
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: plan ${sub}`);
      console.log(HELP);
      process.exit(1);
  }
}
