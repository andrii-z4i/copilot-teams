/**
 * copilot-teams team — create, show, cleanup teams.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseFlags, resolveSessionId, resolveTeamName, printKV, saveLastTeam } from './helpers.js';
import { createTeam, loadTeam, loadTeamByDir, cleanupTeam } from '../team/index.js';
import { TEAMS_BASE_DIR } from '../constants.js';
import { warnTeamSize } from '../utils/cost.js';

const HELP = `
Usage: copilot-teams team <subcommand> [options]

Subcommands:
  create   Create a new team (you become the Lead)
  list     List all teams
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
    case 'list':
    case 'ls': {
      if (!fs.existsSync(TEAMS_BASE_DIR)) {
        console.log('No teams.');
        return;
      }
      const entries = fs.readdirSync(TEAMS_BASE_DIR, { withFileTypes: true });
      const teams = entries.filter(
        e => e.isDirectory() && fs.existsSync(path.join(TEAMS_BASE_DIR, e.name, 'config.json'))
      );
      if (teams.length === 0) {
        console.log('No teams.');
        return;
      }
      for (const entry of teams) {
        const t = loadTeamByDir(entry.name);
        console.log(`${t.teamName}  lead=${t.leadSessionId}  members=${t.members.length}  created=${t.createdAt}`);
      }
      break;
    }
    case 'cleanup': {
      const teamName = resolveTeamName(flags);
      const team = loadTeam(teamName);
      const sessionId = flags['session-id'] ?? team.leadSessionId;
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
