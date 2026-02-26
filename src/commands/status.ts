/**
 * copilot-teams status — dashboard showing team, teammates, tasks, sprint.
 */

import { parseFlags, resolveTeamName } from './helpers.js';
import { loadTeam } from '../team/index.js';
import { readTaskList } from '../tasks/index.js';
import { getCurrentSprint } from '../sprint/index.js';
import { getActiveFileClaims } from '../utils/file-claims.js';
import { getCrashedTeammates } from '../utils/resilience.js';

const HELP = `
Usage: copilot-teams status [options]

Shows a dashboard with team info, teammates, tasks, and sprint status.

Options:
  --team-name <name>
`.trim();

export async function cmdStatus(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);

  if (flags['help']) {
    console.log(HELP);
    return;
  }

  const teamName = resolveTeamName(flags);
  const team = loadTeam(teamName);
  const tasks = await readTaskList(teamName);
  const sprint = await getCurrentSprint(teamName);
  const fileClaims = await getActiveFileClaims(teamName);
  const crashed = getCrashedTeammates(teamName);

  // Header
  console.log(`\n╔══ Team: ${team.teamName} ══╗`);
  console.log(`  Lead: ${team.leadSessionId}`);
  console.log(`  Created: ${team.createdAt}`);

  // Teammates
  console.log(`\n── Teammates (${team.members.length}) ──`);
  if (team.members.length === 0) {
    console.log('  (none)');
  } else {
    for (const m of team.members) {
      const icon = m.status === 'active' ? '●' : m.status === 'crashed' ? '✗' : '○';
      console.log(`  ${icon} ${m.name} [${m.status}] (${m.agentType})`);
    }
  }

  // Crashed alerts
  if (crashed.length > 0) {
    console.log(`\n⚠ CRASHED: ${crashed.map((c) => c.name).join(', ')}`);
  }

  // Tasks
  const pending = tasks.filter((t) => t.status === 'pending').length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  console.log(`\n── Tasks (${tasks.length}) ──`);
  console.log(`  Pending: ${pending}  In Progress: ${inProgress}  Completed: ${completed}`);
  for (const t of tasks.filter((t) => t.status === 'in_progress')) {
    console.log(`  ▸ ${t.id}: ${t.title} → @${t.assignee ?? 'unassigned'}`);
  }

  // Sprint
  console.log(`\n── Sprint ──`);
  if (!sprint) {
    console.log('  No active sprint.');
  } else {
    console.log(`  Sprint #${sprint.number} [${sprint.status}]`);
    for (const a of sprint.assignments) {
      console.log(`    ${a.teammate} → ${a.taskId} [${a.estimate}]`);
    }
  }

  // File claims
  if (fileClaims.length > 0) {
    console.log(`\n── File Claims (${fileClaims.length}) ──`);
    for (const c of fileClaims) {
      console.log(`  ${c.teammateId} → ${c.filePath}`);
    }
  }

  console.log('');
}
