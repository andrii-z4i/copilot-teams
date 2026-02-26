/**
 * Concurrency & file conflict avoidance (R20).
 *
 * Lead-mediated file claims using append-only files.md.
 * NF-4: Task claiming concurrency safety (covered by R2/R9 locking).
 * NF-5: Partitioning guidance.
 * NF-6: Detect/prevent same-file edit conflicts.
 */

import type { FileClaim, FileClaimStatus } from '../types.js';
import { resolvePath, withLock, appendFile, ensureDir } from '../utils/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── Constants ──

const FILES_FILE = 'files.md';

// ── Parsing / serialization ──

function serializeClaim(claim: FileClaim): string {
  return `[${claim.timestamp}] [${claim.teammateId}] [${claim.taskId}] [${claim.filePath}] [${claim.status}]`;
}

function parseClaim(line: string): FileClaim | null {
  const match = line.match(
    /^\[(.+?)\] \[(.+?)\] \[(.+?)\] \[(.+?)\] \[(in-use|free)\]$/
  );
  if (!match) return null;
  return {
    timestamp: match[1],
    teammateId: match[2],
    taskId: match[3],
    filePath: match[4],
    status: match[5] as FileClaimStatus,
  };
}

// ── Internal helpers ──

async function readClaims(teamName: string): Promise<FileClaim[]> {
  const filePath = resolvePath(teamName, FILES_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map(parseClaim)
      .filter((c): c is FileClaim => c !== null);
  } catch {
    return [];
  }
}

/**
 * Get the effective status for each file path.
 * The latest entry for a file determines its current status.
 */
function getActiveLeases(claims: FileClaim[]): Map<string, FileClaim> {
  const latest = new Map<string, FileClaim>();
  for (const claim of claims) {
    const existing = latest.get(claim.filePath);
    // Later entries override earlier ones (append-only means order = time)
    if (!existing || claim.timestamp >= existing.timestamp) {
      latest.set(claim.filePath, claim);
    }
  }
  // Only return in-use leases
  const active = new Map<string, FileClaim>();
  for (const [fp, claim] of latest) {
    if (claim.status === 'in-use') {
      active.set(fp, claim);
    }
  }
  return active;
}

// ── Public API ──

/**
 * Request a file claim. Lead checks for conflicts before approving.
 * Returns the claim if approved, throws if denied (NF-6).
 */
export async function claimFile(
  teamName: string,
  teammateId: string,
  taskId: string,
  filePath: string
): Promise<FileClaim> {
  const lockPath = resolvePath(teamName, FILES_FILE);
  return withLock(lockPath, async () => {
    const claims = await readClaims(teamName);
    const active = getActiveLeases(claims);

    const existing = active.get(filePath);
    if (existing && existing.teammateId !== teammateId) {
      throw new Error(
        `File conflict: ${filePath} is currently claimed by ${existing.teammateId} ` +
          `(task ${existing.taskId}). Claim denied for ${teammateId}.`
      );
    }

    const claim: FileClaim = {
      timestamp: new Date().toISOString(),
      teammateId,
      taskId,
      filePath,
      status: 'in-use',
    };

    const fp = resolvePath(teamName, FILES_FILE);
    await ensureDir(path.dirname(fp));
    await appendFile(fp, serializeClaim(claim) + '\n');
    return claim;
  });
}

/**
 * Release a file claim by appending a "free" entry.
 */
export async function releaseFile(
  teamName: string,
  teammateId: string,
  taskId: string,
  filePath: string
): Promise<FileClaim> {
  const lockPath = resolvePath(teamName, FILES_FILE);
  return withLock(lockPath, async () => {
    const claim: FileClaim = {
      timestamp: new Date().toISOString(),
      teammateId,
      taskId,
      filePath,
      status: 'free',
    };

    const fp = resolvePath(teamName, FILES_FILE);
    await ensureDir(path.dirname(fp));
    await appendFile(fp, serializeClaim(claim) + '\n');
    return claim;
  });
}

/**
 * Get all currently active file leases.
 */
export async function getActiveFileClaims(
  teamName: string
): Promise<FileClaim[]> {
  const claims = await readClaims(teamName);
  const active = getActiveLeases(claims);
  return [...active.values()];
}

/**
 * Detect file conflicts — files claimed by multiple teammates (NF-6).
 * Returns list of conflicting file paths with the involved teammates.
 */
export async function detectFileConflicts(
  teamName: string
): Promise<Array<{ filePath: string; claimedBy: string[] }>> {
  const claims = await readClaims(teamName);

  // Group all in-use claims by file path
  const byFile = new Map<string, Set<string>>();
  // Process in order; track latest status per (file, teammate)
  const latestStatus = new Map<string, FileClaimStatus>();

  for (const claim of claims) {
    const key = `${claim.filePath}::${claim.teammateId}`;
    latestStatus.set(key, claim.status);
  }

  for (const [key, status] of latestStatus) {
    if (status !== 'in-use') continue;
    const [filePath, teammateId] = key.split('::');
    if (!byFile.has(filePath)) {
      byFile.set(filePath, new Set());
    }
    byFile.get(filePath)!.add(teammateId);
  }

  const conflicts: Array<{ filePath: string; claimedBy: string[] }> = [];
  for (const [filePath, teammates] of byFile) {
    if (teammates.size > 1) {
      conflicts.push({ filePath, claimedBy: [...teammates] });
    }
  }

  return conflicts;
}

/**
 * Get files currently claimed by a specific teammate.
 */
export async function getTeammateFiles(
  teamName: string,
  teammateId: string
): Promise<string[]> {
  const claims = await readClaims(teamName);
  const active = getActiveLeases(claims);
  const files: string[] = [];
  for (const [fp, claim] of active) {
    if (claim.teammateId === teammateId) {
      files.push(fp);
    }
  }
  return files;
}

/**
 * Suggest file partitioning for a set of files across teammates (NF-5).
 * Simple round-robin assignment to avoid overlap.
 */
export function suggestFilePartitioning(
  files: string[],
  teammateIds: string[]
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const id of teammateIds) {
    result.set(id, []);
  }
  for (let i = 0; i < files.length; i++) {
    const assignee = teammateIds[i % teammateIds.length];
    result.get(assignee)!.push(files[i]);
  }
  return result;
}

/**
 * Read all raw claims from files.md (for inspection/testing).
 */
export async function readAllClaims(teamName: string): Promise<FileClaim[]> {
  return readClaims(teamName);
}
