/**
 * CLI helpers shared across commands.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getActiveTeam } from '../team/index.js';
import { TEAMS_BASE_DIR } from '../constants.js';

const LAST_TEAM_FILE = path.join(TEAMS_BASE_DIR, '.last-team');

/** Parse --key value pairs from argv into a record. */
export function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

/** Save last-used team name for auto-detection. */
export function saveLastTeam(teamName: string): void {
  fs.mkdirSync(TEAMS_BASE_DIR, { recursive: true });
  fs.writeFileSync(LAST_TEAM_FILE, teamName, 'utf-8');
}

/** Read last-used team name, or null. */
function readLastTeam(): string | null {
  try {
    const name = fs.readFileSync(LAST_TEAM_FILE, 'utf-8').trim();
    // Verify the team dir still exists
    if (name && fs.existsSync(path.join(TEAMS_BASE_DIR, name, 'config.json'))) {
      return name;
    }
  } catch { /* missing file */ }
  return null;
}

/** Find the only team if exactly one exists. */
function findSoleTeam(): string | null {
  try {
    const entries = fs.readdirSync(TEAMS_BASE_DIR, { withFileTypes: true });
    const teamDirs = entries.filter(
      e => e.isDirectory() && fs.existsSync(path.join(TEAMS_BASE_DIR, e.name, 'config.json'))
    );
    if (teamDirs.length === 1) return teamDirs[0].name;
  } catch { /* missing base dir */ }
  return null;
}

/** Resolve team name: explicit flag > session match > last-used > sole team > error. */
export function resolveTeamName(flags: Record<string, string>): string {
  if (flags['team-name']) return flags['team-name'];

  // Try matching by session ID (only if explicitly provided)
  if (flags['session-id']) {
    const active = getActiveTeam(flags['session-id']);
    if (active) return active.teamName;
  }

  // Try last-used team marker
  const last = readLastTeam();
  if (last) return last;

  // Try sole team auto-detection
  const sole = findSoleTeam();
  if (sole) return sole;

  // Check if any teams exist at all
  try {
    const entries = fs.readdirSync(TEAMS_BASE_DIR, { withFileTypes: true });
    const teamDirs = entries.filter(
      e => e.isDirectory() && fs.existsSync(path.join(TEAMS_BASE_DIR, e.name, 'config.json'))
    );
    if (teamDirs.length > 1) {
      const names = teamDirs.map(e => e.name).join(', ');
      throw new Error(
        `Multiple teams found (${names}). Specify one with --team-name <name>.`
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Multiple teams')) throw e;
  }

  throw new Error(
    'No teams exist. Create one first with: copilot-teams team create --session-id <id>'
  );
}

/** Resolve session ID: explicit flag > generated. */
export function resolveSessionId(flags: Record<string, string>): string {
  return flags['session-id'] ?? `session-${crypto.randomUUID().slice(0, 8)}`;
}

/** Print a table of key-value pairs. */
export function printKV(pairs: Array<[string, string]>): void {
  const maxKey = Math.max(...pairs.map(([k]) => k.length));
  for (const [key, value] of pairs) {
    console.log(`  ${key.padEnd(maxKey)}  ${value}`);
  }
}
