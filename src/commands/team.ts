/**
 * copilot-teams team — create, show, cleanup teams.
 */

import { parseFlags, resolveSessionId, resolveTeamName, printKV, saveLastTeam } from './helpers.js';
import { createTeam, loadTeam, cleanupTeam, getActiveTeam } from '../team/index.js';
import { warnTeamSize } from '../utils/cost.js';

const HELP = `
Usage: copilot-teams team <subcommand> [options]

Subcommands:
  create   Create a new team (you become the Lead)
  show     Show team config
  cleanup  Remove team directory (all teammates must be stopped)

Options:
  --team-name <name>   Custom team name
  --session-id <id>    Your session ID
`.trim();

export async function cmdTeam(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const sub = positional[0];

  if (!sub || flags['help']) {
    console.log(HELP);
    return;
  }

  switch (sub) {
    case 'create': {
      const sessionId = resolveSessionId(flags);
      const team = await createTeam({
        leadSessionId: sessionId,
        teamName: flags['team-name'],
      });
      saveLastTeam(team.teamName);
      console.log(`✓ Team created: ${team.teamName}`);
      console.log(`  Lead session: ${team.leadSessionId}`);
      console.log(`  Created at:   ${team.createdAt}`);
      break;
    }
    case 'show': {
      const teamName = resolveTeamName(flags);
      const team = loadTeam(teamName);
      console.log(`Team: ${team.teamName}`);
      printKV([
        ['Lead', team.leadSessionId],
        ['Created', team.createdAt],
        ['Members', String(team.members.length)],
      ]);
      if (team.members.length > 0) {
        console.log('\nMembers:');
        for (const m of team.members) {
          console.log(`  ${m.name} [${m.status}] (${m.agentType}) pid=${m.pid ?? '-'}`);
        }
      }
      break;
    }
    case 'cleanup': {
      const teamName = resolveTeamName(flags);
      const sessionId = resolveSessionId(flags);
      await cleanupTeam(teamName, sessionId);
      console.log(`✓ Team ${teamName} cleaned up.`);
      break;
    }
    default:
      console.error(`Unknown subcommand: team ${sub}`);
      console.log(HELP);
      process.exit(1);
  }
}
