/**
 * copilot-teams file — claim, release, list file leases.
 */

import { parseFlags, resolveTeamName } from './helpers.js';
import { loadTeam } from '../team/index.js';
import {
  claimFile,
  releaseFile,
  getActiveFileClaims,
  detectFileConflicts,
  suggestFilePartitioning,
} from '../utils/file-claims.js';

const HELP = `
Usage: copilot-teams file <subcommand> [options]

Subcommands:
  claim <teammate> <task-id> <path>    Claim a file
  release <teammate> <task-id> <path>  Release a file lease
  list                                 List active file claims
  conflicts                            Detect file conflicts
  suggest                              Suggest file partitioning

Options (suggest):
  --files <path,path,...>       Files to partition
  --teammates <name,name,...>   Teammates to distribute to

Options:
  --team-name <name>
`.trim();

export async function cmdFile(args: string[]): Promise<void> {
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
    case 'claim': {
      const [, teammate, taskId, filePath] = positional;
      if (!teammate || !taskId || !filePath) {
        console.error('Usage: copilot-teams file claim <teammate> <task-id> <path>');
        process.exit(1);
      }
      const claim = await claimFile(tid, teammate, taskId, filePath);
      console.log(`✓ ${teammate} claimed ${filePath} (task ${taskId}).`);
      break;
    }
    case 'release': {
      const [, teammate, taskId, filePath] = positional;
      if (!teammate || !taskId || !filePath) {
        console.error('Usage: copilot-teams file release <teammate> <task-id> <path>');
        process.exit(1);
      }
      await releaseFile(tid, teammate, taskId, filePath);
      console.log(`✓ ${teammate} released ${filePath}.`);
      break;
    }
    case 'list':
    case 'ls': {
      const claims = await getActiveFileClaims(tid);
      if (claims.length === 0) { console.log('No active file claims.'); return; }
      for (const c of claims) {
        console.log(`  ${c.teammateId} → ${c.filePath} (task ${c.taskId})`);
      }
      break;
    }
    case 'conflicts': {
      const conflicts = await detectFileConflicts(tid);
      if (conflicts.length === 0) { console.log('No file conflicts detected.'); return; }
      for (const c of conflicts) {
        console.log(`  ⚠ ${c.filePath}: claimed by ${c.claimedBy.join(', ')}`);
      }
      break;
    }
    case 'suggest': {
      const files = flags['files']?.split(',').map((s) => s.trim()) ?? [];
      const teammates = flags['teammates']?.split(',').map((s) => s.trim()) ?? [];
      if (files.length === 0 || teammates.length === 0) {
        console.error('Usage: copilot-teams file suggest --files a.ts,b.ts --teammates tm-1,tm-2');
        process.exit(1);
      }
      const result = suggestFilePartitioning(files, teammates);
      for (const [teammate, assigned] of result) {
        console.log(`  ${teammate}: ${assigned.join(', ') || '(none)'}`);
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: file ${sub}`);
      console.log(HELP);
      process.exit(1);
  }
}
