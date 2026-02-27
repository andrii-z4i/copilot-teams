import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  generateTeamName,
  createTeam,
  loadTeam,
  saveTeam,
  getActiveTeam,
  assertNoActiveTeam,
  assertIsLead,
  assertNotTeammate,
  updateTeam,
  cleanupTeam,
  areAllTeammatesStopped,
  getRunningTeammates,
} from '../../src/team/index.js';
import * as constants from '../../src/constants.js';

let originalTeamsBaseDir: string;
let tmpBase: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-teams-team-test-'));
  originalTeamsBaseDir = constants.TEAMS_BASE_DIR;
  // Override TEAMS_BASE_DIR to use temp directory
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: tmpBase,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: originalTeamsBaseDir,
    writable: true,
    configurable: true,
  });
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('generateTeamName', () => {
  it('produces a name matching adjective-noun-hash pattern', () => {
    const name = generateTeamName();
    expect(name).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
  });

  it('generates unique names', () => {
    const names = new Set(Array.from({ length: 20 }, () => generateTeamName()));
    // With 4-hex-char hash, collisions among 20 are extremely unlikely
    expect(names.size).toBe(20);
  });
});

describe('createTeam', () => {
  it('generates unique name and persists valid config', async () => {
    const config = await createTeam({ leadSessionId: 'lead-1' });

    expect(config.teamName).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
    expect(config.teamId).toBeTruthy();
    expect(config.leadSessionId).toBe('lead-1');
    expect(config.createdAt).toBeTruthy();
    expect(config.members).toEqual([]);

    // Verify file on disk — directory is named by teamId (UUID), not teamName
    const filePath = path.join(tmpBase, config.teamId, 'config.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(persisted.teamName).toBe(config.teamName);
    expect(persisted.teamId).toBe(config.teamId);
  });

  it('accepts a custom team name', async () => {
    const config = await createTeam({ leadSessionId: 'lead-1', teamName: 'my-custom-team' });
    expect(config.teamName).toBe('my-custom-team');
  });

  it('persists initial members with spawning status', async () => {
    const config = await createTeam({
      leadSessionId: 'lead-1',
      members: [
        { name: 'reviewer-1', agentId: 'agent-1', agentType: 'reviewer' },
        { name: 'coder-1', agentId: 'agent-2', agentType: 'coder' },
      ],
    });

    expect(config.members).toHaveLength(2);
    expect(config.members[0]).toMatchObject({
      name: 'reviewer-1',
      agentId: 'agent-1',
      agentType: 'reviewer',
      status: 'spawning',
    });
    expect(config.members[1].status).toBe('spawning');
  });

  it('fails if an active team already exists for the session (TL-9)', async () => {
    await createTeam({ leadSessionId: 'lead-1' });
    await expect(createTeam({ leadSessionId: 'lead-1' })).rejects.toThrow(
      'An active team',
    );
  });

  it('allows different sessions to create teams', async () => {
    const c1 = await createTeam({ leadSessionId: 'lead-1' });
    const c2 = await createTeam({ leadSessionId: 'lead-2' });
    expect(c1.teamName).not.toBe(c2.teamName);
  });

  it('initializes permission-audit.log, files.md, and hooks.json on creation', async () => {
    const config = await createTeam({ leadSessionId: 'lead-1', teamName: 'audit-init-test' });
    const teamDir = path.join(tmpBase, config.teamId);

    expect(fs.existsSync(path.join(teamDir, 'permission-audit.log'))).toBe(true);
    expect(fs.existsSync(path.join(teamDir, 'files.md'))).toBe(true);
    expect(fs.existsSync(path.join(teamDir, 'hooks.json'))).toBe(true);

    expect(fs.readFileSync(path.join(teamDir, 'permission-audit.log'), 'utf-8')).toBe('');
    expect(fs.readFileSync(path.join(teamDir, 'files.md'), 'utf-8')).toBe('');
    expect(JSON.parse(fs.readFileSync(path.join(teamDir, 'hooks.json'), 'utf-8'))).toEqual([]);
  });
});

describe('loadTeam', () => {
  it('correctly reads persisted config', async () => {
    const original = await createTeam({ leadSessionId: 'lead-1', teamName: 'load-test' });
    const loaded = loadTeam('load-test');
    expect(loaded.teamName).toBe(original.teamName);
    expect(loaded.leadSessionId).toBe('lead-1');
    expect(loaded.createdAt).toBe(original.createdAt);
  });

  it('throws for non-existent team', () => {
    expect(() => loadTeam('nonexistent')).toThrow('Team "nonexistent" not found');
  });
});

describe('getActiveTeam', () => {
  it('returns config for existing lead session', async () => {
    const created = await createTeam({ leadSessionId: 'lead-1', teamName: 'active-test' });
    const found = getActiveTeam('lead-1');
    expect(found).not.toBeNull();
    expect(found!.teamName).toBe(created.teamName);
  });

  it('returns null for unknown session', () => {
    expect(getActiveTeam('unknown')).toBeNull();
  });
});

describe('assertIsLead (TL-10)', () => {
  it('does not throw for the actual lead', async () => {
    const config = await createTeam({ leadSessionId: 'lead-1', teamName: 'lead-test' });
    expect(() => assertIsLead('lead-1', config)).not.toThrow();
  });

  it('throws for a non-lead session', async () => {
    const config = await createTeam({ leadSessionId: 'lead-1', teamName: 'lead-test2' });
    expect(() => assertIsLead('not-lead', config)).toThrow('is not the lead');
  });
});

describe('assertNotTeammate (TL-11)', () => {
  it('does not throw for unknown session', () => {
    expect(() => assertNotTeammate('random-session')).not.toThrow();
  });

  it('throws if session is a teammate in any team', async () => {
    const config = await createTeam({
      leadSessionId: 'lead-1',
      teamName: 'teammate-guard-test',
      members: [{ name: 'worker', agentId: 'teammate-session', agentType: 'worker' }],
    });

    expect(() => assertNotTeammate('teammate-session')).toThrow(
      'Teammates cannot create their own teams',
    );
  });

  it('does not throw for the lead session itself', async () => {
    await createTeam({
      leadSessionId: 'lead-1',
      teamName: 'lead-not-teammate',
      members: [{ name: 'worker', agentId: 'lead-1', agentType: 'worker' }],
    });
    // Lead shares agentId with a member entry but is the lead, so should not throw
    expect(() => assertNotTeammate('lead-1')).not.toThrow();
  });
});

describe('updateTeam', () => {
  it('updates config atomically', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'update-test' });
    const updated = await updateTeam('update-test', 'lead-1', (config) => ({
      ...config,
      members: [
        ...config.members,
        { name: 'new-member', agentId: 'ag-1', agentType: 'worker', status: 'active' },
      ],
    }));
    expect(updated.members).toHaveLength(1);
    expect(updated.members[0].name).toBe('new-member');

    // Verify persisted
    const loaded = loadTeam('update-test');
    expect(loaded.members).toHaveLength(1);
  });

  it('rejects update from non-lead', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'update-guard' });
    await expect(
      updateTeam('update-guard', 'not-lead', (c) => c),
    ).rejects.toThrow('is not the lead');
  });
});

