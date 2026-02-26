/**
 * Resilience & error handling (R21).
 *
 * NF-7: Lead notification on teammate crash.
 * NF-8: Recovery — replacement teammate spawning.
 * NF-9: Orphan cleanup — stale processes, lockfiles, tmux panes.
 */

import { sendMessage } from '../comms/index.js';
import { loadTeam } from '../team/index.js';
import {
  spawnTeammate,
  getTeammateStatuses,
  type SpawnOptions,
} from '../teammate/index.js';
import { resolvePath } from '../utils/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MemberStatus } from '../types.js';

// ── Types ──

export interface CrashNotification {
  teammateName: string;
  exitCode: number | null;
  signal: string | null;
  lastStderr: string;
  timestamp: string;
}

export interface OrphanDetectionResult {
  staleLockfiles: string[];
  orphanedPids: number[];
}

// ── Crash notification (NF-7) ──

/**
 * Notify the lead that a teammate has crashed.
 * Sends a message to the lead with crash details.
 */
export async function notifyCrash(
  teamName: string,
  notification: CrashNotification
): Promise<void> {
  const body =
    `CRASH ALERT: Teammate "${notification.teammateName}" exited unexpectedly. ` +
    `Exit code: ${notification.exitCode ?? 'N/A'}, ` +
    `Signal: ${notification.signal ?? 'none'}. ` +
    (notification.lastStderr
      ? `Last stderr: ${notification.lastStderr.slice(0, 200)}`
      : 'No stderr captured.');

  await sendMessage(teamName, 'system', 'lead', body);
}

/**
 * Get all crashed teammates for a team.
 */
export function getCrashedTeammates(
  teamName: string
): Array<{ name: string; status: MemberStatus }> {
  const statuses = getTeammateStatuses(teamName);
  return statuses.filter((s) => s.status === 'crashed');
}

// ── Recovery (NF-8) ──

/**
 * Spawn a replacement teammate with the same task context.
 * The replacement inherits the original's name (with a suffix) and agent type.
 */
export async function spawnReplacement(
  teamName: string,
  leadSessionId: string,
  originalName: string,
  options?: Partial<SpawnOptions>
): Promise<ReturnType<typeof spawnTeammate>> {
  const team = loadTeam(teamName);
  const original = team.members.find((m) => m.name === originalName);

  const replacementName = options?.name ?? `${originalName}-replacement`;
  const spawnOpts: SpawnOptions = {
    name: replacementName,
    agentType: original?.agentType ?? options?.agentType ?? 'coder',
    model: original?.model ?? options?.model,
    spawnPrompt: options?.spawnPrompt ?? `Replacement for ${originalName}. Continue their work.`,
  };

  return spawnTeammate(teamName, leadSessionId, spawnOpts);
}

// ── Orphan cleanup (NF-9) ──

/**
 * Detect stale lockfiles in the team directory.
 * Lockfiles are `.lock` files left behind after unclean shutdown.
 */
export async function detectStaleLockfiles(
  teamName: string
): Promise<string[]> {
  const teamDir = resolvePath(teamName);
  const stale: string[] = [];

  try {
    const entries = await fs.readdir(teamDir);
    for (const entry of entries) {
      if (entry.endsWith('.lock')) {
        const lockPath = path.join(teamDir, entry);
        const stat = await fs.stat(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        // Consider stale if older than 30 seconds
        if (ageMs > 30_000) {
          stale.push(lockPath);
        }
      }
    }
  } catch {
    // Team dir may not exist
  }

  return stale;
}

/**
 * Clean up stale lockfiles by removing them.
 */
export async function cleanStaleLockfiles(
  teamName: string
): Promise<string[]> {
  const stale = await detectStaleLockfiles(teamName);
  for (const lockPath of stale) {
    try {
      await fs.rm(lockPath, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
  return stale;
}

/**
 * Detect orphaned teammate processes by checking PIDs.
 * Returns PIDs that are recorded in team config but no longer running.
 */
export function detectOrphanedProcesses(teamName: string): number[] {
  const team = loadTeam(teamName);
  const orphaned: number[] = [];

  for (const member of team.members) {
    if (
      member.pid &&
      (member.status === 'active' || member.status === 'spawning')
    ) {
      if (!isProcessRunning(member.pid)) {
        orphaned.push(member.pid);
      }
    }
  }

  return orphaned;
}

// Testable process checker
let processChecker: ((pid: number) => boolean) | null = null;

export function setProcessChecker(
  checker: ((pid: number) => boolean) | null
): void {
  processChecker = checker;
}

function isProcessRunning(pid: number): boolean {
  if (processChecker) {
    return processChecker(pid);
  }
  try {
    // kill(pid, 0) checks if process exists without sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Full orphan detection: stale lockfiles + orphaned processes.
 */
export async function detectOrphans(
  teamName: string
): Promise<OrphanDetectionResult> {
  const staleLockfiles = await detectStaleLockfiles(teamName);
  const orphanedPids = detectOrphanedProcesses(teamName);
  return { staleLockfiles, orphanedPids };
}
