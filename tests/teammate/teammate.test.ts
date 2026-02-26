import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  spawnTeammate,
  spawnMultipleTeammates,
  getTeammateStatuses,
  formatTeammateList,
  getProcess,
  getAllProcesses,
  clearProcesses,
  setSpawnCommandBuilder,
  resetSpawnCommandBuilder,
  requestShutdown,
  forceShutdown,
  registerShutdownHandler,
  unregisterShutdownHandler,
} from '../../src/teammate/index.js';
import { createTeam } from '../../src/team/index.js';
import * as constants from '../../src/constants.js';
import type { SpawnOptions } from '../../src/teammate/index.js';

let originalTeamsBaseDir: string;
let tmpBase: string;

/**
 * Configure spawn to use a simple Node.js script that stays alive.
 * The real spawn passes the prompt via -p flag in args; the test builder
 * receives it via the spawnPrompt in options and echoes it via stdout.
 */
function setupTestSpawnBuilder() {
  setSpawnCommandBuilder((_teamName, options, _config) => ({
    command: process.execPath,
    args: [
      '-e',
      `
      const prompt = process.env.COPILOT_TEAMS_SPAWN_PROMPT || '';
      process.stdout.write('GOT: ' + prompt + '\\n');
      process.stdout.write('READY:' + process.env.COPILOT_TEAMS_TEAMMATE_NAME + '\\n');
      setTimeout(() => process.exit(0), 5000);
      `,
    ],
    env: {
      COPILOT_TEAMS_TEAMMATE: '1',
      COPILOT_TEAMS_TEAM_NAME: _teamName,
      COPILOT_TEAMS_TEAMMATE_NAME: options.name,
      COPILOT_TEAMS_SPAWN_PROMPT: options.spawnPrompt,
    },
  }));
}

beforeEach(async () => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-teams-teammate-test-'));
  originalTeamsBaseDir = constants.TEAMS_BASE_DIR;
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: tmpBase,
    writable: true,
    configurable: true,
  });
  clearProcesses();
  setupTestSpawnBuilder();
});

afterEach(async () => {
  // Kill any remaining child processes
  for (const proc of getAllProcesses('test-team')) {
    try {
      proc.process.kill('SIGTERM');
    } catch {
      // already dead
    }
  }
  clearProcesses();
  resetSpawnCommandBuilder();
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: originalTeamsBaseDir,
    writable: true,
    configurable: true,
  });
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('spawnTeammate', () => {
  it('creates a new process and registers in team config', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'test-team' });

    const proc = await spawnTeammate('test-team', 'lead-1', {
      name: 'worker-a',
      spawnPrompt: 'You are a test worker.',
    });

    expect(proc.name).toBe('worker-a');
    expect(proc.pid).toBeGreaterThan(0);
    expect(proc.teamName).toBe('test-team');

    // Verify registered in process map
    const registered = getProcess('test-team', 'worker-a');
    expect(registered).toBeDefined();
    expect(registered!.pid).toBe(proc.pid);

    // Verify team config updated
    const statuses = getTeammateStatuses('test-team');
    const worker = statuses.find((s) => s.name === 'worker-a');
    expect(worker).toBeDefined();
    expect(worker!.status).toBe('active');
    expect(worker!.pid).toBe(proc.pid);
  });

  it('spawn prompt is passed as initial context, not lead history (TM-5)', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'test-team' });

    const proc = await spawnTeammate('test-team', 'lead-1', {
      name: 'worker-prompt',
      spawnPrompt: 'CUSTOM_PROMPT_CONTENT',
    });

    // The spawn prompt is written to stdin; verify the process received it
    const output = await new Promise<string>((resolve) => {
      let data = '';
      proc.process.stdout!.on('data', (chunk) => {
        data += chunk.toString();
        if (data.includes('GOT: CUSTOM_PROMPT_CONTENT')) {
          resolve(data);
        }
      });
      setTimeout(() => resolve(data), 1000);
    });

    expect(output).toContain('GOT: CUSTOM_PROMPT_CONTENT');
  });

  it('model override is applied correctly (TM-3)', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'test-team' });

    await spawnTeammate('test-team', 'lead-1', {
      name: 'model-worker',
      model: 'gpt-4o',
      spawnPrompt: 'test',
    });

    const statuses = getTeammateStatuses('test-team');
    const worker = statuses.find((s) => s.name === 'model-worker');
    expect(worker).toBeDefined();
    expect(worker!.model).toBe('gpt-4o');
  });

  it('project context (cwd) is inherited by teammate (TM-4)', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'test-team' });

    // Use a command builder that echoes cwd
    setSpawnCommandBuilder((_teamName, options, _config) => ({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.cwd()); process.exit(0);'],
      env: {
        COPILOT_TEAMS_TEAMMATE: '1',
        COPILOT_TEAMS_TEAM_NAME: _teamName,
        COPILOT_TEAMS_TEAMMATE_NAME: options.name,
      },
    }));

    const proc = await spawnTeammate('test-team', 'lead-1', {
      name: 'cwd-worker',
      spawnPrompt: 'test',
    });

    const output = await new Promise<string>((resolve) => {
      let data = '';
      proc.process.stdout!.on('data', (chunk) => {
        data += chunk.toString();
      });
      proc.process.on('exit', () => resolve(data));
      setTimeout(() => resolve(data), 1000);
    });

    expect(output).toBe(process.cwd());
  });
});