describe('team config structure (TL-4)', () => {
  it('has correct members array structure', async () => {
    const config = await createTeam({
      leadSessionId: 'lead-1',
      teamName: 'structure-test',
      members: [
        { name: 'sec-reviewer', agentId: 'a1', agentType: 'reviewer', model: 'gpt-4o' },
      ],
    });

    const member = config.members[0];
    expect(member).toHaveProperty('name', 'sec-reviewer');
    expect(member).toHaveProperty('agentId', 'a1');
    expect(member).toHaveProperty('agentType', 'reviewer');
    expect(member).toHaveProperty('status', 'spawning');
  });
});

// ── R4: Team Cleanup ──

describe('areAllTeammatesStopped', () => {
  it('returns true when all members are stopped or crashed', () => {
    const config: any = {
      members: [
        { name: 'a', status: 'stopped' },
        { name: 'b', status: 'crashed' },
      ],
    };
    expect(areAllTeammatesStopped(config)).toBe(true);
  });

  it('returns true when there are no members', () => {
    const config: any = { members: [] };
    expect(areAllTeammatesStopped(config)).toBe(true);
  });

  it('returns false when any member is active', () => {
    const config: any = {
      members: [
        { name: 'a', status: 'stopped' },
        { name: 'b', status: 'active' },
      ],
    };
    expect(areAllTeammatesStopped(config)).toBe(false);
  });

  it('returns false when any member is idle', () => {
    const config: any = {
      members: [{ name: 'a', status: 'idle' }],
    };
    expect(areAllTeammatesStopped(config)).toBe(false);
  });

  it('returns false when any member is spawning', () => {
    const config: any = {
      members: [{ name: 'a', status: 'spawning' }],
    };
    expect(areAllTeammatesStopped(config)).toBe(false);
  });
});

