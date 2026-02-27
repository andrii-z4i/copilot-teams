/**
 * Sprint lifecycle management — planning, execution, and closure.
 *
 * Sprint state is stored as append-only sections in sprint.md.
 * Only the Lead may write to the sprint file (single-writer invariant).
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveTeamFile, withLock, ensureDir, atomicWriteFile, appendFile } from '../utils/index.js';
import { readTaskList, updateTask } from '../tasks/index.js';
import { COMPLEXITY_WEIGHTS, CAPACITY_PER_ITERATION } from '../constants.js';
import type { Sprint, SprintStatus, SprintAssignment, ComplexitySize } from '../types.js';

// ── Serialization ──

function serializeSprint(sprint: Sprint): string {
  const lines: string[] = [];
  lines.push(`Sprint #${sprint.number}`);
  lines.push(`Status: ${sprint.status}`);
  lines.push(`StartedAt: ${sprint.startedAt}`);
  lines.push(`ClosedAt: ${sprint.closedAt ?? 'null'}`);
  lines.push('');

  for (const a of sprint.assignments) {
    lines.push(`${a.teammate} - ${a.taskId} - ${a.taskTitle} - ${a.estimate}`);
  }

  lines.push('');
  return lines.join('\n');
}

function parseSprintSections(content: string): Sprint[] {
  const sections = content.split(/(?=^Sprint #)/m).filter((s) => s.startsWith('Sprint #'));
  return sections.map(parseSprintSection).filter((s): s is Sprint => s !== null);
}

function parseSprintSection(section: string): Sprint | null {
  const numberMatch = section.match(/^Sprint #(\d+)/m);
  if (!numberMatch) return null;

  const statusMatch = section.match(/^Status:\s*(.+)/m);
  const startedMatch = section.match(/^StartedAt:\s*(.+)/m);
  const closedMatch = section.match(/^ClosedAt:\s*(.+)/m);

  const number = parseInt(numberMatch[1], 10);
  const status = (statusMatch?.[1]?.trim() ?? 'planning') as SprintStatus;
  const startedAt = startedMatch?.[1]?.trim() ?? '';
  const closedAtRaw = closedMatch?.[1]?.trim();
  const closedAt = closedAtRaw === 'null' || !closedAtRaw ? null : closedAtRaw;

  // Parse assignments
  const assignmentLines = section
    .split('\n')
    .filter((line) => /^.+ - .+ - .+ - .+$/.test(line.trim()) && !line.startsWith('Sprint') && !line.startsWith('Status') && !line.startsWith('StartedAt') && !line.startsWith('ClosedAt'));

  const assignments: SprintAssignment[] = assignmentLines.map((line) => {
    const parts = line.trim().split(' - ');
    return {
      teammate: parts[0],
      taskId: parts[1],
      taskTitle: parts[2],
      estimate: parts[3] as ComplexitySize,
    };
  });

  return { number, status, startedAt, closedAt, assignments };
}

// ── Core Operations ──

/**
 * Read all sprints from the sprint file.
 */
export function readSprints(teamId: string): Sprint[] {
  const sprintPath = resolveTeamFile(teamId, 'sprint');
  if (!fs.existsSync(sprintPath)) return [];
  const content = fs.readFileSync(sprintPath, 'utf-8');
  return parseSprintSections(content);
}

/**
 * Get the current (latest non-closed) sprint, or null.
 */
export function getCurrentSprint(teamId: string): Sprint | null {
  const sprints = readSprints(teamId);
  // Return the latest sprint that is not closed
  for (let i = sprints.length - 1; i >= 0; i--) {
    if (sprints[i].status !== 'closed') return sprints[i];
  }
  return null;
}

/**
 * Get a specific sprint by number.
 */
export function getSprint(teamId: string, sprintNumber: number): Sprint | null {
  const sprints = readSprints(teamId);
  return sprints.find((s) => s.number === sprintNumber) ?? null;
}

/**
 * Start a new sprint in planning status.
 */
