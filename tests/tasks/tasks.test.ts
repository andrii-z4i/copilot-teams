import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createTask,
  updateTask,
  deleteTask,
  readTaskList,
  isValidTransition,
  getBlockedTasks,
  getUnblockedTasks,
  isTaskBlocked,
  resolveCompletedDependencies,
} from '../../src/tasks/index.js';
import * as constants from '../../src/constants.js';
import type { Task } from '../../src/types.js';

let originalTeamsBaseDir: string;
let tmpBase: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-teams-tasks-test-'));
  originalTeamsBaseDir = constants.TEAMS_BASE_DIR;
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: tmpBase,
    writable: true,
    configurable: true,
  });
  fs.mkdirSync(path.join(tmpBase, 'test-team'), { recursive: true });
});

afterEach(() => {
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: originalTeamsBaseDir,
    writable: true,
    configurable: true,
  });
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('createTask', () => {
  it('creates task with correct defaults (status: pending)', async () => {
    const task = await createTask('test-team', {
      id: 'TASK-001',
      title: 'Implement auth',
      description: 'Build the auth module',
      dependencies: [],
    });

    expect(task.id).toBe('TASK-001');
    expect(task.status).toBe('pending');
    expect(task.createdAt).toBeTruthy();
    expect(task.updatedAt).toBeTruthy();
    expect(task.assignee).toBeUndefined();
    expect(task.complexity).toBeUndefined();
  });

  it('persists task to backlog file', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'Test task',
      description: 'A test',
      dependencies: [],
    });

    const backlogPath = path.join(tmpBase, 'test-team', 'backlog.md');
    expect(fs.existsSync(backlogPath)).toBe(true);

    const content = fs.readFileSync(backlogPath, 'utf-8');
    expect(content).toContain('TASK-001');
    expect(content).toContain('Test task');
  });

  it('rejects duplicate task IDs', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'First',
      description: 'first',
      dependencies: [],
    });

    await expect(
      createTask('test-team', {
        id: 'TASK-001',
        title: 'Duplicate',
        description: 'dup',
        dependencies: [],
      }),
    ).rejects.toThrow('already exists');
  });

  it('creates multiple tasks', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'First',
      description: 'first',
      dependencies: [],
    });
    await createTask('test-team', {
      id: 'TASK-002',
      title: 'Second',
      description: 'second',
      dependencies: ['TASK-001'],
    });

    const tasks = readTaskList('test-team');
    expect(tasks).toHaveLength(2);
    expect(tasks[1].dependencies).toEqual(['TASK-001']);
  });
});

describe('readTaskList (TS-3)', () => {
  it('returns empty array for nonexistent backlog', () => {
    expect(readTaskList('no-team')).toEqual([]);
  });

  it('all members can read (returns correct data)', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'Auth module',
      description: 'Build auth',
      dependencies: [],
      complexity: 'M',
    });

    const tasks = readTaskList('test-team');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('TASK-001');
    expect(tasks[0].title).toBe('Auth module');
    expect(tasks[0].complexity).toBe('M');
    expect(tasks[0].status).toBe('pending');
  });
});

describe('updateTask (TS-4)', () => {
  it('updates task fields', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'Original',
      description: 'original desc',
      dependencies: [],
    });

    const updated = await updateTask('test-team', 'TASK-001', {
      title: 'Updated Title',
      assignee: 'worker-a',
      complexity: 'L',
    });

    expect(updated.title).toBe('Updated Title');
    expect(updated.assignee).toBe('worker-a');
    expect(updated.complexity).toBe('L');
  });

  it('throws for nonexistent task', async () => {
    await expect(
      updateTask('test-team', 'NONEXISTENT', { title: 'nope' }),
    ).rejects.toThrow('not found');
  });
});

describe('deleteTask (TS-4)', () => {
  it('removes task from backlog', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'To delete',
      description: 'bye',
      dependencies: [],
    });

    await deleteTask('test-team', 'TASK-001');
    const tasks = readTaskList('test-team');
    expect(tasks).toHaveLength(0);
  });

  it('throws for nonexistent task', async () => {
    await expect(deleteTask('test-team', 'NONEXISTENT')).rejects.toThrow('not found');
  });
});

