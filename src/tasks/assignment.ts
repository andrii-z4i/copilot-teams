/**
 * Task assignment and claiming — Lead-mediated, concurrency-safe.
 *
 * The Lead assigns tasks to teammates. Teammates request claims via the Lead.
 * All mutations go through the Lead with file locking for concurrency safety.
 */

import { resolveTeamFile, withLock } from '../utils/index.js';
import { readTaskList, updateTask, updateTaskInternal, isTaskBlocked, getUnblockedTasks } from './index.js';
import { sendMessage } from '../comms/index.js';
import type { Task } from '../types.js';

// ── Assignment ──

/**
 * Assign a task to a specific teammate (TS-9). Lead-only.
 * Validates the task is pending and unblocked, then transitions to in_progress.
 */
export async function assignTask(
  teamId: string,
  taskId: string,
  teammateName: string,
): Promise<Task> {
  const backlogPath = resolveTeamFile(teamId, 'backlog');

  return withLock(backlogPath, async () => {
    const tasks = readTaskList(teamId);
    const task = tasks.find((t) => t.id === taskId);

    if (!task) {
      throw new Error(`Task "${taskId}" not found.`);
    }

    if (task.status !== 'pending') {
      throw new Error(
        `Task "${taskId}" is not pending (current status: ${task.status}). Only pending tasks can be assigned.`,
      );
    }

    if (isTaskBlocked(task, tasks)) {
      const incompleteDeps = task.dependencies.filter(
        (depId) => !tasks.find((t) => t.id === depId && t.status === 'completed'),
      );
      throw new Error(
        `Task "${taskId}" is blocked by incomplete dependencies: ${incompleteDeps.join(', ')}. ` +
          'Resolve dependencies before assigning.',
      );
    }

    // Assign and transition to in_progress
    const updated = updateTaskInternal(teamId, taskId, {
      assignee: teammateName,
      status: 'in_progress',
    });

    // Notify teammate via mailbox
    try {
      await sendMessage(
        teamId,
        'lead',
        teammateName,
        `[ASSIGNED] Task ${taskId}: ${task.title} has been assigned to you.`,
      );
    } catch {
      // Mailbox may not be initialized yet — assignment still succeeds
    }

    return updated;
  });
}

// ── Claiming ──

/**
 * Teammate requests to claim the next available task (TS-10, TS-12).
 * Lead mediates the claim atomically to prevent race conditions.
 *
 * Only claims tasks already assigned to this teammate in the current sprint.
 * Returns the claimed task or null if none available.
 */
export async function claimNextTask(
  teamId: string,
  teammateName: string,
  sprintTaskIds?: string[],
): Promise<Task | null> {
  const backlogPath = resolveTeamFile(teamId, 'backlog');

  return withLock(backlogPath, async () => {
    const tasks = readTaskList(teamId);

    // Find pending tasks assigned to this teammate in the current sprint
    let candidates = tasks.filter(
      (t) => t.status === 'pending' && t.assignee === teammateName,
    );

    // If sprint task IDs provided, restrict to sprint scope (TS-11)
    if (sprintTaskIds) {
      candidates = candidates.filter((t) => sprintTaskIds.includes(t.id));
    }

    // Filter out blocked tasks
    candidates = candidates.filter((t) => !isTaskBlocked(t, tasks));

    if (candidates.length === 0) return null;

    // Claim the first available
    const toClaim = candidates[0];
    const claimed = updateTaskInternal(teamId, toClaim.id, {
      status: 'in_progress',
    });

    return claimed;
  });
}

// ── Auto-Pickup (TS-11) ──

export interface AutoPickupResult {
  nextTask: Task | null;
  idle: boolean;
}

/**
 * After a teammate completes a task, check for the next assigned sprint task.
 * If no tasks remain, teammate goes idle (TS-11).
 */
export async function autoPickupNextTask(
  teamId: string,
  teammateName: string,
  sprintTaskIds: string[],
): Promise<AutoPickupResult> {
  const tasks = readTaskList(teamId);

  // Find pending tasks assigned to this teammate in this sprint
  const remaining = tasks.filter(
    (t) =>
      t.status === 'pending' &&
      t.assignee === teammateName &&
      sprintTaskIds.includes(t.id) &&
      !isTaskBlocked(t, tasks),
  );

  if (remaining.length === 0) {
    return { nextTask: null, idle: true };
  }

  // Claim the next one
  const next = await claimNextTask(teamId, teammateName, sprintTaskIds);
  return { nextTask: next, idle: next === null };
}

/**
 * Get all tasks assigned to a teammate in a given sprint scope.
 */
export function getTeammateSprintTasks(
  teamId: string,
  teammateName: string,
  sprintTaskIds: string[],
): Task[] {
  const tasks = readTaskList(teamId);
  return tasks.filter(
    (t) => t.assignee === teammateName && sprintTaskIds.includes(t.id),
  );
}
