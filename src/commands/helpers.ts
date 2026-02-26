/**
 * CLI helpers shared across commands.
 */

import crypto from 'node:crypto';
import { getActiveTeam } from '../team/index.js';

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

/** Resolve team name: explicit flag > active team > error. */
export function resolveTeamName(flags: Record<string, string>): string {
  if (flags['team-name']) return flags['team-name'];

  const sessionId = resolveSessionId(flags);
  const active = getActiveTeam(sessionId);
  if (active) return active.teamName;

  throw new Error(
    'No team specified and no active team found. Use --team-name or create a team first.'
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
