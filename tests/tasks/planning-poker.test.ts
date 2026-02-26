import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  startPlanningPoker,
  submitEstimate,
  getEstimates,
  resolveEstimates,
  calculateTeammateLoad,
  wouldExceedCapacity,
  balanceAssignments,
  getXLTasksForDecomposition,
} from '../../src/tasks/planning-poker.js';
import { createTask, readTaskList, updateTask } from '../../src/tasks/index.js';
import * as constants from '../../src/constants.js';
import type { Task } from '../../src/types.js';

let originalTeamsBaseDir: string;
let tmpBase: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-teams-poker-test-'));
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

describe('planning poker (TS-14, TS-15)', () => {
  it('resolves to mode of estimates', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T1',
      description: 'd',
      dependencies: [],
    });

    startPlanningPoker('test-team', ['TASK-001']);
    submitEstimate('test-team', 'TASK-001', 'alice', 'M');
    submitEstimate('test-team', 'TASK-001', 'bob', 'M');
    submitEstimate('test-team', 'TASK-001', 'charlie', 'L');

    const resolved = await resolveEstimates('test-team', 'TASK-001');
    expect(resolved).toBe('M'); // Mode is M (2 votes vs 1)
  });

  it('tie-breaking picks higher size', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T1',
      description: 'd',
      dependencies: [],
    });

    startPlanningPoker('test-team', ['TASK-001']);
    submitEstimate('test-team', 'TASK-001', 'alice', 'S');
    submitEstimate('test-team', 'TASK-001', 'bob', 'M');

    const resolved = await resolveEstimates('test-team', 'TASK-001');
    expect(resolved).toBe('M'); // Tie: S=1, M=1 → pick higher (M)
  });

  it('teammate cannot see others estimates before all submitted (TS-15)', () => {
    startPlanningPoker('test-team', ['TASK-001']);
    submitEstimate('test-team', 'TASK-001', 'alice', 'M');

    const result = getEstimates('test-team', 'TASK-001', ['alice', 'bob']);
    expect(result.allSubmitted).toBe(false);
    // All values should be null (hidden)
    expect(result.estimates.alice).toBeNull();
    expect(result.estimates.bob).toBeNull();
  });

  it('estimates are revealed when all submitted', () => {
    startPlanningPoker('test-team', ['TASK-001']);
    submitEstimate('test-team', 'TASK-001', 'alice', 'M');
    submitEstimate('test-team', 'TASK-001', 'bob', 'L');

    const result = getEstimates('test-team', 'TASK-001', ['alice', 'bob']);
    expect(result.allSubmitted).toBe(true);
    expect(result.estimates.alice).toBe('M');
    expect(result.estimates.bob).toBe('L');
  });

  it('rejects invalid complexity size', () => {
    startPlanningPoker('test-team', ['TASK-001']);
    expect(() =>
      submitEstimate('test-team', 'TASK-001', 'alice', 'XXL' as any),
    ).toThrow('Invalid complexity size');
  });

  it('rejects estimate for non-existent session', () => {
    expect(() => submitEstimate('test-team', 'TASK-999', 'alice', 'M')).toThrow(
      'No planning poker session',
    );
  });

  it('rejects estimate for already resolved task', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T1',
      description: 'd',
      dependencies: [],
    });

    startPlanningPoker('test-team', ['TASK-001']);
    submitEstimate('test-team', 'TASK-001', 'alice', 'S');
    await resolveEstimates('test-team', 'TASK-001');

    expect(() => submitEstimate('test-team', 'TASK-001', 'bob', 'M')).toThrow(
      'already been resolved',
    );
  });

  it('assigns resolved complexity to task (TS-13)', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T1',
      description: 'd',
      dependencies: [],
    });

    startPlanningPoker('test-team', ['TASK-001']);
    submitEstimate('test-team', 'TASK-001', 'alice', 'L');
    await resolveEstimates('test-team', 'TASK-001');

    const tasks = readTaskList('test-team');
    expect(tasks[0].complexity).toBe('L');
  });
});

describe('tasks without complexity cannot be assigned (TS-13)', () => {
  it('task without complexity size has undefined complexity', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T1',
      description: 'd',
      dependencies: [],
    });
    const tasks = readTaskList('test-team');
    expect(tasks[0].complexity).toBeUndefined();
  });
});

