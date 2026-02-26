/**
 * copilot-teams teammate — spawn, list, shutdown teammates.
 */

import { parseFlags, resolveTeamName, resolveSessionId } from './helpers.js';
import {
  spawnTeammate,
  getTeammateStatuses,
  formatTeammateList,
  requestShutdown,
  forceShutdown,
} from '../teammate/index.js';
import { warnTeamSize } from '../utils/cost.js';
import { loadTeam } from '../team/index.js';

const HELP = `
Usage: copilot-teams teammate <subcommand> [options]

Subcommands:
  spawn <name>   Spawn a new teammate
  list           List all teammates and their statuses
  shutdown <name> Request graceful shutdown
  kill <name>     Force-terminate a teammate

Options (spawn):
  --type <type>      Agent type (default: coder)
  --model <model>    Model to use
  --prompt <text>    Initial prompt / instructions
  --team-name <name>
  --session-id <id>
`.trim();

export async function cmdTeammate(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const sub = positional[0];

  if (!sub || flags['help']) {
    console.log(HELP);
    return;
  }

  const teamName = resolveTeamName(flags);
  const sessionId = resolveSessionId(flags);

  switch (sub) {
    case 'spawn': {
      const name = positional[1];
      if (!name) {
        console.error('Usage: copilot-teams teammate spawn <name> --prompt "..."');
        process.exit(1);
      }
      const team = loadTeam(teamName);
      const warning = warnTeamSize(team.members.length + 1);
      if (warning.warn) {
        console.warn(`⚠ ${warning.message}`);
      }
      const tm = await spawnTeammate(teamName, sessionId, {
        name,
        agentType: flags['type'] ?? 'coder',
        model: flags['model'],
        spawnPrompt: flags['prompt'] ?? `You are teammate ${name}.`,
      });
      console.log(`✓ Spawned ${tm.name} (pid: ${tm.pid})`);
      break;
    }
    case 'list':
    case 'ls': {
      const statuses = getTeammateStatuses(teamName);
      if (statuses.length === 0) {
        console.log('No teammates.');
      } else {
        console.log(formatTeammateList(statuses));
      }
      break;
    }
    case 'shutdown': {
      const name = positional[1];
      if (!name) { console.error('Usage: copilot-teams teammate shutdown <name>'); process.exit(1); }
      const result = await requestShutdown(teamName, sessionId, name);
      console.log(`✓ Shutdown ${name}: ${result.method}${result.reason ? ` — ${result.reason}` : ''}`);
      break;
    }
    case 'kill': {
      const name = positional[1];
      if (!name) { console.error('Usage: copilot-teams teammate kill <name>'); process.exit(1); }
      await forceShutdown(teamName, sessionId, name);
      console.log(`✓ Force-terminated ${name}.`);
      break;
    }
    default:
      console.error(`Unknown subcommand: teammate ${sub}`);
      console.log(HELP);
      process.exit(1);
  }
}
