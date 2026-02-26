import { describe, it, expect } from 'vitest';
import {
  TEAMS_BASE_DIR,
  COMPLEXITY_WEIGHTS,
  CAPACITY_PER_ITERATION,
  TEAMMATE_MODES,
} from '../../src/constants.js';
import type { CopilotTeamsConfig, Task, TeamConfig } from '../../src/types.js';

describe('types and constants', () => {
  it('TEAMS_BASE_DIR ends with .copilot/teams', () => {
    expect(TEAMS_BASE_DIR).toMatch(/\.copilot[\\/]teams$/);
  });

  it('COMPLEXITY_WEIGHTS has correct values', () => {
    expect(COMPLEXITY_WEIGHTS.S).toBe(1);
    expect(COMPLEXITY_WEIGHTS.M).toBe(1.33);
    expect(COMPLEXITY_WEIGHTS.L).toBe(2);
    expect(COMPLEXITY_WEIGHTS.XL).toBe(4);
  });

  it('CAPACITY_PER_ITERATION is 4', () => {
    expect(CAPACITY_PER_ITERATION).toBe(4);
  });

  it('TEAMMATE_MODES includes all expected modes', () => {
    expect(TEAMMATE_MODES).toEqual(['auto', 'in-process', 'tmux']);
  });

  it('CopilotTeamsConfig type can be instantiated', () => {
    const config: CopilotTeamsConfig = { enabled: false, teammateMode: 'auto' };
    expect(config.enabled).toBe(false);
    expect(config.teammateMode).toBe('auto');
  });

  it('Task type can be instantiated with all fields', () => {
    const task: Task = {
      id: 'TASK-001',
      title: 'Test task',
      description: 'A test task',
      status: 'pending',
      dependencies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(task.status).toBe('pending');
    expect(task.dependencies).toEqual([]);
  });

  it('TeamConfig type can be instantiated', () => {
    const config: TeamConfig = {
      teamName: 'test-team-abc1',
      leadSessionId: 'session-123',
      createdAt: new Date().toISOString(),
      members: [],
    };
    expect(config.teamName).toBe('test-team-abc1');
    expect(config.members).toEqual([]);
  });
});