describe('cleanupTeam', () => {
  it('succeeds when all teammates are stopped', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'cleanup-ok' });
    await updateTeam('cleanup-ok', 'lead-1', (c) => ({
      ...c,
      members: [{ name: 'worker', agentId: 'a1', agentType: 'worker', status: 'stopped' }],
    }));

    const result = await cleanupTeam('cleanup-ok', 'lead-1');
    expect(result.success).toBe(true);
    expect(result.teamName).toBe('cleanup-ok');

    // Verify directory removed
    expect(() => loadTeam('cleanup-ok')).toThrow('not found');
  });

  it('succeeds with no members', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'cleanup-empty' });
    const result = await cleanupTeam('cleanup-empty', 'lead-1');
    expect(result.success).toBe(true);
  });

  it('fails with clear error listing running teammates (TL-7)', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'cleanup-fail' });
    await updateTeam('cleanup-fail', 'lead-1', (c) => ({
      ...c,
      members: [
        { name: 'worker-a', agentId: 'a1', agentType: 'worker', status: 'active' },
        { name: 'worker-b', agentId: 'a2', agentType: 'worker', status: 'stopped' },
        { name: 'worker-c', agentId: 'a3', agentType: 'worker', status: 'idle' },
      ],
    }));

    const result = await cleanupTeam('cleanup-fail', 'lead-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('2 teammate(s) still running');
    expect(result.runningTeammates).toEqual(['worker-a', 'worker-c']);

    // Verify directory still exists
    expect(() => loadTeam('cleanup-fail')).not.toThrow();
  });

  it('preserves artifact files and removes only config on cleanup (TL-8)', async () => {
    const team = await createTeam({ leadSessionId: 'lead-1', teamName: 'cleanup-full' });

    // Create additional team files (artifacts)
    const teamDir = path.join(tmpBase, team.teamId);
    fs.writeFileSync(path.join(teamDir, 'backlog.md'), '# Backlog');
    fs.writeFileSync(path.join(teamDir, 'messages.md'), '# Messages');
    fs.writeFileSync(path.join(teamDir, 'sprint.md'), '# Sprint');
    fs.writeFileSync(path.join(teamDir, 'files.md'), '');
    fs.writeFileSync(path.join(teamDir, 'permission-audit.log'), '');

    const result = await cleanupTeam('cleanup-full', 'lead-1');
    expect(result.success).toBe(true);

    // Config removed — team is no longer discoverable
    expect(fs.existsSync(path.join(teamDir, 'config.json'))).toBe(false);
    // Artifact files preserved for audit
    expect(fs.existsSync(path.join(teamDir, 'backlog.md'))).toBe(true);
    expect(fs.existsSync(path.join(teamDir, 'messages.md'))).toBe(true);
    // Directory itself still exists
    expect(fs.existsSync(teamDir)).toBe(true);
  });

  it('non-lead cannot clean up team', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'cleanup-guard' });
    await expect(cleanupTeam('cleanup-guard', 'not-lead')).rejects.toThrow('is not the lead');
  });
});
