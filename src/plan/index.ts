/**
 * Plan approval workflow (R16).
 *
 * Teammates operate in read-only plan mode, produce plans, submit for
 * lead review. Lead approves or rejects (with feedback). After 3
 * consecutive rejections the task returns to backlog.
 */

import { resolvePath, withLock, atomicWriteFile } from '../utils/index.js';
import fs from 'node:fs/promises';

// ── Types ──

export type PlanStatus = 'pending' | 'approved' | 'rejected';
export type TeammateOperatingMode = 'plan' | 'implement' | 'idle';

export interface PlanApprovalRequest {
  id: string;
  teammateName: string;
  taskId: string;
  plan: string;
  revision: number;
  status: PlanStatus;
  feedback?: string;
  submittedAt: string;
  reviewedAt?: string;
}

export interface TeammateState {
  name: string;
  mode: TeammateOperatingMode;
  currentTaskId?: string;
}

export interface ApprovalCriteria {
  description: string;
}

// ── Constants ──

const PLANS_FILE = 'plans.json';
const TEAMMATE_STATES_FILE = 'teammate-states.json';
const APPROVAL_CRITERIA_FILE = 'approval-criteria.json';
const MAX_REVISIONS = 3;

// ── Internal helpers ──

async function readPlans(teamId: string): Promise<PlanApprovalRequest[]> {
  const filePath = resolvePath(teamId, PLANS_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writePlans(
  teamId: string,
  plans: PlanApprovalRequest[]
): Promise<void> {
  const filePath = resolvePath(teamId, PLANS_FILE);
  await atomicWriteFile(filePath, JSON.stringify(plans, null, 2));
}

async function readTeammateStates(
  teamId: string
): Promise<TeammateState[]> {
  const filePath = resolvePath(teamId, TEAMMATE_STATES_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeTeammateStates(
  teamId: string,
  states: TeammateState[]
): Promise<void> {
  const filePath = resolvePath(teamId, TEAMMATE_STATES_FILE);
  await atomicWriteFile(filePath, JSON.stringify(states, null, 2));
}

// ── Public API ──

/**
 * Enter plan mode for a teammate (PA-1).
 * In plan mode the teammate can explore code but MUST NOT modify files.
 */
export async function enterPlanMode(
  teamId: string,
  teammateName: string,
  taskId: string
): Promise<TeammateState> {
  const lockPath = resolvePath(teamId, TEAMMATE_STATES_FILE);
  return withLock(lockPath, async () => {
    const states = await readTeammateStates(teamId);
    let state = states.find((s) => s.name === teammateName);
    if (state) {
      state.mode = 'plan';
      state.currentTaskId = taskId;
    } else {
      state = { name: teammateName, mode: 'plan', currentTaskId: taskId };
      states.push(state);
    }
    await writeTeammateStates(teamId, states);
    return { ...state };
  });
}

/**
 * Get the current operating mode of a teammate.
 */
export async function getTeammateMode(
  teamId: string,
  teammateName: string
): Promise<TeammateState | undefined> {
  const states = await readTeammateStates(teamId);
  return states.find((s) => s.name === teammateName);
}

/**
 * Check whether a teammate is in plan mode (cannot write files).
 */
export async function isInPlanMode(
  teamId: string,
  teammateName: string
): Promise<boolean> {
  const state = await getTeammateMode(teamId, teammateName);
  return state?.mode === 'plan';
}

/**
 * Submit a plan for approval (PA-2).
 * Returns the created request. The teammate blocks until reviewed.
 */
export async function submitPlanForApproval(
  teamId: string,
  teammateName: string,
  taskId: string,
  plan: string
): Promise<PlanApprovalRequest> {
  const lockPath = resolvePath(teamId, PLANS_FILE);
  return withLock(lockPath, async () => {
    const plans = await readPlans(teamId);

    // Count prior revisions for this teammate + task
    const priorRevisions = plans.filter(
      (p) => p.teammateName === teammateName && p.taskId === taskId
    );
    const revision = priorRevisions.length + 1;

    if (revision > MAX_REVISIONS) {
      throw new Error(
        `Maximum revisions (${MAX_REVISIONS}) exceeded for task ${taskId} by ${teammateName}`
      );
    }

    const request: PlanApprovalRequest = {
      id: `plan-${teammateName}-${taskId}-r${revision}`,
      teammateName,
      taskId,
      plan,
      revision,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };

    plans.push(request);
    await writePlans(teamId, plans);
    return request;
  });
}

/**
 * Review a plan — approve or reject with optional feedback (PA-3, PA-4, PA-5).
 *
 * On approve: teammate transitions to implement mode.
 * On reject: teammate stays in plan mode with feedback.
 * After MAX_REVISIONS rejections: task returns to backlog, teammate goes idle.
 */
export async function reviewPlan(
  teamId: string,
  requestId: string,
  decision: 'approved' | 'rejected',
  feedback?: string
): Promise<PlanApprovalRequest> {
  const lockPath = resolvePath(teamId, PLANS_FILE);
  return withLock(lockPath, async () => {
    const plans = await readPlans(teamId);
    const request = plans.find((p) => p.id === requestId);
    if (!request) {
      throw new Error(`Plan request ${requestId} not found`);
    }
    if (request.status !== 'pending') {
      throw new Error(`Plan request ${requestId} already reviewed`);
    }

    request.status = decision;
    request.feedback = feedback;
    request.reviewedAt = new Date().toISOString();
    await writePlans(teamId, plans);

    // Update teammate state
    const statesLock = resolvePath(teamId, TEAMMATE_STATES_FILE);
    await withLock(statesLock, async () => {
      const states = await readTeammateStates(teamId);
      const state = states.find((s) => s.name === request.teammateName);
      if (state) {
        if (decision === 'approved') {
          state.mode = 'implement';
        } else {
          // Check if max rejections reached
          const rejections = plans.filter(
            (p) =>
              p.teammateName === request.teammateName &&
              p.taskId === request.taskId &&
              p.status === 'rejected'
          );
          if (rejections.length >= MAX_REVISIONS) {
            state.mode = 'idle';
            state.currentTaskId = undefined;
          }
          // Otherwise stays in plan mode
        }
        await writeTeammateStates(teamId, states);
      }
    });

    return request;
  });
}

/**
 * Get all plan requests for a given teammate and task.
 */
export async function getPlanHistory(
  teamId: string,
  teammateName: string,
  taskId: string
): Promise<PlanApprovalRequest[]> {
  const plans = await readPlans(teamId);
  return plans.filter(
    (p) => p.teammateName === teammateName && p.taskId === taskId
  );
}

/**
 * Get pending plan requests awaiting review.
 */
export async function getPendingPlans(
  teamId: string
): Promise<PlanApprovalRequest[]> {
  const plans = await readPlans(teamId);
  return plans.filter((p) => p.status === 'pending');
}

/**
 * Count rejections for a teammate's task.
 */
export async function getRejectionCount(
  teamId: string,
  teammateName: string,
  taskId: string
): Promise<number> {
  const plans = await readPlans(teamId);
  return plans.filter(
    (p) =>
      p.teammateName === teammateName &&
      p.taskId === taskId &&
      p.status === 'rejected'
  ).length;
}

/**
 * Set approval criteria that the lead uses to make decisions (PA-6).
 */
export async function setApprovalCriteria(
  teamId: string,
  criteria: ApprovalCriteria
): Promise<void> {
  const filePath = resolvePath(teamId, APPROVAL_CRITERIA_FILE);
  await atomicWriteFile(filePath, JSON.stringify(criteria, null, 2));
}

/**
 * Get the current approval criteria.
 */
export async function getApprovalCriteria(
  teamId: string
): Promise<ApprovalCriteria | null> {
  const filePath = resolvePath(teamId, APPROVAL_CRITERIA_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
