/**
 * Team lifecycle — creation, loading, constraints, and cleanup.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { resolveTeamFile, ensureTeamDir, atomicWriteFile, withLock } from '../utils/index.js';
import { TEAMS_BASE_DIR } from '../constants.js';
import type { TeamConfig, TeamMember, MemberStatus } from '../types.js';

// ── Name Generation ──

const ADJECTIVES = [
  'swift',
  'bold',
  'calm',
  'keen',
  'bright',
  'quick',
  'sharp',
  'warm',
  'cool',
  'fair',
  'brave',
  'wise',
  'kind',
  'neat',
  'deep',
  'vivid',
];

const NOUNS = [
  'falcon',
  'otter',
  'cedar',
  'spark',
  'river',
  'maple',
  'cloud',
  'stone',
  'ridge',
  'flame',
  'brook',
  'crane',
  'lark',
  'pine',
  'wave',
  'moss',
];

/**
 * Generate a unique, human-readable team name (e.g., "swift-falcon-a3b2").
 */
export function generateTeamName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const hash = crypto.randomBytes(2).toString('hex');
  return `${adj}-${noun}-${hash}`;
}

// ── Persistence ──

function configPath(teamId: string): string {
  return resolveTeamFile(teamId, 'config');
}

/**
 * Load and parse a team config from a specific team directory.
 * The directory name is the teamId (UUID).
 */
export function loadTeamByDir(dirName: string): TeamConfig {
  const filePath = resolveTeamFile(dirName, 'config');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Team directory "${dirName}" has no config at ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as TeamConfig;
}

/**
 * Load and parse a team config by human-readable team name.
 * Scans all team directories (named by teamId) to find the matching config.
 */
export function loadTeam(teamName: string): TeamConfig {
  if (!fs.existsSync(TEAMS_BASE_DIR)) {
    throw new Error(`Team "${teamName}" not found`);
  }
  const entries = fs.readdirSync(TEAMS_BASE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const config = loadTeamByDir(entry.name);
      if (config.teamName === teamName) {
        return config;
      }
    } catch {
      // Skip invalid/corrupt team dirs
    }
  }
  throw new Error(`Team "${teamName}" not found`);
}

/**
 * Persist a team config to disk atomically.
 */
export function saveTeam(config: TeamConfig): void {
  ensureTeamDir(config.teamId);
  atomicWriteFile(configPath(config.teamId), JSON.stringify(config, null, 2));
}

// ── Active Team Discovery ──

/**
 * Find the active team for a given lead session, if any.
 * Scans all team directories under TEAMS_BASE_DIR.
 */
export function getActiveTeam(leadSessionId: string): TeamConfig | null {
  if (!fs.existsSync(TEAMS_BASE_DIR)) {
    return null;
  }
  const entries = fs.readdirSync(TEAMS_BASE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const config = loadTeamByDir(entry.name);
      if (config.leadSessionId === leadSessionId) {
        return config;
      }
    } catch {
      // Skip invalid/corrupt team dirs
    }
  }
  return null;
}

// ── Guards ──

/**
 * Assert that no active team exists for this lead session (TL-9).
 */
export function assertNoActiveTeam(leadSessionId: string): void {
  const existing = getActiveTeam(leadSessionId);
  if (existing) {
    throw new Error(
      `An active team "${existing.teamName}" already exists for this session. ` +
        'Only one team may be active per lead session at a time (TL-9). ' +
        'Clean up the existing team before creating a new one.',
    );
  }
}

/**
 * Assert that the given session is the team lead (TL-10).
 */
export function assertIsLead(sessionId: string, config: TeamConfig): void {
  if (config.leadSessionId !== sessionId) {
    throw new Error(
      `Session "${sessionId}" is not the lead of team "${config.teamName}". ` +
        'Only the team lead can perform this operation (TL-10).',
    );
  }
}

/**
 * Assert that a session is not already a teammate in any team (TL-11).
 * Teammates cannot create their own teams.
 */
