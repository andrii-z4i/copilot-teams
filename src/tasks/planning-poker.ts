/**
 * Task complexity estimation via planning poker and capacity-based assignment balancing.
 *
 * All teammates estimate independently. The mode (most frequent) wins.
 * Ties go to the higher size. Lead facilitates and enforces capacity limits.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveTeamFile, ensureDir, atomicWriteFile } from '../utils/index.js';
import { readTaskList, updateTask } from './index.js';
import { COMPLEXITY_WEIGHTS, CAPACITY_PER_ITERATION } from '../constants.js';
import type { ComplexitySize, Task } from '../types.js';

// ── Types ──

export interface PlanningPokerSession {
  teamName: string;
  taskId: string;
  estimates: Map<string, ComplexitySize>;
  resolved: boolean;
  finalSize?: ComplexitySize;
}

interface EstimatesFile {
  [taskId: string]: {
    estimates: Record<string, ComplexitySize>;
    resolved: boolean;
    finalSize?: ComplexitySize;
  };
}

// ── Size ordering for tie-breaking ──

const SIZE_ORDER: ComplexitySize[] = ['S', 'M', 'L', 'XL'];

function sizeRank(size: ComplexitySize): number {
  return SIZE_ORDER.indexOf(size);
}

// ── Estimates Storage ──

function estimatesFilePath(teamName: string): string {
  return path.join(path.dirname(resolveTeamFile(teamName, 'config')), 'estimates.json');
}

function loadEstimatesFile(teamName: string): EstimatesFile {
  const filePath = estimatesFilePath(teamName);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as EstimatesFile;
  } catch {
    return {};
  }
}

function saveEstimatesFile(teamName: string, data: EstimatesFile): void {
  const filePath = estimatesFilePath(teamName);
  ensureDir(path.dirname(filePath));
  atomicWriteFile(filePath, JSON.stringify(data, null, 2));
}

// ── Planning Poker ──

/**
 * Start a planning poker session for the given tasks (TS-15).
 * Creates estimate slots; teammates submit independently.
 */
export function startPlanningPoker(teamName: string, taskIds: string[]): void {
  const data = loadEstimatesFile(teamName);
  for (const taskId of taskIds) {
    if (!data[taskId]) {
      data[taskId] = { estimates: {}, resolved: false };
    }
  }
  saveEstimatesFile(teamName, data);
}

/**
 * Submit an estimate for a task (TS-15).
 * Estimates are hidden until all have submitted (to prevent anchoring).
 */
export function submitEstimate(
  teamName: string,
  taskId: string,
  teammateName: string,
  size: ComplexitySize,
): void {
  if (!SIZE_ORDER.includes(size)) {
    throw new Error(`Invalid complexity size "${size}". Valid: ${SIZE_ORDER.join(', ')}`);
  }

  const data = loadEstimatesFile(teamName);
  if (!data[taskId]) {
    throw new Error(`No planning poker session found for task "${taskId}". Start one first.`);
  }
  if (data[taskId].resolved) {
    throw new Error(`Estimates for task "${taskId}" have already been resolved.`);
  }

  data[taskId].estimates[teammateName] = size;
  saveEstimatesFile(teamName, data);
}

/**
 * Get estimates for a task. Returns null for teammate names if not all submitted
 * (to prevent anchoring — TS-15).
 */
export function getEstimates(
  teamName: string,
  taskId: string,
  allTeammateNames: string[],
): { allSubmitted: boolean; estimates: Record<string, ComplexitySize | null> } {
  const data = loadEstimatesFile(teamName);
  const session = data[taskId];
  if (!session) {
    throw new Error(`No planning poker session for task "${taskId}".`);
  }

  const allSubmitted = allTeammateNames.every((name) => name in session.estimates);

  const estimates: Record<string, ComplexitySize | null> = {};
  for (const name of allTeammateNames) {
    // Only reveal estimates if all submitted (prevent anchoring)
    estimates[name] = allSubmitted ? (session.estimates[name] ?? null) : null;
  }

  return { allSubmitted, estimates };
}

