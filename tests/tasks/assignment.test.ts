import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  assignTask,
  claimNextTask,
  autoPickupNextTask,
  getTeammateSprintTasks,
} from '../../src/tasks/assignment.js';
import { createTask, updateTask, readTaskList } from '../../src/tasks/index.js';
import * as constants from '../../src/constants.js';
import { resetMessageCounter } from '../../src/comms/index.js';

let originalTeamsBaseDir: string;
let tmpBase: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-teams-assign-test-'));
  originalTeamsBaseDir = constants.TEAMS_BASE_DIR;
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: tmpBase,
    writable: true,
    configurable: true,
  });
  fs.mkdirSync(path.join(tmpBase, 'test-team'), { recursive: true });
  resetMessageCounter('test-team');
});

afterEach(() => {
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: originalTeamsBaseDir,
    writable: true,
    configurable: true,
  });
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('assignTask (TS-9)', () => {
  it('lead can assign a pending, unblocked task to a teammate', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'Auth module',
      description: 'Build it',
      dependencies: [],
    });

    const assigned = await assignTask('test-team', 'TASK-001', 'worker-a');
    expect(assigned.assignee).toBe('worker-a');
    expect(assigned.status).toBe('in_progress');
  });

  it('assignment fails for blocked tasks', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'Base',
      description: 'd',
      dependencies: [],
    });
    await createTask('test-team', {
      id: 'TASK-002',
      title: 'Depends on 001',
      description: 'd',
      dependencies: ['TASK-001'],
    });

    await expect(assignTask('test-team', 'TASK-002', 'worker-a')).rejects.toThrow(
      'blocked by incomplete dependencies',
    );
  });

  it('assignment fails for non-pending task', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T',
      description: 'd',
      dependencies: [],
    });
    await updateTask('test-team', 'TASK-001', { status: 'in_progress' });

    await expect(assignTask('test-team', 'TASK-001', 'worker-a')).rejects.toThrow(
      'not pending',
    );
  });

  it('assignment fails for nonexistent task', async () => {
    await expect(assignTask('test-team', 'NOPE', 'worker-a')).rejects.toThrow('not found');
  });
});

describe('claimNextTask (TS-10, TS-12)', () => {
  it('teammate claim request goes through lead coordination', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T1',
      description: 'd',
      dependencies: [],
      assignee: 'worker-a',
    });

    const claimed = await claimNextTask('test-team', 'worker-a');
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe('TASK-001');
    expect(claimed!.status).toBe('in_progress');
  });

  it('returns null when no tasks available', async () => {
    const result = await claimNextTask('test-team', 'worker-a');
    expect(result).toBeNull();
  });

  it('does not claim tasks assigned to other teammates', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T1',
      description: 'd',
      dependencies: [],
      assignee: 'worker-b',
    });

    const result = await claimNextTask('test-team', 'worker-a');
    expect(result).toBeNull();
  });

  it('two simultaneous claims do not result in double-assignment', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T1',
      description: 'd',
      dependencies: [],
      assignee: 'worker-a',
    });

    // Both workers try to claim simultaneously
    const [r1, r2] = await Promise.all([
      claimNextTask('test-team', 'worker-a'),
      claimNextTask('test-team', 'worker-a'),
    ]);

    // Exactly one should succeed, one should get null (already in_progress)
    const claimed = [r1, r2].filter((r) => r !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).toBe('TASK-001');
  });

  it('teammate does NOT claim unassigned tasks outside sprint (TS-11)', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'Unassigned',
      description: 'd',
      dependencies: [],
      // No assignee
    });

    const result = await claimNextTask('test-team', 'worker-a', ['TASK-001']);
    expect(result).toBeNull();
  });

  it('restricts claims to sprint scope when sprintTaskIds provided', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'In sprint',
      description: 'd',
      dependencies: [],
      assignee: 'worker-a',
    });
    await createTask('test-team', {
      id: 'TASK-002',
      title: 'Not in sprint',
      description: 'd',
      dependencies: [],
      assignee: 'worker-a',
    });

    // Only TASK-001 is in sprint scope
    const result = await claimNextTask('test-team', 'worker-a', ['TASK-001']);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('TASK-001');
  });
});

describe('autoPickupNextTask (TS-11)', () => {
  it('auto-pickup triggers for next assigned sprint task', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T1',
      description: 'd',
      dependencies: [],
      assignee: 'worker-a',
    });
    await createTask('test-team', {
      id: 'TASK-002',
      title: 'T2',
      description: 'd',
      dependencies: [],
      assignee: 'worker-a',
    });

    // Complete TASK-001 first
    await updateTask('test-team', 'TASK-001', { status: 'in_progress' });
    await updateTask('test-team', 'TASK-001', { status: 'completed' });

    const result = await autoPickupNextTask('test-team', 'worker-a', [
      'TASK-001',
      'TASK-002',
    ]);

    expect(result.idle).toBe(false);
    expect(result.nextTask).not.toBeNull();
    expect(result.nextTask!.id).toBe('TASK-002');
    expect(result.nextTask!.status).toBe('in_progress');
  });

  it('teammate goes idle when no more assigned sprint tasks remain', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T1',
      description: 'd',
      dependencies: [],
      assignee: 'worker-a',
    });

    // Complete the only task
    await updateTask('test-team', 'TASK-001', { status: 'in_progress' });
    await updateTask('test-team', 'TASK-001', { status: 'completed' });

    const result = await autoPickupNextTask('test-team', 'worker-a', ['TASK-001']);

    expect(result.idle).toBe(true);
    expect(result.nextTask).toBeNull();
  });
});

describe('getTeammateSprintTasks', () => {
  it('returns tasks assigned to teammate in sprint', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T1',
      description: 'd',
      dependencies: [],
      assignee: 'worker-a',
    });
    await createTask('test-team', {
      id: 'TASK-002',
      title: 'T2',
      description: 'd',
      dependencies: [],
      assignee: 'worker-b',
    });
    await createTask('test-team', {
      id: 'TASK-003',
      title: 'T3',
      description: 'd',
      dependencies: [],
      assignee: 'worker-a',
    });

    const tasks = getTeammateSprintTasks('test-team', 'worker-a', [
      'TASK-001',
      'TASK-002',
      'TASK-003',
    ]);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.id).sort()).toEqual(['TASK-001', 'TASK-003']);
  });
});
