import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  notifyCrash,
  getCrashedTeammates,
  spawnReplacement,
  detectStaleLockfiles,
  cleanStaleLockfiles,
  detectOrphanedProcesses,
  setProcessChecker,
  type CrashNotification,
} from '../../src/utils/resilience.js';
import * as constants from '../../src/constants.js';
import { createTempDir, cleanupTempDir } from '../helpers.js';
import { createTeam, loadTeam } from '../../src/team/index.js';
import { readAllMessages } from '../../src/comms/index.js';
import {
  setSpawnCommandBuilder,
  resetSpawnCommandBuilder,
  clearProcesses,
} from '../../src/teammate/index.js';
import { resolvePath } from '../../src/utils/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';

let tmpBase: string;
const teamName = 'resilience-test';

beforeEach(async () => {
  tmpBase = createTempDir();
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: tmpBase,
    writable: true,
    configurable: true,
  });
  await createTeam({ leadSessionId: 'lead-session-1', teamName });
  setSpawnCommandBuilder((opts) => ({
    command: 'node',
    args: ['-e', `setTimeout(() => {}, 60000)`],
  }));
});

afterEach(() => {
  clearProcesses();
  resetSpawnCommandBuilder();
  setProcessChecker(null);
  cleanupTempDir(tmpBase);
});

describe('crash notification (NF-7)', () => {
  it('lead is notified on teammate crash', async () => {
    const notification: CrashNotification = {
      teammateName: 'tm-1',
      exitCode: 1,
      signal: null,
      lastStderr: 'Error: out of memory',
      timestamp: new Date().toISOString(),
    };

    await notifyCrash(teamName, notification);

    const messages = readAllMessages(teamName);
    expect(messages).toHaveLength(1);
    expect(messages[0].from).toBe('system');
    expect(messages[0].to).toBe('lead');
    expect(messages[0].body).toContain('CRASH ALERT');
    expect(messages[0].body).toContain('tm-1');
    expect(messages[0].body).toContain('Exit code: 1');
    expect(messages[0].body).toContain('out of memory');
  });

  it('crash notification with signal', async () => {
    await notifyCrash(teamName, {
      teammateName: 'tm-2',
      exitCode: null,
      signal: 'SIGSEGV',
      lastStderr: '',
      timestamp: new Date().toISOString(),
    });

    const messages = readAllMessages(teamName);
    expect(messages[0].body).toContain('SIGSEGV');
  });
});

describe('replacement teammate (NF-8)', () => {
  it('replacement teammate can be spawned with same context', async () => {
    const replacement = await spawnReplacement(
      teamName,
      'lead-session-1',
      'tm-1',
      { agentType: 'coder' }
    );

    expect(replacement.name).toBe('tm-1');
    expect(replacement.process).toBeDefined();

    const team = loadTeam(teamName);
    const member = team.members.find((m) => m.name === 'tm-1');
    expect(member).toBeDefined();
    expect(member!.status).toBe('active');
  });

  it('replacement inherits original agentType if original exists', async () => {
    // First spawn original
    await (await import('../../src/teammate/index.js')).spawnTeammate(
      teamName,
      'lead-session-1',
      { name: 'tm-original', agentType: 'reviewer' }
    );

    const replacement = await spawnReplacement(
      teamName,
      'lead-session-1',
      'tm-original'
    );

    expect(replacement.name).toBe('tm-original');
    const team = loadTeam(teamName);
    const member = team.members.find(
      (m) => m.name === 'tm-original'
    );
    expect(member!.agentType).toBe('reviewer');
  });
});

describe('stale lockfile detection (NF-9)', () => {
  it('detects stale lockfiles', async () => {
    const teamDir = resolvePath(teamName);
    const lockPath = path.join(teamDir, 'backlog.md.lock');
    await fs.mkdir(lockPath, { recursive: true });

    // Make it appear old by changing mtime
    const pastTime = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, pastTime, pastTime);

    const stale = await detectStaleLockfiles(teamName);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain('backlog.md.lock');
  });

  it('does not flag fresh lockfiles as stale', async () => {
    const teamDir = resolvePath(teamName);
    const lockPath = path.join(teamDir, 'fresh.lock');
    await fs.mkdir(lockPath, { recursive: true });
    // mtime is now — not stale

    const stale = await detectStaleLockfiles(teamName);
    expect(stale).toHaveLength(0);
  });

  it('cleanStaleLockfiles removes stale locks', async () => {
    const teamDir = resolvePath(teamName);
    const lockPath = path.join(teamDir, 'old.lock');
    await fs.mkdir(lockPath, { recursive: true });
    const pastTime = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, pastTime, pastTime);

    const cleaned = await cleanStaleLockfiles(teamName);
    expect(cleaned).toHaveLength(1);

    // Verify it's gone
    const remaining = await detectStaleLockfiles(teamName);
    expect(remaining).toHaveLength(0);
  });
});

describe('orphaned process detection (NF-9)', () => {
  it('detects orphaned PIDs that are no longer running', async () => {
    // Spawn a teammate to register a PID
    await (await import('../../src/teammate/index.js')).spawnTeammate(
      teamName,
      'lead-session-1',
      { name: 'tm-orphan', agentType: 'coder' }
    );

    const team = loadTeam(teamName);
    const member = team.members.find((m) => m.name === 'tm-orphan');
    expect(member?.pid).toBeDefined();

    // Simulate the process no longer running
    setProcessChecker(() => false);

    const orphaned = detectOrphanedProcesses(teamName);
    expect(orphaned).toContain(member!.pid);
  });

  it('does not flag running processes as orphaned', async () => {
    await (await import('../../src/teammate/index.js')).spawnTeammate(
      teamName,
      'lead-session-1',
      { name: 'tm-alive', agentType: 'coder' }
    );

    setProcessChecker(() => true);

    const orphaned = detectOrphanedProcesses(teamName);
    expect(orphaned).toHaveLength(0);
  });
});