export function assertNotTeammate(sessionId: string): void {
  if (!fs.existsSync(TEAMS_BASE_DIR)) {
    return;
  }
  const entries = fs.readdirSync(TEAMS_BASE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const config = loadTeamByDir(entry.name);
      const isMember = config.members.some(
        (m) => m.agentId === sessionId && config.leadSessionId !== sessionId,
      );
      if (isMember) {
        throw new Error(
          `Session "${sessionId}" is a teammate in team "${config.teamName}". ` +
            'Teammates cannot create their own teams (TL-11).',
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Teammates cannot create')) {
        throw err;
      }
      // Skip invalid team dirs
    }
  }
}

// ── Team Creation ──

export interface CreateTeamOptions {
  leadSessionId: string;
  members?: Omit<TeamMember, 'status'>[];
  teamName?: string;
}

/**
 * Create a new team with the given lead session and optional initial members.
 * Enforces: TL-3, TL-4, TL-5, TL-9, TL-10, TL-11
 */
export async function createTeam(options: CreateTeamOptions): Promise<TeamConfig> {
  const { leadSessionId, members = [], teamName: customName } = options;

  // Guards
  assertNotTeammate(leadSessionId);
  assertNoActiveTeam(leadSessionId);

  const teamId = crypto.randomUUID();
  const teamName = customName ?? generateTeamName();

  const config: TeamConfig = {
    teamId,
    teamName,
    leadSessionId,
    createdAt: new Date().toISOString(),
    members: members.map((m) => ({
      ...m,
      status: 'spawning' as const,
    })),
  };

  // Persist under lock — directory is named by teamId
  const lockPath = resolveTeamFile(teamId, 'config');
  ensureTeamDir(teamId);

  await withLock(lockPath, () => {
    saveTeam(config);
  });

  return config;
}

// ── Team Update ──

/**
 * Update team config atomically under lock. Lead-only operation.
 */
export async function updateTeam(
  teamName: string,
  leadSessionId: string,
  updater: (config: TeamConfig) => TeamConfig,
): Promise<TeamConfig> {
  const config = loadTeam(teamName);
  const lockPath = resolveTeamFile(config.teamId, 'config');

  return withLock(lockPath, () => {
    const current = loadTeamByDir(config.teamId);
    assertIsLead(leadSessionId, current);
    const updated = updater(current);
    saveTeam(updated);
    return updated;
  });
}

// ── Team Cleanup ──

const RUNNING_STATUSES: MemberStatus[] = ['spawning', 'active', 'idle'];

/**
 * Check whether all teammates have stopped (not spawning, active, or idle).
 */
export function areAllTeammatesStopped(config: TeamConfig): boolean {
  return config.members.every((m) => !RUNNING_STATUSES.includes(m.status));
}

/**
 * Get list of teammates that are still running.
 */
export function getRunningTeammates(config: TeamConfig): TeamMember[] {
  return config.members.filter((m) => RUNNING_STATUSES.includes(m.status));
}

export interface CleanupResult {
  success: boolean;
  teamName: string;
  error?: string;
  runningTeammates?: string[];
}

/**
 * Clean up a team — removes the team config so the team is no longer active,
 * but preserves all artifact files (backlog, messages, sprint, reports, etc.)
 * for future audit (TL-6, TL-7, TL-8).
 * Fails if any teammates are still running.
 */
export async function cleanupTeam(
  teamName: string,
  leadSessionId: string,
): Promise<CleanupResult> {
  const config = loadTeam(teamName);
  assertIsLead(leadSessionId, config);

  // TL-7: Fail if teammates are still running
  const running = getRunningTeammates(config);
  if (running.length > 0) {
    const names = running.map((m) => `${m.name} (${m.status})`);
    return {
      success: false,
      teamName,
      error:
        `Cannot clean up team "${teamName}": ${running.length} teammate(s) still running. ` +
        `Shut them down first: ${names.join(', ')}`,
      runningTeammates: running.map((m) => m.name),
    };
  }

  // TL-8: Remove only the team config so the team is no longer discoverable,
  // while preserving all artifact files (backlog, messages, sprint, reports, etc.)
  const configFilePath = resolveTeamFile(config.teamId, 'config');
  fs.rmSync(configFilePath, { force: true });

  return { success: true, teamName };
}
