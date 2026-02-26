/**
 * Task list management — shared, persistent backlog with state machine and dependencies.
 *
 * The Team Lead is the ONLY writer to the backlog (single-writer invariant).
 * All team members can read. Teammates request mutations via the Lead.
 */

import fs from 'node:fs';
import { resolveTeamFile, withLock, atomicWriteFile, ensureDir } from '../utils/index.js';
import type { Task, TaskStatus, ComplexitySize } from '../types.js';
import path from 'node:path';

// ── Valid State Transitions ──

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
};

/**
 * Check if a state transition is valid. No backward transitions allowed.
 */
export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// ── Markdown Serialization ──

function serializeTask(task: Task): string {
  const lines: string[] = [];
  lines.push(`## ${task.id}: ${task.title}`);
  lines.push('');
  lines.push(`- **Status:** ${task.status}`);
  lines.push(`- **Assignee:** ${task.assignee ?? 'unassigned'}`);
  lines.push(`- **Complexity:** ${task.complexity ?? 'unestimated'}`);
  lines.push(`- **Dependencies:** ${task.dependencies.length > 0 ? task.dependencies.join(', ') : 'none'}`);
  lines.push(`- **Created:** ${task.createdAt}`);
  lines.push(`- **Updated:** ${task.updatedAt}`);
  lines.push('');
  lines.push(task.description);
  lines.push('');
  return lines.join('\n');
}

function serializeBacklog(tasks: Task[]): string {
  const header = '# Backlog\n\n';
  if (tasks.length === 0) return header;
  return header + tasks.map(serializeTask).join('---\n\n');
}