describe('spawnMultipleTeammates (TM-2)', () => {
  it('batch spawn creates N teammates', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'test-team' });

    const procs = await spawnMultipleTeammates('test-team', 'lead-1', [
      { name: 'worker-1', spawnPrompt: 'task 1' },
      { name: 'worker-2', spawnPrompt: 'task 2' },
      { name: 'worker-3', spawnPrompt: 'task 3' },
    ]);

    expect(procs).toHaveLength(3);
    expect(procs.map((p) => p.name).sort()).toEqual(['worker-1', 'worker-2', 'worker-3']);

    const allProcs = getAllProcesses('test-team');
    expect(allProcs).toHaveLength(3);
  });
});

describe('getTeammateStatuses (TM-6)', () => {
  it('returns correct statuses', async () => {
    await createTeam({
      leadSessionId: 'lead-1',
      teamName: 'test-team',
      members: [
        { name: 'a', agentId: 'a1', agentType: 'worker' },
        { name: 'b', agentId: 'b1', agentType: 'reviewer' },
      ],
    });

    const statuses = getTeammateStatuses('test-team');
    expect(statuses).toHaveLength(2);
    expect(statuses[0].name).toBe('a');
    expect(statuses[0].status).toBe('spawning');
    expect(statuses[1].name).toBe('b');
  });
});

describe('formatTeammateList', () => {
  it('formats empty list', () => {
    expect(formatTeammateList([])).toBe('No teammates.');
  });

  it('formats teammate statuses with icons', () => {
    const output = formatTeammateList([
      { name: 'alice', status: 'active', pid: 123, model: 'gpt-4o' },
      { name: 'bob', status: 'idle', pid: 456 },
      { name: 'charlie', status: 'crashed' },
    ]);

    expect(output).toContain('Teammates (3)');
    expect(output).toContain('🟢 alice');
    expect(output).toContain('[gpt-4o]');
    expect(output).toContain('PID: 123');
    expect(output).toContain('💤 bob');
    expect(output).toContain('💥 charlie');
  });
});

describe('process lifecycle', () => {
  it('updates status to stopped on clean exit', async () => {
    // Spawn a process that exits immediately
    setSpawnCommandBuilder((_teamName, options) => ({
      command: process.execPath,
      args: ['-e', 'process.exit(0);'],
      env: {
        COPILOT_TEAMS_TEAMMATE: '1',
        COPILOT_TEAMS_TEAM_NAME: _teamName,
        COPILOT_TEAMS_TEAMMATE_NAME: options.name,
      },
    }));

    await createTeam({ leadSessionId: 'lead-1', teamName: 'test-team' });
    const proc = await spawnTeammate('test-team', 'lead-1', {
      name: 'exiter',
      spawnPrompt: 'test',
    });

    // Wait for exit
    await new Promise<void>((resolve) => {
      proc.process.on('exit', () => setTimeout(resolve, 100));
    });

    const statuses = getTeammateStatuses('test-team');
    const exiter = statuses.find((s) => s.name === 'exiter');
    expect(exiter!.status).toBe('stopped');

    // Unregistered from process map
    expect(getProcess('test-team', 'exiter')).toBeUndefined();
  });

  it('updates status to crashed on non-zero exit', async () => {
    setSpawnCommandBuilder((_teamName, options) => ({
      command: process.execPath,
      args: ['-e', 'process.exit(1);'],
      env: {
        COPILOT_TEAMS_TEAMMATE: '1',
        COPILOT_TEAMS_TEAM_NAME: _teamName,
        COPILOT_TEAMS_TEAMMATE_NAME: options.name,
      },
    }));

    await createTeam({ leadSessionId: 'lead-1', teamName: 'test-team' });
    const proc = await spawnTeammate('test-team', 'lead-1', {
      name: 'crasher',
      spawnPrompt: 'test',
    });

    await new Promise<void>((resolve) => {
      proc.process.on('exit', () => setTimeout(resolve, 100));
    });

    const statuses = getTeammateStatuses('test-team');
    const crasher = statuses.find((s) => s.name === 'crasher');
    expect(crasher!.status).toBe('crashed');
  });
});

// ── R8: Teammate Shutdown ──

