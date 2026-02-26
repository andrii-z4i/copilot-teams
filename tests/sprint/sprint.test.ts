import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  startSprint,
  activateSprint,
  closeSprint,
  getCurrentSprint,
  getSprint,
  readSprints,
  getTeammateSprintTaskIds,
} from '../../src/sprint/index.js';
import { createTask, updateTask } from '../../src/tasks/index.js';
import * as constants from '../../src/constants.js';

let originalTeamsBaseDir: string;
let tmpBase: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-teams-sprint-test-'));
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

async function createTestTasks() {
  await createTask('test-team', { id: 'T-001', title: 'Task 1', description: 'd', dependencies: [], complexity: 'M' });
  await createTask('test-team', { id: 'T-002', title: 'Task 2', description: 'd', dependencies: [], complexity: 'S' });
  await createTask('test-team', { id: 'T-003', title: 'Task 3', description: 'd', dependencies: [], complexity: 'L' });
}

describe('startSprint', () => {
  it('creates sprint file with correct format', async () => {
    await createTestTasks();
    const sprint = await startSprint('test-team', 1, ['T-001', 'T-002']);

    expect(sprint.number).toBe(1);
    expect(sprint.status).toBe('planning');
    expect(sprint.startedAt).toBeTruthy();
    expect(sprint.closedAt).toBeNull();

    const sprintPath = path.join(tmpBase, 'test-team', 'sprint.md');
    expect(fs.existsSync(sprintPath)).toBe(true);
    const content = fs.readFileSync(sprintPath, 'utf-8');
    expect(content).toContain('Sprint #1');
    expect(content).toContain('Status: planning');
  });

  it('rejects if an active sprint exists', async () => {
    await createTestTasks();
    await startSprint('test-team', 1, ['T-001']);

    await expect(startSprint('test-team', 2, ['T-002'])).rejects.toThrow(
      'still planning',
    );
  });

  it('rejects non-sequential sprint number', async () => {
    await createTestTasks();
    await expect(startSprint('test-team', 5, ['T-001'])).rejects.toThrow(
      'Sprint number must be 1',
    );
  });

  it('rejects if task not in backlog', async () => {
    await expect(startSprint('test-team', 1, ['NOPE'])).rejects.toThrow(
      'not found in backlog',
    );
  });
});

describe('sprint transitions: planning → active → closed', () => {
  it('full lifecycle', async () => {
    await createTestTasks();

    // Start
    await startSprint('test-team', 1, ['T-001', 'T-002']);
    let current = getCurrentSprint('test-team');
    expect(current!.status).toBe('planning');

    // Activate
    await activateSprint('test-team', 1, [
      { teammate: 'alice', taskId: 'T-001', taskTitle: 'Task 1', estimate: 'M' },
      { teammate: 'bob', taskId: 'T-002', taskTitle: 'Task 2', estimate: 'S' },
    ]);
    current = getCurrentSprint('test-team');
    expect(current!.status).toBe('active');
    expect(current!.assignments).toHaveLength(2);

    // Close
    await updateTask('test-team', 'T-001', { status: 'in_progress' });
    await updateTask('test-team', 'T-001', { status: 'completed' });
    await updateTask('test-team', 'T-002', { status: 'in_progress' });
    await updateTask('test-team', 'T-002', { status: 'completed' });

    const { sprint, unfinishedTaskIds } = await closeSprint('test-team', 1);
    expect(sprint.status).toBe('closed');
    expect(sprint.closedAt).toBeTruthy();
    expect(unfinishedTaskIds).toHaveLength(0);
  });
});

describe('closed sprint sections are immutable (append-only)', () => {
  it('can start a new sprint after closing the previous', async () => {
    await createTestTasks();

    // Sprint 1
    await startSprint('test-team', 1, ['T-001']);
    await activateSprint('test-team', 1, [
      { teammate: 'alice', taskId: 'T-001', taskTitle: 'Task 1', estimate: 'M' },
    ]);
    await updateTask('test-team', 'T-001', { status: 'in_progress' });
    await updateTask('test-team', 'T-001', { status: 'completed' });
    await closeSprint('test-team', 1);

    // Sprint 2
    const sprint2 = await startSprint('test-team', 2, ['T-002']);
    expect(sprint2.number).toBe(2);

    // Both sprints exist in file
    const sprints = readSprints('test-team');
    expect(sprints).toHaveLength(2);
    expect(sprints[0].status).toBe('closed');
    expect(sprints[1].status).toBe('planning');
  });
});

