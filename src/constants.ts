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