describe('requestShutdown', () => {
  it('graceful shutdown when teammate is idle (TM-20)', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'test-team' });
    const proc = await spawnTeammate('test-team', 'lead-1', {
      name: 'idle-worker',
      spawnPrompt: 'test',
    });

    // Register handler that approves
    registerShutdownHandler('test-team', 'idle-worker', () => ({
      decision: 'approve',
    }));

    const result = await requestShutdown('test-team', 'lead-1', 'idle-worker', 3000);

    expect(result.success).toBe(true);
    expect(result.method).toBe('graceful');
    expect(result.teammateName).toBe('idle-worker');

    // Verify config updated
    const statuses = getTeammateStatuses('test-team');
    const worker = statuses.find((s) => s.name === 'idle-worker');
    expect(worker!.status).toBe('stopped');
  });

  it('teammate finishes in-progress work before shutting down (TM-21)', async () => {
    // Spawn a process that takes a moment to exit
    setSpawnCommandBuilder((_teamName, options) => ({
      command: process.execPath,
      args: [
        '-e',
        `
        process.stdin.resume();
        process.on('SIGTERM', () => {
          // Simulate finishing work
          setTimeout(() => process.exit(0), 100);
        });
        `,
      ],
      env: {
        COPILOT_TEAMS_TEAMMATE: '1',
        COPILOT_TEAMS_TEAM_NAME: _teamName,
        COPILOT_TEAMS_TEAMMATE_NAME: options.name,
      },
    }));

    await createTeam({ leadSessionId: 'lead-1', teamName: 'test-team' });
    await spawnTeammate('test-team', 'lead-1', {
      name: 'busy-worker',
      spawnPrompt: 'test',
    });

    // Give process time to start
    await new Promise((r) => setTimeout(r, 100));

    registerShutdownHandler('test-team', 'busy-worker', () => ({
      decision: 'approve',
    }));

    const result = await requestShutdown('test-team', 'lead-1', 'busy-worker', 5000);

    expect(result.success).toBe(true);
    expect(result.method).toBe('graceful');
  });

  it('teammate can reject shutdown with explanation (TM-20)', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'test-team' });
    await spawnTeammate('test-team', 'lead-1', {
      name: 'rejector',
      spawnPrompt: 'test',
    });

    registerShutdownHandler('test-team', 'rejector', () => ({
      decision: 'reject',
      reason: 'Currently in the middle of a critical code review.',
    }));

    const result = await requestShutdown('test-team', 'lead-1', 'rejector', 3000);

    expect(result.success).toBe(false);
    expect(result.method).toBe('rejected');
    expect(result.reason).toContain('critical code review');

    // Process should still be running — clean up
    const proc = getProcess('test-team', 'rejector');
    if (proc) proc.process.kill('SIGTERM');
  });

  it('team config is updated after shutdown', async () => {
    await createTeam({ leadSessionId: 'lead-1', teamName: 'test-team' });
    await spawnTeammate('test-team', 'lead-1', {
      name: 'config-check',
      spawnPrompt: 'test',
    });

    registerShutdownHandler('test-team', 'config-check', () => ({
      decision: 'approve',
    }));

    await requestShutdown('test-team', 'lead-1', 'config-check', 3000);

    const statuses = getTeammateStatuses('test-team');
    const worker = statuses.find((s) => s.name === 'config-check');
    expect(worker!.status).toBe('stopped');

    // Process should be unregistered
    expect(getProcess('test-team', 'config-check')).toBeUndefined();
  });
});

describe('forceShutdown', () => {
  it('terminates unresponsive teammate', async () => {
    // Spawn a process that ignores SIGTERM
    setSpawnCommandBuilder((_teamName, options) => ({
      command: process.execPath,
      args: [
        '-e',
        `
        process.stdin.resume();
        process.on('SIGTERM', () => { /* ignore */ });
        `,
      ],
      env: {
        COPILOT_TEAMS_TEAMMATE: '1',
        COPILOT_TEAMS_TEAM_NAME: _teamName,
        COPILOT_TEAMS_TEAMMATE_NAME: options.name,
      },
    }));

    await createTeam({ leadSessionId: 'lead-1', teamName: 'test-team' });
    const proc = await spawnTeammate('test-team', 'lead-1', {
      name: 'stubborn',
      spawnPrompt: 'test',
    });

    await new Promise((r) => setTimeout(r, 100));

    const result = await forceShutdown('test-team', 'lead-1', 'stubborn');

    expect(result.success).toBe(true);
    expect(result.method).toBe('forced');

    // Wait for process to actually die
    await new Promise<void>((resolve) => {
      proc.process.on('exit', () => resolve());
      setTimeout(() => resolve(), 500);
    });

    const statuses = getTeammateStatuses('test-team');
    const stubborn = statuses.find((s) => s.name === 'stubborn');
    expect(stubborn!.status).toBe('stopped');
  });
});
