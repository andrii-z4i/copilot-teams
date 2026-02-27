/**
 * copilot-teams hook — configure lifecycle hooks.
 */

import { parseFlags, resolveTeamName } from './helpers.js';
import { loadTeam } from '../team/index.js';
import { loadHooks, saveHooks } from '../hooks/index.js';
import type { HookEvent } from '../types.js';

const HELP = `
Usage: copilot-teams hook <subcommand> [options]

Subcommands:
  list          List configured hooks
  add           Add a lifecycle hook
  clear         Remove all hooks

Options (add):
  --event <event>     TeammateIdle | TaskCompleted (required)
  --command <cmd>     Shell command to run (required)
  --cwd <dir>         Working directory

Options:
  --team-name <name>
`.trim();

export async function cmdHook(args: string[]): Promise<void> {
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
    case 'list':
    case 'ls': {
      const hooks = await loadHooks(tid);
      if (hooks.length === 0) { console.log('No hooks configured.'); return; }
      for (const h of hooks) {
        console.log(`  [${h.event}] ${h.command}${h.workingDir ? ` (cwd: ${h.workingDir})` : ''}`);
      }
      break;
    }
    case 'add': {
      const event = flags['event'] as HookEvent;
      const command = flags['command'];
      if (!event || !command) {
        console.error('Usage: copilot-teams hook add --event TaskCompleted --command "npm test"');
        process.exit(1);
      }
      const hooks = await loadHooks(tid);
      hooks.push({ event, command, workingDir: flags['cwd'] });
      await saveHooks(tid, hooks);
      console.log(`✓ Hook added: [${event}] ${command}`);
      break;
    }
    case 'clear': {
      await saveHooks(tid, []);
      console.log('✓ All hooks cleared.');
      break;
    }
    default:
      console.error(`Unknown subcommand: hook ${sub}`);
      console.log(HELP);
      process.exit(1);
  }
}
