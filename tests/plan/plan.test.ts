import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  enterPlanMode,
  getTeammateMode,
  isInPlanMode,
  submitPlanForApproval,
  reviewPlan,
  getPlanHistory,
  getPendingPlans,
  getRejectionCount,
  setApprovalCriteria,
  getApprovalCriteria,
} from '../../src/plan/index.js';
import * as constants from '../../src/constants.js';
import { createTempDir, cleanupTempDir } from '../helpers.js';
import { createTeam } from '../../src/team/index.js';

let tmpBase: string;
const teamName = 'plan-test';

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
  cleanupTempDir(tmpBase);
});

describe('plan mode (PA-1)', () => {
  it('teammate enters plan mode', async () => {
    const state = await enterPlanMode(teamName, 'tm-1', 'TASK-1');
    expect(state.mode).toBe('plan');
    expect(state.currentTaskId).toBe('TASK-1');
  });

  it('isInPlanMode returns true when in plan mode', async () => {
    await enterPlanMode(teamName, 'tm-1', 'TASK-1');
    expect(await isInPlanMode(teamName, 'tm-1')).toBe(true);
  });

  it('isInPlanMode returns false when not in plan mode', async () => {
    expect(await isInPlanMode(teamName, 'tm-1')).toBe(false);
  });

  it('teammate in plan mode cannot write files (enforced by caller)', async () => {
    await enterPlanMode(teamName, 'tm-1', 'TASK-1');
    // The module exposes the check; callers must enforce the constraint
    const inPlan = await isInPlanMode(teamName, 'tm-1');
    expect(inPlan).toBe(true);
  });
});

describe('submitPlanForApproval (PA-2)', () => {
  it('creates a pending plan request', async () => {
    await enterPlanMode(teamName, 'tm-1', 'TASK-1');
    const req = await submitPlanForApproval(
      teamName,
      'tm-1',
      'TASK-1',
      '# Plan\n\nDo things.'
    );
    expect(req.status).toBe('pending');
    expect(req.revision).toBe(1);
    expect(req.teammateName).toBe('tm-1');
    expect(req.taskId).toBe('TASK-1');
    expect(req.plan).toContain('Do things');
  });

  it('plan approval request is mediated by the Lead', async () => {
    await enterPlanMode(teamName, 'tm-1', 'TASK-1');
    await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan v1');

    const pending = await getPendingPlans(teamName);
    expect(pending).toHaveLength(1);
    expect(pending[0].teammateName).toBe('tm-1');
  });
});

describe('reviewPlan (PA-3, PA-4, PA-5)', () => {
  it('approved plan transitions teammate to implement mode', async () => {
    await enterPlanMode(teamName, 'tm-1', 'TASK-1');
    const req = await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan');
    await reviewPlan(teamName, req.id, 'approved');

    const state = await getTeammateMode(teamName, 'tm-1');
    expect(state?.mode).toBe('implement');
  });

  it('rejected plan keeps teammate in plan mode with feedback', async () => {
    await enterPlanMode(teamName, 'tm-1', 'TASK-1');
    const req = await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan');
    const reviewed = await reviewPlan(
      teamName,
      req.id,
      'rejected',
      'Need more detail on error handling'
    );

    expect(reviewed.status).toBe('rejected');
    expect(reviewed.feedback).toBe('Need more detail on error handling');

    const state = await getTeammateMode(teamName, 'tm-1');
    expect(state?.mode).toBe('plan'); // stays in plan mode
  });

  it('cannot review an already-reviewed plan', async () => {
    await enterPlanMode(teamName, 'tm-1', 'TASK-1');
    const req = await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan');
    await reviewPlan(teamName, req.id, 'approved');

    await expect(
      reviewPlan(teamName, req.id, 'rejected')
    ).rejects.toThrow('already reviewed');
  });
});

describe('revision limits', () => {
  it('allows up to 3 revisions', async () => {
    await enterPlanMode(teamName, 'tm-1', 'TASK-1');

    const r1 = await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan v1');
    await reviewPlan(teamName, r1.id, 'rejected', 'try again');

    const r2 = await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan v2');
    await reviewPlan(teamName, r2.id, 'rejected', 'still not good');

    const r3 = await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan v3');
    expect(r3.revision).toBe(3);
  });

  it('after 3 rejections teammate goes idle', async () => {
    await enterPlanMode(teamName, 'tm-1', 'TASK-1');

    const r1 = await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan v1');
    await reviewPlan(teamName, r1.id, 'rejected', 'nope');

    const r2 = await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan v2');
    await reviewPlan(teamName, r2.id, 'rejected', 'nope');

    const r3 = await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan v3');
    await reviewPlan(teamName, r3.id, 'rejected', 'nope');

    const state = await getTeammateMode(teamName, 'tm-1');
    expect(state?.mode).toBe('idle');
    expect(state?.currentTaskId).toBeUndefined();
  });

  it('after 3 rejections, task returns to backlog (no more submissions)', async () => {
    await enterPlanMode(teamName, 'tm-1', 'TASK-1');

    for (let i = 1; i <= 3; i++) {
      const r = await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', `plan v${i}`);
      await reviewPlan(teamName, r.id, 'rejected', 'nope');
    }

    await expect(
      submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan v4')
    ).rejects.toThrow('Maximum revisions');
  });

  it('getRejectionCount tracks rejections', async () => {
    await enterPlanMode(teamName, 'tm-1', 'TASK-1');

    const r1 = await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan v1');
    await reviewPlan(teamName, r1.id, 'rejected', 'no');

    expect(await getRejectionCount(teamName, 'tm-1', 'TASK-1')).toBe(1);
  });
});

describe('plan history', () => {
  it('getPlanHistory returns all plans for a teammate+task', async () => {
    await enterPlanMode(teamName, 'tm-1', 'TASK-1');
    const r1 = await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan v1');
    await reviewPlan(teamName, r1.id, 'rejected', 'revise');
    await submitPlanForApproval(teamName, 'tm-1', 'TASK-1', 'plan v2');

    const history = await getPlanHistory(teamName, 'tm-1', 'TASK-1');
    expect(history).toHaveLength(2);
    expect(history[0].revision).toBe(1);
    expect(history[1].revision).toBe(2);
  });
});

describe('approval criteria (PA-6)', () => {
  it('lead can set and get approval criteria', async () => {
    await setApprovalCriteria(teamName, {
      description: 'Only approve plans that include test coverage',
    });

    const criteria = await getApprovalCriteria(teamName);
    expect(criteria?.description).toBe(
      'Only approve plans that include test coverage'
    );
  });

  it('returns null when no criteria set', async () => {
    const criteria = await getApprovalCriteria(teamName);
    expect(criteria).toBeNull();
  });
});