export async function startSprint(
  teamId: string,
  sprintNumber: number,
  taskIds: string[],
): Promise<Sprint> {
  const sprintPath = resolveTeamFile(teamId, 'sprint');

  return withLock(sprintPath, () => {
    const existing = readSprints(teamId);

    // Validate no active sprint
    const active = existing.find((s) => s.status !== 'closed');
    if (active) {
      throw new Error(
        `Sprint #${active.number} is still ${active.status}. Close it before starting a new sprint.`,
      );
    }

    // Validate sprint number is sequential
    const lastNumber = existing.length > 0 ? existing[existing.length - 1].number : 0;
    if (sprintNumber !== lastNumber + 1) {
      throw new Error(
        `Sprint number must be ${lastNumber + 1} (sequential). Got ${sprintNumber}.`,
      );
    }

    // Read tasks to validate they exist
    const tasks = readTaskList(teamId);
    for (const taskId of taskIds) {
      if (!tasks.find((t) => t.id === taskId)) {
        throw new Error(`Task "${taskId}" not found in backlog.`);
      }
    }

    const sprint: Sprint = {
      number: sprintNumber,
      status: 'planning',
      startedAt: new Date().toISOString(),
      closedAt: null,
      assignments: [],
    };

    // Append new sprint section
    ensureDir(path.dirname(sprintPath));
    appendFile(sprintPath, serializeSprint(sprint) + '---\n\n');

    return sprint;
  });
}

/**
 * Activate a sprint — transition from planning to active.
 * Assignments must be set before activation.
 */
export async function activateSprint(
  teamId: string,
  sprintNumber: number,
  assignments: SprintAssignment[],
): Promise<Sprint> {
  const sprintPath = resolveTeamFile(teamId, 'sprint');

  return withLock(sprintPath, () => {
    const sprints = readSprints(teamId);
    const sprint = sprints.find((s) => s.number === sprintNumber);

    if (!sprint) {
      throw new Error(`Sprint #${sprintNumber} not found.`);
    }
    if (sprint.status !== 'planning') {
      throw new Error(
        `Sprint #${sprintNumber} is "${sprint.status}", not "planning". Cannot activate.`,
      );
    }

    // Validate capacity limits (TS-16)
    const loadByTeammate = new Map<string, number>();
    for (const assignment of assignments) {
      const current = loadByTeammate.get(assignment.teammate) ?? 0;
      const weight = COMPLEXITY_WEIGHTS[assignment.estimate] ?? 0;
      const newLoad = current + weight;
      if (newLoad > CAPACITY_PER_ITERATION) {
        throw new Error(
          `Teammate "${assignment.teammate}" would exceed capacity limit ` +
          `(${newLoad} > ${CAPACITY_PER_ITERATION} weight points). ` +
          `Reduce their assignments or decompose tasks.`
        );
      }
      loadByTeammate.set(assignment.teammate, newLoad);
    }

    // Update the sprint in-place
    sprint.status = 'active';
    sprint.assignments = assignments;

    // Rewrite the entire file (we overwrite the last section)
    rewriteSprints(teamId, sprints);

    return sprint;
  });
}

/**
 * Close a sprint — transition from active to closed.
 * Unfinished tasks are returned to the backlog.
 */
export async function closeSprint(
  teamId: string,
  sprintNumber: number,
): Promise<{ sprint: Sprint; unfinishedTaskIds: string[] }> {
  const sprintPath = resolveTeamFile(teamId, 'sprint');

  return withLock(sprintPath, () => {
    const sprints = readSprints(teamId);
    const sprint = sprints.find((s) => s.number === sprintNumber);

    if (!sprint) {
      throw new Error(`Sprint #${sprintNumber} not found.`);
    }
    if (sprint.status !== 'active') {
      throw new Error(
        `Sprint #${sprintNumber} is "${sprint.status}", not "active". Cannot close.`,
      );
    }

    // Find unfinished tasks
    const tasks = readTaskList(teamId);
    const sprintTaskIds = sprint.assignments.map((a) => a.taskId);
    const unfinishedTaskIds = sprintTaskIds.filter((id) => {
      const task = tasks.find((t) => t.id === id);
      return task && task.status !== 'completed';
    });

    sprint.status = 'closed';
    sprint.closedAt = new Date().toISOString();

    rewriteSprints(teamId, sprints);

    return { sprint, unfinishedTaskIds };
  });
}

/**
 * Get task IDs assigned in the current sprint for a specific teammate.
 */
export function getTeammateSprintTaskIds(
  teamId: string,
  teammateName: string,
): string[] {
  const sprint = getCurrentSprint(teamId);
  if (!sprint) return [];
  return sprint.assignments
    .filter((a) => a.teammate === teammateName)
    .map((a) => a.taskId);
}

// ── Internal Helpers ──

/**
 * Rewrite all sprints to the sprint file.
 * Used when updating a sprint section (only Lead may do this).
 */
function rewriteSprints(teamId: string, sprints: Sprint[]): void {
  const sprintPath = resolveTeamFile(teamId, 'sprint');
  ensureDir(path.dirname(sprintPath));
  const content = sprints.map((s) => serializeSprint(s) + '---\n\n').join('');
  atomicWriteFile(sprintPath, content);
}
