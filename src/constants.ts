/**
 * Shared constants for Copilot Teams.
 */

import path from 'node:path';
import os from 'node:os';

// ── Well-known paths ──

export const TEAMS_BASE_DIR = path.join(os.homedir(), '.copilot', 'teams');

export function teamDir(teamName: string): string {
  return path.join(TEAMS_BASE_DIR, teamName);
}

export function teamFilePath(teamName: string, file: string): string {
  return path.join(TEAMS_BASE_DIR, teamName, file);
}

// Team file names
export const CONFIG_FILE = 'config.json';
export const BACKLOG_FILE = 'backlog.md';
export const MESSAGES_FILE = 'messages.md';
export const SPRINT_FILE = 'sprint.md';
export const FILES_FILE = 'files.md';
export const PERMISSION_AUDIT_FILE = 'permission-audit.log';

// ── Task states ──

export const TASK_STATES = ['pending', 'in_progress', 'completed'] as const;

// ── Complexity weights ──

export const COMPLEXITY_WEIGHTS = {
  S: 1,
  M: 1.33,
  L: 2,
  XL: 4,
} as const;

export const CAPACITY_PER_ITERATION = 4;

// ── Member statuses ──

export const MEMBER_STATUSES = ['spawning', 'active', 'idle', 'stopped', 'crashed'] as const;

// ── Sprint statuses ──

export const SPRINT_STATUSES = ['planning', 'active', 'closed'] as const;

// ── Teammate modes ──

export const TEAMMATE_MODES = ['auto', 'in-process', 'tmux'] as const;

// ── Environment variables ──

export const ENV_TEAMS_ENABLED = 'COPILOT_TEAMS_ENABLED';

// ── Input Validation ──

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const SAFE_TEAM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function validateIdentifier(id: string, label: string = 'Identifier'): void {
  if (!id || id.length === 0) throw new Error(`${label} must not be empty.`);
  if (id.length > 64) throw new Error(`${label} must be at most 64 characters.`);
  if (!SAFE_ID_PATTERN.test(id)) throw new Error(`${label} contains invalid characters. Must match ${SAFE_ID_PATTERN}.`);
}

export function validateTeamName(name: string): void {
  if (!name || name.length === 0) throw new Error('Team name must not be empty.');
  if (name.length > 50) throw new Error('Team name must be at most 50 characters.');
  if (!SAFE_TEAM_NAME_PATTERN.test(name)) throw new Error(`Team name contains invalid characters. Must match ${SAFE_TEAM_NAME_PATTERN}.`);
}
