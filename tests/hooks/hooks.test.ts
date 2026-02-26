import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadHooks,
  saveHooks,
  getHooksForEvent,
  runHook,
  onTeammateIdle,
  onTaskCompleted,
  setCommandRunner,
} from '../../src/hooks/index.js';
import * as constants from '../../src/constants.js';
import { createTempDir, cleanupTempDir } from '../helpers.js';
import { createTeam } from '../../src/team/index.js';
import type { HookConfig } from '../../src/types.js';

let tmpBase: string;
const teamName = 'hooks-test';

beforeEach(async () => {
  tmpBase = createTempDir();
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: tmpBase,
    writable: true,
    configurable: true,
  });
  await createTeam(teamName, 'lead-session-1');
});

afterEach(() => {
  setCommandRunner(null);
  cleanupTempDir(tmpBase);
});

describe('hook configuration (QG-4)', () => {
  it('loads hooks from project config', async () => {
    const hooks: HookConfig[] = [
      { event: 'TeammateIdle', command: 'echo idle' },
      { event: 'TaskCompleted', command: 'npm test' },
    ];
    await saveHooks(teamName, hooks);

    const loaded = await loadHooks(teamName);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].event).toBe('TeammateIdle');
    expect(loaded[1].command).toBe('npm test');
  });

  it('returns empty array when no hooks configured', async () => {
    const loaded = await loadHooks(teamName);
    expect(loaded).toEqual([]);
  });

  it('getHooksForEvent filters by event type', async () => {
    await saveHooks(teamName, [
      { event: 'TeammateIdle', command: 'echo idle' },
      { event: 'TaskCompleted', command: 'npm test' },
      { event: 'TeammateIdle', command: 'echo idle2' },
    ]);

    const idle = await getHooksForEvent(teamName, 'TeammateIdle');
    expect(idle).toHaveLength(2);

    const completed = await getHooksForEvent(teamName, 'TaskCompleted');
    expect(completed).toHaveLength(1);
  });
});

describe('TeammateIdle hook (QG-2)', () => {
  it('exit code 2 sends feedback and prevents idle', async () => {
    await saveHooks(teamName, [
      { event: 'TeammateIdle', command: 'check-idle' },
    ]);
    setCommandRunner((cmd, env) => {
      expect(env.HOOK_EVENT).toBe('TeammateIdle');
      expect(env.HOOK_TEAMMATENAME).toBe('tm-1');
      return { exitCode: 2, stdout: 'Please review PR #42 first\n', stderr: '' };
    });

    const result = await onTeammateIdle(teamName, 'tm-1');
    expect(result.allowIdle).toBe(false);
    expect(result.feedback).toBe('Please review PR #42 first');
  });

  it('exit code 0 allows idle', async () => {
    await saveHooks(teamName, [
      { event: 'TeammateIdle', command: 'check-idle' },
    ]);
    setCommandRunner(() => ({ exitCode: 0, stdout: '', stderr: '' }));

    const result = await onTeammateIdle(teamName, 'tm-1');
    expect(result.allowIdle).toBe(true);
    expect(result.feedback).toBeNull();
  });

  it('allows idle when no hooks configured', async () => {
    const result = await onTeammateIdle(teamName, 'tm-1');
    expect(result.allowIdle).toBe(true);
  });
});

describe('TaskCompleted hook (QG-3)', () => {
  it('exit code 2 prevents completion and sends feedback', async () => {
    await saveHooks(teamName, [
      { event: 'TaskCompleted', command: 'run-tests' },
    ]);
    setCommandRunner((cmd, env) => {
      expect(env.HOOK_EVENT).toBe('TaskCompleted');
      expect(env.HOOK_TASKID).toBe('TASK-1');
      expect(env.HOOK_TASKTITLE).toBe('Add auth');
      return { exitCode: 2, stdout: 'Tests failed: 3 errors\n', stderr: '' };
    });

    const result = await onTaskCompleted(teamName, 'TASK-1', 'Add auth', 'tm-1');
    expect(result.allowCompletion).toBe(false);
    expect(result.feedback).toBe('Tests failed: 3 errors');
  });

  it('exit code 0 allows completion', async () => {
    await saveHooks(teamName, [
      { event: 'TaskCompleted', command: 'run-tests' },
    ]);
    setCommandRunner(() => ({ exitCode: 0, stdout: 'All tests passed\n', stderr: '' }));

    const result = await onTaskCompleted(teamName, 'TASK-1', 'Add auth');
    expect(result.allowCompletion).toBe(true);
    expect(result.feedback).toBeNull();
  });

  it('allows completion when no hooks configured', async () => {
    const result = await onTaskCompleted(teamName, 'TASK-1', 'Add auth');
    expect(result.allowCompletion).toBe(true);
  });
});

describe('runHook context', () => {
  it('passes context as HOOK_ env vars', () => {
    let capturedEnv: Record<string, string> = {};
    setCommandRunner((_cmd, env) => {
      capturedEnv = env;
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const hook: HookConfig = { event: 'TaskCompleted', command: 'test-cmd' };
    runHook(hook, {
      teamName: 'my-team',
      teammateName: 'tm-1',
      taskId: 'TASK-5',
      taskTitle: 'Fix bug',
    });

    expect(capturedEnv.HOOK_EVENT).toBe('TaskCompleted');
    expect(capturedEnv.HOOK_TEAMNAME).toBe('my-team');
    expect(capturedEnv.HOOK_TEAMMATENAME).toBe('tm-1');
    expect(capturedEnv.HOOK_TASKID).toBe('TASK-5');
    expect(capturedEnv.HOOK_TASKTITLE).toBe('Fix bug');
  });

  it('passes workingDir to command runner', () => {
    let capturedCwd: string | undefined;
    setCommandRunner((_cmd, _env, cwd) => {
      capturedCwd = cwd;
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const hook: HookConfig = {
      event: 'TeammateIdle',
      command: 'check',
      workingDir: '/tmp/project',
    };
    runHook(hook, { teamName: 'test' });

    expect(capturedCwd).toBe('/tmp/project');
  });
});
