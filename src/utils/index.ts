/**
 * Local file storage utilities — path resolution, atomic writes, file locking.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import lockfile from 'proper-lockfile';
import {
  TEAMS_BASE_DIR,
  CONFIG_FILE,
  BACKLOG_FILE,
  MESSAGES_FILE,
  SPRINT_FILE,
  FILES_FILE,
  PERMISSION_AUDIT_FILE,
} from '../constants.js';

// ── Path Resolution ──

const KNOWN_FILES = {
  config: CONFIG_FILE,
  backlog: BACKLOG_FILE,
  messages: MESSAGES_FILE,
  sprint: SPRINT_FILE,
  files: FILES_FILE,
  'permission-audit': PERMISSION_AUDIT_FILE,
} as const;

export type KnownFile = keyof typeof KNOWN_FILES;

/**
 * Resolve the path to a team's directory or a specific file within it.
 */
export function resolvePath(teamName: string, ...segments: string[]): string {
  return path.join(TEAMS_BASE_DIR, teamName, ...segments);
}

/**
 * Resolve the path to a well-known team file.
 */
export function resolveTeamFile(teamName: string, file: KnownFile): string {
  return resolvePath(teamName, KNOWN_FILES[file]);
}

/**
 * Get all well-known file paths for a team.
 */
export function resolveAllTeamFiles(teamName: string): Record<KnownFile, string> {
  const result = {} as Record<KnownFile, string>;
  for (const key of Object.keys(KNOWN_FILES) as KnownFile[]) {
    result[key] = resolveTeamFile(teamName, key);
  }
  return result;
}

// ── Directory Management ──

/**
 * Create directory tree if it does not exist.
 */
export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Ensure the team directory exists.
 */
export function ensureTeamDir(teamName: string): string {
  const dir = resolvePath(teamName);
  ensureDir(dir);
  return dir;
}

// ── Atomic File Operations ──

/**
 * Write file atomically via temp-file-then-rename pattern.
 * Prevents partial reads by other processes.
 */
export function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Append content to a file atomically (read + write pattern under lock).
 * For append-only files like messages.md, sprint.md, files.md.
 */
export function appendFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.appendFileSync(filePath, content, 'utf-8');
}

// ── File Locking ──

const DEFAULT_LOCK_OPTIONS: lockfile.LockOptions = {
  stale: 10000, // Consider lock stale after 10s
  retries: {
    retries: 5,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 2000,
  },
};

/**
 * Acquire an advisory file lock on the given path.
 * Returns a release function that MUST be called to free the lock.
 */
export async function acquireLock(
  filePath: string,
  options?: lockfile.LockOptions,
): Promise<() => Promise<void>> {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  // proper-lockfile requires the file to exist
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf-8');
  }
  const release = await lockfile.lock(filePath, { ...DEFAULT_LOCK_OPTIONS, ...options });
  return release;
}

/**
 * Check if a file is currently locked.
 */
export async function isLocked(filePath: string): Promise<boolean> {
  try {
    return await lockfile.check(filePath);
  } catch {
    return false;
  }
}

/**
 * Execute a callback while holding a lock on the given file.
 * The lock is released after the callback completes (or throws).
 */
export async function withLock<T>(
  filePath: string,
  fn: () => T | Promise<T>,
  options?: lockfile.LockOptions,
): Promise<T> {
  const release = await acquireLock(filePath, options);
  try {
    return await fn();
  } finally {
    await release();
  }
}