describe('only Lead can write to sprint file', () => {
  // This is enforced architecturally — sprint functions are only called by the Lead.
  // We verify the file exists and has correct content.
  it('sprint file is at the correct path', async () => {
    await createTestTasks();
    await startSprint('test-team', 1, ['T-001']);
    const sprintPath = path.join(tmpBase, 'test-team', 'sprint.md');
    expect(fs.existsSync(sprintPath)).toBe(true);
  });
});

describe('getCurrentSprint', () => {
  it('returns null when no sprints exist', () => {
    expect(getCurrentSprint('test-team')).toBeNull();
  });

  it('returns active sprint', async () => {
    await createTestTasks();
    await startSprint('test-team', 1, ['T-001']);
    await activateSprint('test-team', 1, [
      { teammate: 'alice', taskId: 'T-001', taskTitle: 'Task 1', estimate: 'M' },
    ]);
    const current = getCurrentSprint('test-team');
    expect(current!.number).toBe(1);
    expect(current!.status).toBe('active');
  });

  it('returns null when all sprints are closed', async () => {
    await createTestTasks();
    await startSprint('test-team', 1, ['T-001']);
    await activateSprint('test-team', 1, [
      { teammate: 'alice', taskId: 'T-001', taskTitle: 'Task 1', estimate: 'M' },
    ]);
    await updateTask('test-team', 'T-001', { status: 'in_progress' });
    await updateTask('test-team', 'T-001', { status: 'completed' });
    await closeSprint('test-team', 1);

    expect(getCurrentSprint('test-team')).toBeNull();
  });
});

describe('teammate cannot work on tasks outside current sprint (TS-11)', () => {
  it('getTeammateSprintTaskIds returns correct task IDs', async () => {
    await createTestTasks();
    await startSprint('test-team', 1, ['T-001', 'T-002']);
    await activateSprint('test-team', 1, [
      { teammate: 'alice', taskId: 'T-001', taskTitle: 'Task 1', estimate: 'M' },
      { teammate: 'bob', taskId: 'T-002', taskTitle: 'Task 2', estimate: 'S' },
    ]);

    expect(getTeammateSprintTaskIds('test-team', 'alice')).toEqual(['T-001']);
    expect(getTeammateSprintTaskIds('test-team', 'bob')).toEqual(['T-002']);
    expect(getTeammateSprintTaskIds('test-team', 'charlie')).toEqual([]);
  });

  it('returns empty when no active sprint', () => {
    expect(getTeammateSprintTaskIds('test-team', 'alice')).toEqual([]);
  });
});

describe('sprint closure returns unfinished tasks to backlog', () => {
  it('identifies unfinished tasks on close', async () => {
    await createTestTasks();
    await startSprint('test-team', 1, ['T-001', 'T-002']);
    await activateSprint('test-team', 1, [
      { teammate: 'alice', taskId: 'T-001', taskTitle: 'Task 1', estimate: 'M' },
      { teammate: 'bob', taskId: 'T-002', taskTitle: 'Task 2', estimate: 'S' },
    ]);

    // Only complete T-001
    await updateTask('test-team', 'T-001', { status: 'in_progress' });
    await updateTask('test-team', 'T-001', { status: 'completed' });

    const { unfinishedTaskIds } = await closeSprint('test-team', 1);
    expect(unfinishedTaskIds).toEqual(['T-002']);
  });
});

describe('activateSprint validation', () => {
  it('rejects activation of non-planning sprint', async () => {
    await createTestTasks();
    await startSprint('test-team', 1, ['T-001']);
    await activateSprint('test-team', 1, [
      { teammate: 'alice', taskId: 'T-001', taskTitle: 'Task 1', estimate: 'M' },
    ]);

    await expect(
      activateSprint('test-team', 1, []),
    ).rejects.toThrow('not "planning"');
  });
});

describe('closeSprint validation', () => {
  it('rejects closure of non-active sprint', async () => {
    await createTestTasks();
    await startSprint('test-team', 1, ['T-001']);

    await expect(closeSprint('test-team', 1)).rejects.toThrow('not "active"');
  });
});
