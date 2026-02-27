/**
 * copilot-teams task — add, list, update, assign, delete tasks.
 */

import { parseFlags, resolveTeamName } from './helpers.js';
import { loadTeam } from '../team/index.js';
import {
  createTask,
  readTaskList,
  updateTask,
  deleteTask,
  getUnblockedTasks,
} from '../tasks/index.js';
import { assignTask, claimNextTask } from '../tasks/assignment.js';

const HELP = `
Usage: copilot-teams task <subcommand> [options]

Subcommands:
  add             Add a new task
  list            List all tasks
  update <id>     Update a task
  assign <id> <teammate>  Assign task to teammate
  claim <teammate>        Teammate claims next available task
  delete <id>     Delete a task

Options (add):
  --id <id>           Task ID (required)
  --title <title>     Task title (required)
  --desc <text>       Description
  --deps <id,id,...>  Comma-separated dependency IDs

Options (update):
  --status <status>   pending | in_progress | completed
  --assignee <name>   Assign to teammate
  --title <title>     New title

Options:
  --team-name <name>
`.trim();

export async function cmdTask(args: string[]): Promise<void> {
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
    case 'add': {
      const id = flags['id'];
      const title = flags['title'];
      if (!id || !title) {
        console.error('Usage: copilot-teams task add --id TASK-1 --title "Fix auth"');
        process.exit(1);
      }
      const deps = flags['deps'] ? flags['deps'].split(',').map((d) => d.trim()) : [];
      await createTask(tid, {
        id,
        title,
        description: flags['desc'] ?? '',
        dependencies: deps,
      });
      console.log(`✓ Task ${id} created: ${title}`);
      break;
    }
    case 'list':
    case 'ls': {
      const tasks = await readTaskList(tid);
      if (tasks.length === 0) {
        console.log('No tasks in backlog.');
        return;
      }
      const unblocked = getUnblockedTasks(tasks);
      const unblockedIds = new Set(unblocked.map((t) => t.id));
      for (const t of tasks) {
        const assignee = t.assignee ? ` → @${t.assignee}` : '';
        const blocked = !unblockedIds.has(t.id) && t.status === 'pending' ? ' (blocked)' : '';
        const complexity = t.complexity ? ` [${t.complexity}]` : '';
        console.log(`  [${t.status}] ${t.id}: ${t.title}${complexity}${assignee}${blocked}`);
      }
      console.log(`\n${tasks.length} tasks (${unblocked.length} ready)`);
      break;
    }
    case 'update': {
      const id = positional[1];
      if (!id) { console.error('Usage: copilot-teams task update <id> --status completed'); process.exit(1); }
      const updates: Record<string, unknown> = {};
      if (flags['status']) updates.status = flags['status'];
      if (flags['assignee']) updates.assignee = flags['assignee'];
      if (flags['title']) updates.title = flags['title'];
      await updateTask(tid, id, updates);
      console.log(`✓ Task ${id} updated.`);
      break;
    }
    case 'assign': {
      const id = positional[1];
      const teammate = positional[2];
      if (!id || !teammate) {
        console.error('Usage: copilot-teams task assign <task-id> <teammate>');
        process.exit(1);
      }
      await assignTask(tid, id, teammate);
      console.log(`✓ ${id} assigned to ${teammate}.`);
      break;
    }
    case 'claim': {
      const teammate = positional[1];
      if (!teammate) { console.error('Usage: copilot-teams task claim <teammate>'); process.exit(1); }
      const task = await claimNextTask(tid, teammate);
      if (task) {
        console.log(`✓ ${teammate} claimed ${task.id}: ${task.title}`);
      } else {
        console.log(`No available tasks for ${teammate}.`);
      }
      break;
    }
    case 'delete':
    case 'rm': {
      const id = positional[1];
      if (!id) { console.error('Usage: copilot-teams task delete <id>'); process.exit(1); }
      await deleteTask(tid, id);
      console.log(`✓ Task ${id} deleted.`);
      break;
    }
    default:
      console.error(`Unknown subcommand: task ${sub}`);
      console.log(HELP);
      process.exit(1);
  }
}