function parseTask(section: string): Task | null {
  const headerMatch = section.match(/^## ([^:]+):\s*(.+)$/m);
  if (!headerMatch) return null;

  const id = headerMatch[1].trim();
  const title = headerMatch[2].trim();

  const getField = (name: string): string => {
    const match = section.match(new RegExp(`- \\*\\*${name}:\\*\\*\\s*(.+)`, 'i'));
    return match ? match[1].trim() : '';
  };

  const statusRaw = getField('Status') as TaskStatus;
  const assigneeRaw = getField('Assignee');
  const complexityRaw = getField('Complexity');
  const depsRaw = getField('Dependencies');
  const created = getField('Created');
  const updated = getField('Updated');

  // Extract description: everything after the metadata lines
  const metaEnd = section.lastIndexOf('- **Updated:**');
  let description = '';
  if (metaEnd !== -1) {
    const afterMeta = section.substring(metaEnd);
    const lineEnd = afterMeta.indexOf('\n');
    if (lineEnd !== -1) {
      description = afterMeta.substring(lineEnd + 1).trim();
    }
  }

  return {
    id,
    title,
    description,
    status: statusRaw || 'pending',
    assignee: assigneeRaw === 'unassigned' ? undefined : assigneeRaw || undefined,
    complexity: complexityRaw === 'unestimated' ? undefined : (complexityRaw as ComplexitySize) || undefined,
    dependencies: depsRaw === 'none' || !depsRaw ? [] : depsRaw.split(',').map((d) => d.trim()),
    createdAt: created,
    updatedAt: updated,
  };
}

function parseBacklog(content: string): Task[] {
  // Split by task headers
  const sections = content.split(/(?=^## )/m).filter((s) => s.startsWith('## '));
  return sections.map(parseTask).filter((t): t is Task => t !== null);
}

// ── Core Operations ──

/**
 * Read the full task list (TS-3). Available to all team members.
 */
export function readTaskList(teamName: string): Task[] {
  const backlogPath = resolveTeamFile(teamName, 'backlog');
  if (!fs.existsSync(backlogPath)) return [];
  const content = fs.readFileSync(backlogPath, 'utf-8');
  return parseBacklog(content);
}

/**
 * Write the full task list to disk atomically (Lead-only).
 */
function writeTaskList(teamName: string, tasks: Task[]): void {
  const backlogPath = resolveTeamFile(teamName, 'backlog');
  ensureDir(path.dirname(backlogPath));
  atomicWriteFile(backlogPath, serializeBacklog(tasks));
}

/**
 * Create a new task (TS-4). Lead-only.
 */
export async function createTask(
  teamName: string,
  task: Omit<Task, 'status' | 'createdAt' | 'updatedAt'> & { status?: TaskStatus },
): Promise<Task> {
  const backlogPath = resolveTeamFile(teamName, 'backlog');

  return withLock(backlogPath, () => {
    const tasks = readTaskList(teamName);

    // Check for duplicate ID
    if (tasks.some((t) => t.id === task.id)) {
      throw new Error(`Task "${task.id}" already exists.`);
    }

    const now = new Date().toISOString();
    const newTask: Task = {
      ...task,
      status: task.status ?? 'pending',
      createdAt: now,
      updatedAt: now,
    };

    tasks.push(newTask);
    writeTaskList(teamName, tasks);
    return newTask;
  });
}

/**
 * Create multiple tasks in a single lock acquisition.
 * Much more efficient than calling createTask() N times in parallel.
 */
export async function createTasksBatch(
  teamName: string,
  taskInputs: Array<Omit<Task, 'status' | 'createdAt' | 'updatedAt'> & { status?: TaskStatus }>,
): Promise<Task[]> {
  const backlogPath = resolveTeamFile(teamName, 'backlog');

  return withLock(backlogPath, () => {
    const tasks = readTaskList(teamName);
    const now = new Date().toISOString();
    const created: Task[] = [];

    for (const input of taskInputs) {
      if (tasks.some((t) => t.id === input.id)) {
        continue; // Skip duplicates silently in batch mode
      }

      const newTask: Task = {
        ...input,
        status: input.status ?? 'pending',
        createdAt: now,
        updatedAt: now,
      };
      tasks.push(newTask);
      created.push(newTask);
    }

    writeTaskList(teamName, tasks);
    return created;
  });
}

/**
 * Internal: update a task without acquiring the lock.
 * Caller MUST hold the lock on backlog.md.
 */
export function updateTaskInternal(
  teamName: string,
  taskId: string,
  updates: Partial<Pick<Task, 'title' | 'description' | 'assignee' | 'complexity' | 'status' | 'dependencies'>>,
): Task {
  const tasks = readTaskList(teamName);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) {
    throw new Error(`Task "${taskId}" not found.`);
  }

  const current = tasks[idx];

  if (updates.status && updates.status !== current.status) {
    if (!isValidTransition(current.status, updates.status)) {
      throw new Error(
        `Invalid state transition: ${current.status} → ${updates.status}. ` +
          `Allowed transitions from "${current.status}": ${VALID_TRANSITIONS[current.status].join(', ') || 'none'}.`,
      );
    }
  }

  const updated: Task = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  tasks[idx] = updated;
  writeTaskList(teamName, tasks);
  return updated;
}

/**
 * Update an existing task (TS-4). Lead-only.
 */
export async function updateTask(
  teamName: string,
  taskId: string,
  updates: Partial<Pick<Task, 'title' | 'description' | 'assignee' | 'complexity' | 'status' | 'dependencies'>>,
): Promise<Task> {
  const backlogPath = resolveTeamFile(teamName, 'backlog');

  return withLock(backlogPath, () => {
    return updateTaskInternal(teamName, taskId, updates);
  });
}

/**
 * Delete a task (TS-4). Lead-only.
 */
export async function deleteTask(teamName: string, taskId: string): Promise<void> {
  const backlogPath = resolveTeamFile(teamName, 'backlog');

  await withLock(backlogPath, () => {
    const tasks = readTaskList(teamName);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) {
      throw new Error(`Task "${taskId}" not found.`);
    }
    tasks.splice(idx, 1);
    writeTaskList(teamName, tasks);
  });
}

// ── Dependency Resolution ──

/**
 * Get tasks that are blocked (pending with unresolved dependencies) (TS-7).
 */
export function getBlockedTasks(tasks: Task[]): Task[] {
  const completedIds = new Set(tasks.filter((t) => t.status === 'completed').map((t) => t.id));

  return tasks.filter((t) => {
    if (t.status !== 'pending') return false;
    if (t.dependencies.length === 0) return false;
    return t.dependencies.some((depId) => !completedIds.has(depId));
  });
}

/**
 * Get tasks that are unblocked and ready to be claimed (TS-7).
 * A task is unblocked if it's pending and all dependencies are completed.
 */
export function getUnblockedTasks(tasks: Task[]): Task[] {
  const completedIds = new Set(tasks.filter((t) => t.status === 'completed').map((t) => t.id));

  return tasks.filter((t) => {
    if (t.status !== 'pending') return false;
    return t.dependencies.every((depId) => completedIds.has(depId));
  });
}

/**
 * Check if a specific task is blocked by incomplete dependencies.
 */
export function isTaskBlocked(task: Task, allTasks: Task[]): boolean {
  if (task.dependencies.length === 0) return false;
  const completedIds = new Set(allTasks.filter((t) => t.status === 'completed').map((t) => t.id));
  return task.dependencies.some((depId) => !completedIds.has(depId));
}

/**
 * After a task completes, find tasks that become unblocked (TS-8).
 * Lead mediates this — re-evaluates blocked tasks atomically.
 */
export async function resolveCompletedDependencies(
  teamName: string,
  completedTaskId: string,
): Promise<Task[]> {
  const tasks = readTaskList(teamName);

  // Find tasks that depend on the just-completed task
  const newlyUnblocked = tasks.filter((t) => {
    if (t.status !== 'pending') return false;
    if (!t.dependencies.includes(completedTaskId)) return false;
    // Check if ALL deps are now completed
    const completedIds = new Set(tasks.filter((tt) => tt.status === 'completed').map((tt) => tt.id));
    completedIds.add(completedTaskId); // Include the one just completed
    return t.dependencies.every((depId) => completedIds.has(depId));
  });

  return newlyUnblocked;
}