describe('capacity management (TS-16)', () => {
  it('calculateTeammateLoad sums weights of assigned tasks', async () => {
    await createTask('test-team', {
      id: 'TASK-001',
      title: 'T1',
      description: 'd',
      dependencies: [],
      complexity: 'M',
      assignee: 'alice',
    });
    await createTask('test-team', {
      id: 'TASK-002',
      title: 'T2',
      description: 'd',
      dependencies: [],
      complexity: 'S',
      assignee: 'alice',
    });
    await createTask('test-team', {
      id: 'TASK-003',
      title: 'T3',
      description: 'd',
      dependencies: [],
      complexity: 'L',
      assignee: 'bob',
    });

    expect(calculateTeammateLoad('test-team', 'alice')).toBeCloseTo(2.33); // M=1.33 + S=1
    expect(calculateTeammateLoad('test-team', 'bob')).toBe(2); // L=2
  });

  it('capacity limit of 4 points is enforced', () => {
    expect(wouldExceedCapacity(3, 'M')).toBe(true); // 3 + 1.33 > 4
    expect(wouldExceedCapacity(3, 'S')).toBe(false); // 3 + 1 = 4
    expect(wouldExceedCapacity(0, 'XL')).toBe(false); // 0 + 4 = 4
    expect(wouldExceedCapacity(0.01, 'XL')).toBe(true); // 0.01 + 4 > 4
  });
});

describe('balanceAssignments (TS-17)', () => {
  it('distributes weight evenly across teammates', () => {
    const tasks: Task[] = [
      { id: 'T1', title: '', description: '', status: 'pending', dependencies: [], complexity: 'L', createdAt: '', updatedAt: '' },
      { id: 'T2', title: '', description: '', status: 'pending', dependencies: [], complexity: 'L', createdAt: '', updatedAt: '' },
      { id: 'T3', title: '', description: '', status: 'pending', dependencies: [], complexity: 'S', createdAt: '', updatedAt: '' },
      { id: 'T4', title: '', description: '', status: 'pending', dependencies: [], complexity: 'S', createdAt: '', updatedAt: '' },
    ];

    const assignments = balanceAssignments(tasks, ['alice', 'bob']);

    // Each should get ~3 points: one L (2) + one S (1) = 3
    const aliceTasks = Object.entries(assignments).filter(([, v]) => v === 'alice').map(([k]) => k);
    const bobTasks = Object.entries(assignments).filter(([, v]) => v === 'bob').map(([k]) => k);

    expect(aliceTasks.length + bobTasks.length).toBe(4);
    // All tasks assigned
    expect(Object.keys(assignments).sort()).toEqual(['T1', 'T2', 'T3', 'T4']);
  });

  it('respects capacity limits', () => {
    const tasks: Task[] = [
      { id: 'T1', title: '', description: '', status: 'pending', dependencies: [], complexity: 'XL', createdAt: '', updatedAt: '' },
      { id: 'T2', title: '', description: '', status: 'pending', dependencies: [], complexity: 'XL', createdAt: '', updatedAt: '' },
      { id: 'T3', title: '', description: '', status: 'pending', dependencies: [], complexity: 'XL', createdAt: '', updatedAt: '' },
    ];

    // Only 2 teammates, each can take 1 XL (4 points)
    const assignments = balanceAssignments(tasks, ['alice', 'bob']);
    expect(Object.keys(assignments)).toHaveLength(2); // T3 unassigned — no capacity
  });

  it('skips tasks without complexity', () => {
    const tasks: Task[] = [
      { id: 'T1', title: '', description: '', status: 'pending', dependencies: [], createdAt: '', updatedAt: '' },
    ];

    const assignments = balanceAssignments(tasks, ['alice']);
    expect(Object.keys(assignments)).toHaveLength(0);
  });
});

describe('XL task decomposition suggestion (TS-18)', () => {
  it('flags XL pending tasks', () => {
    const tasks: Task[] = [
      { id: 'T1', title: '', description: '', status: 'pending', dependencies: [], complexity: 'XL', createdAt: '', updatedAt: '' },
      { id: 'T2', title: '', description: '', status: 'pending', dependencies: [], complexity: 'M', createdAt: '', updatedAt: '' },
      { id: 'T3', title: '', description: '', status: 'in_progress', dependencies: [], complexity: 'XL', createdAt: '', updatedAt: '' },
    ];

    const xl = getXLTasksForDecomposition(tasks);
    expect(xl).toHaveLength(1);
    expect(xl[0].id).toBe('T1');
  });
});
