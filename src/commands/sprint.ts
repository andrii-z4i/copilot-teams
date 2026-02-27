/**
 * copilot-teams sprint — start, activate, close, show sprints.
 */

import { parseFlags, resolveTeamName } from './helpers.js';
import { loadTeam } from '../team/index.js';
import {
  startSprint,
  activateSprint,
  closeSprint,
  getCurrentSprint,
  readSprints,
} from '../sprint/index.js';

const HELP = `
Usage: copilot-teams sprint <subcommand> [options]

Subcommands:
  start <number>      Start a new sprint in planning status
  activate <number>   Transition sprint to active
  close <number>      Close a sprint
  show                Show current sprint
  list                List all sprints

Options (start):
  --tasks <id,id,...>  Task IDs to include in the sprint

Options (activate):
  --assignments <json>  JSON array of assignments
    Example: '[{"teammate":"tm-1","taskId":"T-1","taskTitle":"Fix","estimate":"M"}]'

Options:
  --team-name <name>
`.trim();

export async function cmdSprint(args: string[]): Promise<void> {
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
    case 'start': {
      const num = Number(positional[1]);
      if (!num) { console.error('Usage: copilot-teams sprint start <number> --tasks T-1,T-2'); process.exit(1); }
      const taskIds = flags['tasks']?.split(',').map((s) => s.trim()) ?? [];
      await startSprint(tid, num, taskIds);
      console.log(`✓ Sprint #${num} started (planning).`);
      break;
    }
    case 'activate': {
      const num = Number(positional[1]);
      if (!num) { console.error('Usage: copilot-teams sprint activate <number> --assignments \'[...]\''); process.exit(1); }
      const assignments = flags['assignments'] ? JSON.parse(flags['assignments']) : [];
      await activateSprint(tid, num, assignments);
      console.log(`✓ Sprint #${num} activated.`);
      break;
    }
    case 'close': {
      const num = Number(positional[1]);
      if (!num) { console.error('Usage: copilot-teams sprint close <number>'); process.exit(1); }
      const result = await closeSprint(tid, num);
      console.log(`✓ Sprint #${num} closed.`);
      if (result.unfinishedTaskIds.length > 0) {
        console.log(`  Unfinished tasks returned to backlog: ${result.unfinishedTaskIds.join(', ')}`);
      }
      break;
    }
    case 'show': {
      const sprint = await getCurrentSprint(tid);
      if (!sprint) {
        console.log('No active sprint.');
        return;
      }
      console.log(`Sprint #${sprint.number} [${sprint.status}]`);
      console.log(`  Started: ${sprint.startedAt}`);
      if (sprint.assignments.length > 0) {
        console.log('  Assignments:');
        for (const a of sprint.assignments) {
          console.log(`    ${a.teammate} → ${a.taskId}: ${a.taskTitle} [${a.estimate}]`);
        }
      }
      break;
    }
    case 'list':
    case 'ls': {
      const sprints = await readSprints(tid);
      if (sprints.length === 0) {
        console.log('No sprints.');
        return;
      }
      for (const s of sprints) {
        const closed = s.closedAt ? ` (closed ${s.closedAt})` : '';
        console.log(`  Sprint #${s.number} [${s.status}] started ${s.startedAt}${closed}`);
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: sprint ${sub}`);
      console.log(HELP);
      process.exit(1);
  }
}