describe('state transitions (TS-5)', () => {
  it('isValidTransition: pending → in_progress is valid', () => {
    expect(isValidTransition('pending', 'in_progress')).toBe(true);
  });

  it('isValidTransition: in_progress → completed is valid', () => {
    expect(isValidTransition('in_progress', 'completed')).toBe(true);
  });

  it('isValidTransition: completed → pending is invalid', () => {
    expect(isValidTransition('completed', 'pending')).toBe(false);
  });

  it('isValidTransition: in_progress → pending is invalid', () => {
    expect(isValidTransition('in_progress', 'pending')).toBe(false);
  });

  it('isValidTransition: pending → completed is invalid (must go through in_progress)', () => {
    expect(isValidTransition('pending', 'completed')).toBe(false);
  });

  it('updateTask transitions pending → in_progress', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T',
      description: 'd',
      dependencies: [],
    });

    const updated = await updateTask('test-team', 'TASK-001', { status: 'in_progress' });
    expect(updated.status).toBe('in_progress');
  });

  it('updateTask transitions in_progress → completed', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T',
      description: 'd',
      dependencies: [],
    });
    await updateTask('test-team', 'TASK-001', { status: 'in_progress' });
    const updated = await updateTask('test-team', 'TASK-001', { status: 'completed' });
    expect(updated.status).toBe('completed');
  });

  it('updateTask rejects invalid transition completed → pending', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T',
      description: 'd',
      dependencies: [],
    });
    await updateTask('test-team', 'TASK-001', { status: 'in_progress' });
    await updateTask('test-team', 'TASK-001', { status: 'completed' });

    await expect(
      updateTask('test-team', 'TASK-001', { status: 'pending' }),
    ).rejects.toThrow('Invalid state transition');
  });

  it('updateTask rejects invalid transition pending → completed', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T',
      description: 'd',
      dependencies: [],
    });

    await expect(
      updateTask('test-team', 'TASK-001', { status: 'completed' }),
    ).rejects.toThrow('Invalid state transition');
  });
});

describe('dependency resolution (TS-6, TS-7, TS-8)', () => {
  async function setupDependencyChain() {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'Foundation',
      description: 'base task',
      dependencies: [],
    });
    await createTask('test-team', {
      id: 'TASK-002',
      title: 'Depends on 001',
      description: 'blocked',
      dependencies: ['TASK-001'],
    });
    await createTask('test-team', {
      id: 'TASK-003',
      title: 'Depends on 001 and 002',
      description: 'double blocked',
      dependencies: ['TASK-001', 'TASK-002'],
    });
    await createTask('test-team', {
      id: 'TASK-004',
      title: 'Independent',
      description: 'no deps',
      dependencies: [],
    });
  }

  it('getBlockedTasks returns tasks with incomplete dependencies', async () => {
    await setupDependencyChain();
    const tasks = readTaskList('test-team');
    const blocked = getBlockedTasks(tasks);

    expect(blocked.map((t) => t.id).sort()).toEqual(['TASK-002', 'TASK-003']);
  });

  it('getUnblockedTasks returns pending tasks with all deps completed', async () => {
    await setupDependencyChain();
    const tasks = readTaskList('test-team');
    const unblocked = getUnblockedTasks(tasks);

    // TASK-001 and TASK-004 have no deps, so they are unblocked
    expect(unblocked.map((t) => t.id).sort()).toEqual(['TASK-001', 'TASK-004']);
  });

  it('isTaskBlocked correctly identifies blocked task', async () => {
    await setupDependencyChain();
    const tasks = readTaskList('test-team');
    const task2 = tasks.find((t) => t.id === 'TASK-002')!;
    expect(isTaskBlocked(task2, tasks)).toBe(true);
  });

  it('completing a dep unblocks dependent tasks (TS-8)', async () => {
    await setupDependencyChain();

    // Complete TASK-001
    await updateTask('test-team', 'TASK-001', { status: 'in_progress' });
    await updateTask('test-team', 'TASK-001', { status: 'completed' });

    const newlyUnblocked = await resolveCompletedDependencies('test-team', 'TASK-001');
    // TASK-002 should be unblocked (only dep was TASK-001)
    // TASK-003 should NOT be unblocked (still depends on TASK-002)
    expect(newlyUnblocked.map((t) => t.id)).toEqual(['TASK-002']);
  });

  it('completing all deps unblocks multi-dependency task', async () => {
    await setupDependencyChain();

    // Complete both deps of TASK-003
    await updateTask('test-team', 'TASK-001', { status: 'in_progress' });
    await updateTask('test-team', 'TASK-001', { status: 'completed' });
    await updateTask('test-team', 'TASK-002', { status: 'in_progress' });
    await updateTask('test-team', 'TASK-002', { status: 'completed' });

    const newlyUnblocked = await resolveCompletedDependencies('test-team', 'TASK-002');
    expect(newlyUnblocked.map((t) => t.id)).toEqual(['TASK-003']);
  });
});

describe('concurrent access (NF-4)', () => {
  it('concurrent creates are serialized via file locking', async () => {
    const promises = Array.from({ length: 5 }, (_, i) =>
      createTask('test-team', {
        id: `TASK-${String(i + 1).padStart(3, '0')}`,
        title: `Task ${i + 1}`,
        description: `desc ${i + 1}`,
        dependencies: [],
      }),
    );

    await Promise.all(promises);
    const tasks = readTaskList('test-team');
    expect(tasks).toHaveLength(5);
  });
});
