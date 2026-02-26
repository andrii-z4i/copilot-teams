#!/usr/bin/env node

/**
 * copilot-teams CLI — terminal interface for coordinating multiple Copilot CLI instances.
 *
 * Usage: copilot-teams <command> [subcommand] [options]
 */

import { parseArgs } from 'node:util';
import {
  cmdTeam,
  cmdTask,
  cmdSprint,
  cmdTeammate,
  cmdMessage,
  cmdStatus,
  cmdDisplay,
  cmdHook,
  cmdPlan,
  cmdFile,
} from './commands/index.js';

const HELP = `
copilot-teams — coordinate multiple Copilot CLI instances

Usage:
  copilot-teams <command> [subcommand] [options]

Commands:
  team        Create, show, or clean up a team
  teammate    Spawn, list, or shut down teammates
  task        Add, list, update, or assign tasks
  sprint      Start, activate, or close sprints
  msg         Send or read messages
  status      Show team status dashboard
  display     Set or show display mode
  plan        Submit, review, or list plans
  hook        Configure lifecycle hooks
  file        Claim, release, or list file leases

Options:
  --help, -h          Show help
  --team-name <name>  Specify team name (default: auto-detect active team)
  --session-id <id>   Your session ID (default: generated)

Examples:
  copilot-teams team create
  copilot-teams teammate spawn tm-1 --type coder --prompt "Implement auth"
  copilot-teams task add --id TASK-1 --title "Fix auth" --desc "JWT login"
  copilot-teams sprint start 1 --tasks TASK-1,TASK-2
  copilot-teams msg send tm-1 "Focus on TASK-1"
  copilot-teams status

Run 'copilot-teams <command> --help' for more information on a command.
`.trim();

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  const command = args[0];
  const rest = args.slice(1);

  try {
    switch (command) {
      case 'team':
        await cmdTeam(rest);
        break;
      case 'teammate':
        await cmdTeammate(rest);
        break;
      case 'task':
        await cmdTask(rest);
        break;
      case 'sprint':
        await cmdSprint(rest);
        break;
      case 'msg':
      case 'message':
        await cmdMessage(rest);
        break;
      case 'status':
        await cmdStatus(rest);
        break;
      case 'display':
        await cmdDisplay(rest);
        break;
      case 'plan':
        await cmdPlan(rest);
        break;
      case 'hook':
        await cmdHook(rest);
        break;
      case 'file':
        await cmdFile(rest);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error(`Run 'copilot-teams --help' for usage.`);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