/**
 * Resolve estimates for a task — pick mode, ties go higher (TS-14).
 * Assigns the resolved complexity to the task (TS-13).
 */
export async function resolveEstimates(
  teamName: string,
  taskId: string,
): Promise<ComplexitySize> {
  const data = loadEstimatesFile(teamName);
  const session = data[taskId];
  if (!session) {
    throw new Error(`No planning poker session for task "${taskId}".`);
  }

  const estimates = Object.values(session.estimates);
  if (estimates.length === 0) {
    throw new Error(`No estimates submitted for task "${taskId}".`);
  }

  // Count frequencies
  const freq: Record<string, number> = {};
  for (const size of estimates) {
    freq[size] = (freq[size] ?? 0) + 1;
  }

  // Find the mode (most frequent). On tie, pick the higher size.
  const maxFreq = Math.max(...Object.values(freq));
  const modes = Object.keys(freq).filter((s) => freq[s] === maxFreq) as ComplexitySize[];

  // Tie-break: pick highest
  const resolved = modes.reduce((a, b) => (sizeRank(a) >= sizeRank(b) ? a : b));

  // Update estimates file
  data[taskId].resolved = true;
  data[taskId].finalSize = resolved;
  saveEstimatesFile(teamName, data);

  // Assign complexity to task (TS-13)
  await updateTask(teamName, taskId, { complexity: resolved });

  return resolved;
}

// ── Capacity Management ──

/**
 * Calculate the total weight of tasks assigned to a teammate (TS-16).
 */
export function calculateTeammateLoad(teamName: string, teammateName: string): number {
  const tasks = readTaskList(teamName);
  return tasks
    .filter(
      (t) =>
        t.assignee === teammateName &&
        (t.status === 'pending' || t.status === 'in_progress') &&
        t.complexity,
    )
    .reduce((sum, t) => sum + COMPLEXITY_WEIGHTS[t.complexity!], 0);
}

/**
 * Check if assigning a task to a teammate would exceed capacity (TS-16).
 */
export function wouldExceedCapacity(
  currentLoad: number,
  taskComplexity: ComplexitySize,
): boolean {
  return currentLoad + COMPLEXITY_WEIGHTS[taskComplexity] > CAPACITY_PER_ITERATION;
}

/**
 * Balance task assignments across teammates by weight (TS-17).
 * Returns a suggested assignment map: taskId → teammateName.
 */
export function balanceAssignments(
  pendingTasks: Task[],
  teammateNames: string[],
  currentLoads?: Record<string, number>,
): Record<string, string> {
  const loads: Record<string, number> = {};
  for (const name of teammateNames) {
    loads[name] = currentLoads?.[name] ?? 0;
  }

  const assignments: Record<string, string> = {};
  const xlWarnings: string[] = [];

  // Sort tasks by weight descending (assign heaviest first for better balance)
  const sorted = [...pendingTasks]
    .filter((t) => t.complexity)
    .sort((a, b) => COMPLEXITY_WEIGHTS[b.complexity!] - COMPLEXITY_WEIGHTS[a.complexity!]);

  for (const task of sorted) {
    const weight = COMPLEXITY_WEIGHTS[task.complexity!];

    // TS-18: Flag XL tasks for potential decomposition
    if (task.complexity === 'XL') {
      xlWarnings.push(task.id);
    }

    // Find teammate with lowest load who can fit this task
    const eligible = teammateNames
      .filter((name) => loads[name] + weight <= CAPACITY_PER_ITERATION)
      .sort((a, b) => loads[a] - loads[b]);

    if (eligible.length === 0) continue; // No one can fit it

    const assignee = eligible[0];
    assignments[task.id] = assignee;
    loads[assignee] += weight;
  }

  return assignments;
}

/**
 * Get XL tasks that should be considered for decomposition (TS-18).
 */
export function getXLTasksForDecomposition(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.complexity === 'XL' && t.status === 'pending');
}
