#!/usr/bin/env node

/**
 * copilot-teams MCP Server
 *
 * Exposes all copilot-teams operations as MCP tools so GitHub Copilot CLI
 * can call them via natural language.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { z } from 'zod';

// ── Library imports ──
import { createTeam, loadTeam, cleanupTeam } from './team/index.js';
import {
  spawnTeammate,
  getTeammateStatuses,
  formatTeammateList,
  requestShutdown,
  forceShutdown,
} from './teammate/index.js';
import { createTask, createTasksBatch, readTaskList, updateTask, deleteTask } from './tasks/index.js';
import { assignTask, claimNextTask } from './tasks/assignment.js';
import {
  startSprint,
  activateSprint,
  closeSprint,
  getCurrentSprint,
  getSprint,
  readSprints,
} from './sprint/index.js';
import { sendMessage, broadcastMessage, readMessages, readAllMessages } from './comms/index.js';
import {
  getPendingPlans,
  reviewPlan,
  enterPlanMode,
  submitPlanForApproval,
  setApprovalCriteria,
} from './plan/index.js';
import { getActiveFileClaims, detectFileConflicts, claimFile, releaseFile } from './utils/file-claims.js';
import {
  startPlanningPoker,
  submitEstimate,
  resolveEstimates,
  balanceAssignments,
} from './tasks/planning-poker.js';
import {
  requestPermission,
  reviewPermission,
  readAuditLog,
  loadPendingRequests,
} from './permissions/index.js';
import { loadHooks, saveHooks } from './hooks/index.js';
import { warnTeamSize } from './utils/cost.js';
import { TEAMS_BASE_DIR } from './constants.js';

import fs from 'node:fs';
import path from 'node:path';

// ── Input Validation Schemas ──
const SafeId = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Must start with alphanumeric, contain only alphanumeric, dots, underscores, hyphens');
const SafeTeamName = z.string().min(1).max(50).regex(/^[a-z0-9][a-z0-9-]*$/, 'Must be lowercase alphanumeric with hyphens');
const SafeBody = z.string().max(100_000);

// ── Team name resolution (same logic as CLI helpers) ──

const LAST_TEAM_FILE = path.join(TEAMS_BASE_DIR, '.last-team');

function readLastTeam(): string | null {
  try {
    const name = fs.readFileSync(LAST_TEAM_FILE, 'utf-8').trim();
    if (name && fs.existsSync(path.join(TEAMS_BASE_DIR, name, 'config.json'))) {
      return name;
    }
  } catch { /* missing */ }
  return null;
}

function findSoleTeam(): string | null {
  try {
    const entries = fs.readdirSync(TEAMS_BASE_DIR, { withFileTypes: true });
    const teamDirs = entries.filter(
      e => e.isDirectory() && fs.existsSync(path.join(TEAMS_BASE_DIR, e.name, 'config.json'))
    );
    if (teamDirs.length === 1) return teamDirs[0].name;
  } catch { /* missing */ }
  return null;
}

function resolveTeam(teamName?: string): string {
  if (teamName) return teamName;
  const last = readLastTeam();
  if (last) return last;
  const sole = findSoleTeam();
  if (sole) return sole;
  throw new Error('No teams exist. Create one first with the create_team tool.');
}

function saveLastTeam(name: string): void {
  fs.mkdirSync(TEAMS_BASE_DIR, { recursive: true });
  fs.writeFileSync(LAST_TEAM_FILE, name, 'utf-8');
}

/**
 * Resolve the sender identity for messages.
 * If this MCP server is running inside a spawned teammate process,
 * use the teammate name. Otherwise use the lead session ID.
 */
function resolveSender(team: { leadSessionId: string }): string {
  const teammateName = process.env.COPILOT_TEAMS_TEAMMATE_NAME;
  return teammateName || team.leadSessionId;
}

/** Check if this MCP server is running as a teammate (not the lead). */
function isTeammate(): boolean {
  return process.env.COPILOT_TEAMS_TEAMMATE === '1';
}

function listAllTeams(): Array<{ teamName: string; leadSessionId: string; members: number; createdAt: string }> {
  if (!fs.existsSync(TEAMS_BASE_DIR)) return [];
  const entries = fs.readdirSync(TEAMS_BASE_DIR, { withFileTypes: true });
  const results: Array<{ teamName: string; leadSessionId: string; members: number; createdAt: string }> = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const t = loadTeam(e.name);
      results.push({ teamName: t.teamName, leadSessionId: t.leadSessionId, members: t.members.length, createdAt: t.createdAt });
    } catch { /* skip */ }
  }
  return results;
}

// Helper: format result as MCP text content
function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

function json(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] };
}

function safeLoadTeam(name: string) {
  try {
    return loadTeam(name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg.replace(/\/[\w/.\-]+\/\.copilot\/teams\//g, '<teams-dir>/'));
  }
}

// ── Server setup ──

const server = new McpServer(
  {
    name: 'copilot-teams',
    version: '0.1.0',
  },
  {
    instructions: `You have access to the "copilot-teams" MCP tools for coordinating multiple AI teammates.

WHEN TO USE THESE TOOLS:
- When the user asks to create a team, spawn teammates, or coordinate work across agents
- When the user mentions "team", "teammates", "sprint", "backlog", or "task assignment"
- When the user wants multiple AI agents working on different parts of a codebase
- When the user asks about team status, task progress, or teammate activity

HOW IT WORKS:
For the SIMPLEST experience, use run_team — it handles everything in one call:
  run_team — creates team, tasks, spawns teammates, runs sprint, monitors, auto-respawns, collects reports

For step-by-step control:
1. create_team — creates a team (user becomes the Lead)
2. add_tasks (plural) — adds multiple tasks in one batch (faster than add_task for 3+ tasks)
3. spawn_teammate — launches AI teammates with specific roles and instructions
4. start_sprint / activate_sprint — organizes work into sprints with assignments
5. send_message / broadcast_message — communicates with teammates
6. team_status — shows full dashboard of team, tasks, sprint progress
7. get_all_reports — retrieves detailed findings/reports from all teammates

IMPORTANT:
- Prefer run_team for most workflows — it handles auto-respawning crashed teammates
- Use add_tasks (plural) instead of add_task when creating 3+ tasks — avoids lock contention
- Use spawn_teammate (not your own built-in agents) when the user asks for teammates
- When the user asks for reports, findings, or results from teammates, use get_all_reports
- Most tools auto-detect the team name — no need to specify it
- The user is the Team Lead; all coordination flows through them`,
  }
);

// ════════════════════════════════════════
// TEAM LIFECYCLE
// ════════════════════════════════════════

server.tool(
  'create_team',
  'Create a new team. You become the Team Lead who orchestrates teammates.',
  {
    session_id: z.string().describe('Your session identifier'),
    team_name: SafeTeamName.optional().describe('Custom team name (auto-generated if omitted)'),
  },
  async ({ session_id, team_name }) => {
    const team = await createTeam({ leadSessionId: session_id, teamName: team_name });
    saveLastTeam(team.teamName);
    return json({
      teamName: team.teamName,
      leadSessionId: team.leadSessionId,
      createdAt: team.createdAt,
    });
  }
);

server.tool(
  'list_teams',
  'List all existing teams with their lead session, member count, and creation time.',
  {},
  async () => {
    const teams = listAllTeams();
    if (teams.length === 0) return text('No teams exist. Create one with create_team.');
    return json(teams);
  }
);

server.tool(
  'show_team',
  'Show detailed information about a team including all members and their status.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected if only one team exists)'),
  },
  async ({ team_name }) => {
    const name = resolveTeam(team_name);
    const team = safeLoadTeam(name);
    return json({
      teamName: team.teamName,
      leadSessionId: team.leadSessionId,
      createdAt: team.createdAt,
      members: team.members.map(m => ({
        name: m.name,
        status: m.status,
        agentType: m.agentType,
        pid: m.pid ?? null,
      })),
    });
  }
);

server.tool(
  'cleanup_team',
  'Remove a team and all its data. All teammates must be stopped first.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected if only one team exists)'),
  },
  async ({ team_name }) => {
    if (isTeammate()) {
      return text('Error: This operation is restricted to the Team Lead.');
    }
    const name = resolveTeam(team_name);
    const team = safeLoadTeam(name);
    try {
      await cleanupTeam(name, team.leadSessionId);
      return text(`Team "${name}" cleaned up successfully.`);
    } catch (err) {
      return text(`Cleanup failed for team "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

// ════════════════════════════════════════
// TEAMMATE MANAGEMENT
// ════════════════════════════════════════

server.tool(
  'spawn_teammate',
  'Spawn a new AI teammate. The teammate runs as a separate Copilot CLI process.',
  {
    name: SafeId.describe('Teammate name (e.g. "auth-coder", "test-writer")'),
    prompt: z.string().max(100_000).describe('Task instructions for the teammate — what should they work on?'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
    agent_type: z.enum(['coder', 'reviewer', 'tester']).optional().describe('Agent type (default: coder)'),
    model: z.string().optional().describe('Model override for this teammate'),
  },
  async ({ name, prompt, team_name, agent_type, model }) => {
    if (isTeammate()) {
      return text('Error: This operation is restricted to the Team Lead.');
    }
    const tn = resolveTeam(team_name);
    const team = safeLoadTeam(tn);
    const warning = warnTeamSize(team.members.length + 1);
    const tm = await spawnTeammate(tn, team.leadSessionId, {
      name,
      agentType: agent_type ?? 'coder',
      model,
      spawnPrompt: prompt,
    });
    // Audit: log the spawn as a message
    await sendMessage(tn, team.leadSessionId, name,
      `[SPAWNED] You have been spawned as ${agent_type ?? 'coder'}. Instructions: ${prompt}`);
    const result: Record<string, unknown> = {
      name: tm.name,
      pid: tm.pid,
      status: 'spawning',
    };
    if (warning.warn) result.costWarning = warning.message;
    return json(result);
  }
);

server.tool(
  'list_teammates',
  'List all teammates with their current status, assigned tasks, and process info.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ team_name }) => {
    const tn = resolveTeam(team_name);
    const statuses = getTeammateStatuses(tn);
    if (statuses.length === 0) return text('No teammates. Spawn one with spawn_teammate.');
    return json(statuses);
  }
);

server.tool(
  'shutdown_teammate',
  'Gracefully shut down a teammate. Waits for them to finish current work.',
  {
    teammate_name: SafeId.describe('Name of the teammate to shut down'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
    // timeout_ms is in milliseconds (default: 30000)
    timeout_ms: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
  },
  async ({ teammate_name, team_name, timeout_ms }) => {
    if (isTeammate()) {
      return text('Error: This operation is restricted to the Team Lead.');
    }
    const tn = resolveTeam(team_name);
    const team = safeLoadTeam(tn);
    const result = await requestShutdown(tn, team.leadSessionId, teammate_name, timeout_ms);
    return json(result);
  }
);

server.tool(
  'force_stop_teammate',
  'Force-stop an unresponsive teammate immediately.',
  {
    teammate_name: SafeId.describe('Name of the teammate to stop'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ teammate_name, team_name }) => {
    if (isTeammate()) {
      return text('Error: This operation is restricted to the Team Lead.');
    }
    const tn = resolveTeam(team_name);
    const team = safeLoadTeam(tn);
    const result = await forceShutdown(tn, team.leadSessionId, teammate_name);
    return json(result);
  }
);

// ════════════════════════════════════════
// TASK MANAGEMENT
// ════════════════════════════════════════

server.tool(
  'add_task',
  'Add a task to the team backlog.',
  {
    id: SafeId.describe('Unique task ID (e.g. "auth-module", "fix-bug-123")'),
    title: z.string().describe('Task title/description'),
    complexity: z.enum(['S', 'M', 'L', 'XL']).optional().describe('Task complexity (default: M)'),
    depends_on: z.array(SafeId).optional().describe('IDs of tasks this depends on'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ id, title, complexity, depends_on, team_name }) => {
    if (isTeammate()) {
      return text('Error: This operation is restricted to the Team Lead.');
    }
    const tn = resolveTeam(team_name);
    const task = await createTask(tn, { id, title, description: title, complexity: complexity ?? 'M', dependencies: depends_on ?? [] });
    return json(task);
  }
);

server.tool(
  'add_tasks',
  'Add multiple tasks to the backlog in a single batch operation. Much faster than calling add_task repeatedly — use this when creating 3+ tasks.',
  {
    tasks: z.array(z.object({
      id: SafeId.describe('Unique task ID'),
      title: z.string().describe('Task title'),
      complexity: z.enum(['S', 'M', 'L', 'XL']).optional().describe('Complexity (default: M)'),
      depends_on: z.array(SafeId).optional().describe('Dependency task IDs'),
    })).describe('Array of tasks to create'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ tasks: taskInputs, team_name }) => {
    if (isTeammate()) {
      return text('Error: This operation is restricted to the Team Lead.');
    }
    const tn = resolveTeam(team_name);
    const created = await createTasksBatch(tn, taskInputs.map(t => ({
      id: t.id,
      title: t.title,
      description: t.title,
      complexity: t.complexity ?? 'M',
      dependencies: t.depends_on ?? [],
    })));
    return json({ created: created.length, tasks: created });
  }
);

server.tool(
  'list_tasks',
  'List all tasks in the backlog, optionally filtered by status.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
    status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('Filter by status'),
  },
  async ({ team_name, status }) => {
    const tn = resolveTeam(team_name);
    let tasks = readTaskList(tn);
    if (status) tasks = tasks.filter(t => t.status === status);
    if (tasks.length === 0) return text('No tasks in backlog.');
    return json(tasks);
  }
);

server.tool(
  'update_task',
  'Update a task (change status, title, complexity, etc.).',
  {
    task_id: SafeId.describe('Task ID to update'),
    status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('New status'),
    title: z.string().optional().describe('New title'),
    complexity: z.enum(['S', 'M', 'L', 'XL']).optional().describe('New complexity'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ task_id, status, title, complexity, team_name }) => {
    const tn = resolveTeam(team_name);
    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (title) updates.title = title;
    if (complexity) updates.complexity = complexity;
    const task = await updateTask(tn, task_id, updates);
    return json(task);
  }
);

server.tool(
  'assign_task',
  'Assign a task to a specific teammate.',
  {
    task_id: SafeId.describe('Task ID to assign'),
    teammate_name: SafeId.describe('Teammate to assign the task to'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ task_id, teammate_name, team_name }) => {
    if (isTeammate()) {
      return text('Error: This operation is restricted to the Team Lead.');
    }
    const tn = resolveTeam(team_name);
    const task = await assignTask(tn, task_id, teammate_name);
    // Audit: log the assignment as a message from lead to teammate
    const team = safeLoadTeam(tn);
    await sendMessage(tn, team.leadSessionId, teammate_name,
      `[ASSIGNED] Task "${task_id}" (${task.title}) assigned to you.`);
    return json(task);
  }
);

server.tool(
  'delete_task',
  'Remove a task from the backlog.',
  {
    task_id: SafeId.describe('Task ID to delete'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ task_id, team_name }) => {
    if (isTeammate()) {
      return text('Error: This operation is restricted to the Team Lead.');
    }
    const tn = resolveTeam(team_name);
    await deleteTask(tn, task_id);
    return text(`Task "${task_id}" deleted.`);
  }
);

// ════════════════════════════════════════
// SPRINT MANAGEMENT
// ════════════════════════════════════════

server.tool(
  'start_sprint',
  'Start a new sprint with selected tasks from the backlog.',
  {
    sprint_number: z.number().describe('Sprint number (e.g. 1, 2, 3)'),
    task_ids: z.array(SafeId).describe('Task IDs to include in the sprint'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ sprint_number, task_ids, team_name }) => {
    if (isTeammate()) {
      return text('Error: This operation is restricted to the Team Lead.');
    }
    const tn = resolveTeam(team_name);
    const sprint = await startSprint(tn, sprint_number, task_ids);
    return json(sprint);
  }
);

server.tool(
  'activate_sprint',
  'Activate a sprint by assigning tasks to teammates.',
  {
    sprint_number: z.number().describe('Sprint number to activate'),
    assignments: z.array(z.object({
      teammate: SafeId.describe('Teammate name'),
      taskId: SafeId.describe('Task ID'),
      taskTitle: z.string().describe('Task title'),
      estimate: z.enum(['S', 'M', 'L', 'XL']).describe('Complexity estimate'),
    })).describe('Task-to-teammate assignments'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ sprint_number, assignments, team_name }) => {
    if (isTeammate()) {
      return text('Error: This operation is restricted to the Team Lead.');
    }
    const tn = resolveTeam(team_name);
    const sprint = await activateSprint(tn, sprint_number, assignments);
    // Audit: notify each teammate of their sprint assignments
    const team = safeLoadTeam(tn);
    const byTeammate = new Map<string, string[]>();
    for (const a of assignments) {
      const list = byTeammate.get(a.teammate) ?? [];
      list.push(`${a.taskId}: ${a.taskTitle} [${a.estimate}]`);
      byTeammate.set(a.teammate, list);
    }
    for (const [teammate, tasks] of byTeammate) {
      await sendMessage(tn, team.leadSessionId, teammate,
        `[SPRINT ${sprint_number} ACTIVATED] Your assignments:\n${tasks.map(t => `- ${t}`).join('\n')}`);
    }
    return json(sprint);
  }
);

server.tool(
  'close_sprint',
  'Close a sprint. Returns any unfinished tasks.',
  {
    sprint_number: z.number().describe('Sprint number to close'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ sprint_number, team_name }) => {
    if (isTeammate()) {
      return text('Error: This operation is restricted to the Team Lead.');
    }
    const tn = resolveTeam(team_name);
    const result = await closeSprint(tn, sprint_number);
    return json(result);
  }
);

server.tool(
  'show_sprint',
  'Show sprint details. If no sprint number given, shows the current/latest sprint.',
  {
    sprint_number: z.number().optional().describe('Sprint number (shows current if omitted)'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ sprint_number, team_name }) => {
    const tn = resolveTeam(team_name);
    const sprint = sprint_number ? getSprint(tn, sprint_number) : getCurrentSprint(tn);
    if (!sprint) return text('No sprint found.');
    return json(sprint);
  }
);

server.tool(
  'list_sprints',
  'List all sprints for the team.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ team_name }) => {
    const tn = resolveTeam(team_name);
    const sprints = readSprints(tn);
    if (sprints.length === 0) return text('No sprints yet.');
    return json(sprints);
  }
);

// ════════════════════════════════════════
// COMMUNICATION
// ════════════════════════════════════════

server.tool(
  'send_message',
  'Send a message to a specific teammate.',
  {
    to: SafeId.describe('Recipient teammate name'),
    body: SafeBody.describe('Message content'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ to, body, team_name }) => {
    const tn = resolveTeam(team_name);
    const team = safeLoadTeam(tn);
    const from = resolveSender(team);
    const msg = await sendMessage(tn, from, to, body);
    return json(msg);
  }
);

server.tool(
  'broadcast_message',
  'Send a message to all teammates at once.',
  {
    body: SafeBody.describe('Message content'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ body, team_name }) => {
    const tn = resolveTeam(team_name);
    const team = safeLoadTeam(tn);
    const from = resolveSender(team);
    const result = await broadcastMessage(tn, from, body, team.members.length);
    return json(result);
  }
);

server.tool(
  'read_messages',
  'Read messages. If recipient_id is given, shows only messages for that recipient.',
  {
    recipient_id: SafeId.optional().describe('Filter messages for this recipient'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ recipient_id, team_name }) => {
    const tn = resolveTeam(team_name);
    const msgs = recipient_id ? readMessages(tn, recipient_id) : readAllMessages(tn);
    if (msgs.length === 0) return text('No messages.');
    return json(msgs);
  }
);

// ════════════════════════════════════════
// STATUS & MONITORING
// ════════════════════════════════════════

server.tool(
  'team_status',
  'Get a full status dashboard: team info, teammates, tasks, current sprint, and file claims.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ team_name }) => {
    const tn = resolveTeam(team_name);
    const team = safeLoadTeam(tn);
    const tasks = readTaskList(tn);
    const statuses = getTeammateStatuses(tn);
    const sprint = getCurrentSprint(tn);
    let claims: Awaited<ReturnType<typeof getActiveFileClaims>> = [];
    try { claims = await getActiveFileClaims(tn); } catch { /* no claims file */ }

    return json({
      team: {
        name: team.teamName,
        lead: team.leadSessionId,
        created: team.createdAt,
      },
      teammates: statuses,
      tasks: {
        total: tasks.length,
        pending: tasks.filter(t => t.status === 'pending').length,
        in_progress: tasks.filter(t => t.status === 'in_progress').length,
        completed: tasks.filter(t => t.status === 'completed').length,
        items: tasks,
      },
      sprint: sprint ?? 'none',
      fileClaims: claims.length > 0 ? claims : 'none',
    });
  }
);

// ════════════════════════════════════════
// PLAN APPROVAL
// ════════════════════════════════════════

server.tool(
  'list_pending_plans',
  'List all plans submitted by teammates that are waiting for your approval.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ team_name }) => {
    const tn = resolveTeam(team_name);
    const plans = await getPendingPlans(tn);
    if (plans.length === 0) return text('No pending plans.');
    return json(plans);
  }
);

server.tool(
  'review_plan',
  'Approve or reject a teammate\'s plan. Provide feedback if rejecting.',
  {
    request_id: SafeId.describe('Plan request ID'),
    decision: z.enum(['approved', 'rejected']).describe('Your decision'),
    feedback: z.string().optional().describe('Feedback (required when rejecting)'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ request_id, decision, feedback, team_name }) => {
    if (isTeammate()) {
      return text('Error: This operation is restricted to the Team Lead.');
    }
    const tn = resolveTeam(team_name);
    const result = await reviewPlan(tn, request_id, decision, feedback);
    // Audit: notify the teammate of the plan decision
    const team = safeLoadTeam(tn);
    const decisionMsg = decision === 'approved'
      ? `[PLAN APPROVED] Your plan (${request_id}) has been approved. Proceed with implementation.`
      : `[PLAN REJECTED] Your plan (${request_id}) was rejected. Feedback: ${feedback ?? 'none'}`;
    await sendMessage(tn, team.leadSessionId, result.teammateName, decisionMsg);
    return json(result);
  }
);

server.tool(
  'submit_plan',
  'Submit a plan for lead approval. The plan describes your implementation approach.',
  {
    teammate_name: SafeId.describe('Your teammate name'),
    task_id: SafeId.describe('Task ID this plan is for'),
    plan: z.string().max(50_000).describe('Your implementation plan'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ teammate_name, task_id, plan, team_name }) => {
    const tn = resolveTeam(team_name);
    const request = await submitPlanForApproval(tn, teammate_name, task_id, plan);
    return json(request);
  }
);

server.tool(
  'enter_plan_mode',
  'Enter plan mode for a task. In plan mode you can explore code but must not modify files.',
  {
    teammate_name: SafeId.describe('Your teammate name'),
    task_id: SafeId.describe('Task ID to plan for'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ teammate_name, task_id, team_name }) => {
    const tn = resolveTeam(team_name);
    const state = await enterPlanMode(tn, teammate_name, task_id);
    return json(state);
  }
);

server.tool(
  'set_approval_criteria',
  'Set criteria the lead uses to evaluate plans.',
  {
    description: z.string().max(5000).describe('Criteria description'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ description, team_name }) => {
    if (isTeammate()) return text('Error: This operation is restricted to the Team Lead.');
    const tn = resolveTeam(team_name);
    await setApprovalCriteria(tn, { description });
    return text('Approval criteria updated.');
  }
);

// ════════════════════════════════════════
// FILE CLAIMS
// ════════════════════════════════════════

server.tool(
  'list_file_claims',
  'List all active file ownership claims across teammates.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ team_name }) => {
    const tn = resolveTeam(team_name);
    const claims = await getActiveFileClaims(tn);
    if (claims.length === 0) return text('No active file claims.');
    return json(claims);
  }
);

server.tool(
  'detect_file_conflicts',
  'Check if multiple teammates have claimed the same files.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ team_name }) => {
    const tn = resolveTeam(team_name);
    const conflicts = await detectFileConflicts(tn);
    if (conflicts.length === 0) return text('No file conflicts detected.');
    return json(conflicts);
  }
);

server.tool(
  'claim_file',
  'Claim ownership of a file before editing it. Prevents conflicts with other teammates.',
  {
    file_path: z.string().min(1).max(500).describe('Path to the file to claim'),
    teammate_name: SafeId.describe('Your teammate name'),
    task_id: SafeId.describe('Task ID you are working on'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ file_path, teammate_name, task_id, team_name }) => {
    const tn = resolveTeam(team_name);
    const claim = await claimFile(tn, teammate_name, task_id, file_path);
    return json(claim);
  }
);

server.tool(
  'release_file',
  'Release ownership of a previously claimed file.',
  {
    file_path: z.string().min(1).max(500).describe('Path to the file to release'),
    teammate_name: SafeId.describe('Your teammate name'),
    task_id: SafeId.describe('Task ID you were working on'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ file_path, teammate_name, task_id, team_name }) => {
    const tn = resolveTeam(team_name);
    const claim = await releaseFile(tn, teammate_name, task_id, file_path);
    return json(claim);
  }
);

// ════════════════════════════════════════
// REPORTS / FINDINGS
// ════════════════════════════════════════

function reportsDir(teamName: string): string {
  return path.join(TEAMS_BASE_DIR, teamName, 'reports');
}

function reportPath(teamName: string, taskId: string, teammateName: string): string {
  return path.join(reportsDir(teamName), `${teammateName}--${taskId}.md`);
}

server.tool(
  'submit_report',
  'Submit a report or findings for a completed task. IMPORTANT: Teammates MUST call this with their detailed findings before finishing a task — this is how the lead retrieves your work.',
  {
    task_id: SafeId.describe('Task ID this report is for'),
    teammate_name: SafeId.describe('Your teammate name'),
    title: z.string().max(200).describe('Report title'),
    body: SafeBody.describe('Full report content — be detailed, include all findings, severity ratings, affected files, and recommendations'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ task_id, teammate_name, title, body, team_name }) => {
    const tn = resolveTeam(team_name);
    const dir = reportsDir(tn);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = reportPath(tn, task_id, teammate_name);
    const content = [
      `# ${title}`,
      '',
      `**Teammate:** ${teammate_name}`,
      `**Task:** ${task_id}`,
      `**Submitted:** ${new Date().toISOString()}`,
      '',
      '---',
      '',
      body,
    ].join('\n');
    fs.writeFileSync(filePath, content, 'utf-8');
    // Also log an audit message
    const team = safeLoadTeam(tn);
    await sendMessage(tn, teammate_name, 'lead',
      `[REPORT SUBMITTED] Report for task "${task_id}": ${title}`);
    return text(`Report saved for task "${task_id}" by ${teammate_name}.`);
  }
);

server.tool(
  'get_report',
  'Retrieve a specific teammate\'s report for a task.',
  {
    task_id: SafeId.describe('Task ID'),
    teammate_name: SafeId.describe('Teammate who submitted the report'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ task_id, teammate_name, team_name }) => {
    const tn = resolveTeam(team_name);
    const filePath = reportPath(tn, task_id, teammate_name);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return text(content);
    } catch {
      return text(`No report found for task "${task_id}" by ${teammate_name}.`);
    }
  }
);

server.tool(
  'get_all_reports',
  'Retrieve all reports submitted by all teammates. Use this to get a consolidated view of all findings.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
    teammate_name: SafeId.optional().describe('Filter to a specific teammate'),
  },
  async ({ team_name, teammate_name }) => {
    const tn = resolveTeam(team_name);
    const dir = reportsDir(tn);
    if (!fs.existsSync(dir)) return text('No reports submitted yet.');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    if (files.length === 0) return text('No reports submitted yet.');

    const reports: Array<{ teammate: string; taskId: string; content: string }> = [];
    for (const file of files) {
      const [tmName, taskId] = file.replace('.md', '').split('--');
      if (teammate_name && tmName !== teammate_name) continue;
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      reports.push({ teammate: tmName, taskId, content });
    }

    if (reports.length === 0) return text(`No reports found${teammate_name ? ` for ${teammate_name}` : ''}.`);
    // Return concatenated reports
    const combined = reports.map(r =>
      `\n${'='.repeat(60)}\n${r.content}`
    ).join('\n');
    return text(combined);
  }
);

// ════════════════════════════════════════
// AUTO-ORCHESTRATION
// ════════════════════════════════════════

import { spawnReplacement, buildRespawnContext } from './utils/resilience.js';
import { getProcess, getAllProcesses } from './teammate/index.js';

const respawnCounts = new Map<string, number>();
const MAX_RESPAWNS = 3;

/**
 * Monitor a team and auto-respawn crashed/stopped teammates.
 * Returns when all tasks are completed or max respawns exceeded.
 */
async function monitorAndRespawn(
  teamName: string,
  pollIntervalMs: number = 15000,
  maxWaitMs: number = 600000,
  extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
): Promise<{ completed: boolean; reason: string }> {
  const startTime = Date.now();
  const team = safeLoadTeam(teamName);
  let pollCount = 0;

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    pollCount++;

    // Send progress notification to prevent MCP client timeout
    const progressToken = extra?._meta?.progressToken;
    if (progressToken != null && extra?.sendNotification) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      try {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: elapsed,
            total: Math.round(maxWaitMs / 1000),
            message: `Monitoring teammates (${elapsed}s elapsed)`,
          },
        } as ServerNotification);
      } catch { /* progress notifications are best-effort */ }
    }

    // Check task completion
    const tasks = readTaskList(teamName);
    const incomplete = tasks.filter(t => t.status !== 'completed');
    if (incomplete.length === 0) {
      return { completed: true, reason: 'All tasks completed.' };
    }

    // Check for stopped/crashed teammates with incomplete tasks
    const currentTeam = safeLoadTeam(teamName);
    for (const member of currentTeam.members) {
      if (member.status !== 'stopped' && member.status !== 'crashed') continue;

      const assignedTasks = tasks.filter(t => t.assignee === member.name && t.status !== 'completed');
      if (assignedTasks.length === 0) continue;

      // Check respawn count
      const key = `${teamName}:${member.name}`;
      const count = respawnCounts.get(key) ?? 0;
      if (count >= MAX_RESPAWNS) {
        await sendMessage(teamName, 'system', 'lead',
          `[RESPAWN LIMIT] ${member.name} has been respawned ${MAX_RESPAWNS} times. Skipping.`);
        continue;
      }

      // Auto-respawn with context
      try {
        const taskList = assignedTasks.map(t => `- ${t.id}: ${t.title} [${t.status}]`).join('\n');
        await spawnReplacement(teamName, currentTeam.leadSessionId, member.name, {
          spawnPrompt: `Complete these remaining tasks:\n${taskList}`,
        });
        respawnCounts.set(key, count + 1);
        await sendMessage(teamName, 'system', 'lead',
          `[AUTO-RESPAWN] ${member.name} respawned (attempt ${count + 1}/${MAX_RESPAWNS}). ` +
          `Remaining tasks: ${assignedTasks.map(t => t.id).join(', ')}`);
      } catch (err) {
        await sendMessage(teamName, 'system', 'lead',
          `[RESPAWN FAILED] Could not respawn ${member.name}: ${err}`);
      }
    }
  }

  return { completed: false, reason: `Timed out after ${maxWaitMs / 1000}s.` };
}

server.tool(
  'run_team',
  `Orchestrate a complete team workflow end-to-end: create tasks, spawn teammates, run a sprint, monitor progress, auto-respawn crashed teammates, and collect reports. This is the easiest way to run a parallel team — one tool call does everything.`,
  {
    tasks: z.array(z.object({
      id: SafeId.describe('Unique task ID'),
      title: z.string().describe('Task title'),
      complexity: z.enum(['S', 'M', 'L', 'XL']).optional().describe('Complexity (default: M)'),
    })).describe('Tasks to complete'),
    teammates: z.array(z.object({
      name: SafeId.describe('Teammate name'),
      prompt: z.string().max(100_000).describe('Task instructions for this teammate'),
      agent_type: z.enum(['coder', 'reviewer', 'tester']).optional().describe('Agent type (default: coder)'),
      task_ids: z.array(SafeId).describe('Task IDs assigned to this teammate'),
    })).describe('Teammates to spawn with their task assignments'),
    team_name: SafeTeamName.optional().describe('Custom team name (auto-generated if omitted)'),
    session_id: z.string().describe('Your session identifier'),
    // timeout_minutes is in minutes (default: 10)
    timeout_minutes: z.number().optional().describe('Max wait time in minutes (default: 10)'),
  },
  async ({ tasks: taskInputs, teammates, team_name, session_id, timeout_minutes }, extra) => {
    const timeoutMs = (timeout_minutes ?? 10) * 60 * 1000;
    const results: string[] = [];

    // 1. Create team
    const team = await createTeam({ leadSessionId: session_id, teamName: team_name });
    saveLastTeam(team.teamName);
    results.push(`✓ Team created: ${team.teamName}`);

    // 2. Batch create tasks
    const created = await createTasksBatch(team.teamName, taskInputs.map(t => ({
      id: t.id,
      title: t.title,
      description: t.title,
      complexity: t.complexity ?? 'M',
      dependencies: [],
    })));
    results.push(`✓ ${created.length} tasks created`);

    // 3. Start sprint
    const allTaskIds = created.map(t => t.id);
    const sprint = await startSprint(team.teamName, 1, allTaskIds);

    // 4. Spawn teammates and build assignments
    const assignments: Array<{ teammate: string; taskId: string; taskTitle: string; estimate: 'S' | 'M' | 'L' | 'XL' }> = [];
    for (const tm of teammates) {
      await spawnTeammate(team.teamName, session_id, {
        name: tm.name,
        agentType: tm.agent_type ?? 'coder',
        spawnPrompt: tm.prompt,
      });
      // Log spawn
      await sendMessage(team.teamName, session_id, tm.name,
        `[SPAWNED] Role: ${tm.agent_type ?? 'coder'}. Instructions: ${tm.prompt}`);

      for (const taskId of tm.task_ids) {
        const task = created.find(t => t.id === taskId);
        if (task) {
          assignments.push({
            teammate: tm.name,
            taskId: task.id,
            taskTitle: task.title,
            estimate: (task.complexity ?? 'M') as 'S' | 'M' | 'L' | 'XL',
          });
          await assignTask(team.teamName, task.id, tm.name);
        }
      }
      results.push(`✓ Spawned ${tm.name} with ${tm.task_ids.length} tasks`);
    }

    // 5. Activate sprint
    await activateSprint(team.teamName, 1, assignments);
    results.push(`✓ Sprint 1 activated`);

    // 6. Monitor progress with auto-respawn
    results.push(`⏳ Monitoring progress (timeout: ${timeout_minutes ?? 10}min)...`);
    const monitor = await monitorAndRespawn(team.teamName, 15000, timeoutMs, extra);
    results.push(monitor.completed ? `✓ ${monitor.reason}` : `⚠ ${monitor.reason}`);

    // 7. Collect reports
    const dir = reportsDir(team.teamName);
    let reportSummary = 'No reports submitted.';
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
      if (files.length > 0) {
        const reports = files.map(f => {
          const content = fs.readFileSync(path.join(dir, f), 'utf-8');
          return content;
        });
        reportSummary = reports.join('\n\n' + '='.repeat(60) + '\n\n');
        results.push(`✓ ${files.length} reports collected`);
      }
    }

    // 8. Close sprint
    try {
      await closeSprint(team.teamName, 1);
      results.push(`✓ Sprint 1 closed`);
    } catch { /* may already be closed */ }

    return text([
      '## Team Run Complete',
      '',
      results.join('\n'),
      '',
      '## Reports',
      '',
      reportSummary,
    ].join('\n'));
  }
);

// ════════════════════════════════════════
// PLANNING POKER
// ════════════════════════════════════════

server.tool(
  'start_planning_poker',
  'Start a planning poker estimation session for one or more tasks.',
  {
    task_ids: z.array(SafeId).describe('Task IDs to estimate'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ task_ids, team_name }) => {
    if (isTeammate()) return text('Error: This operation is restricted to the Team Lead.');
    const tn = resolveTeam(team_name);
    startPlanningPoker(tn, task_ids);
    return text(`Planning poker started for tasks: ${task_ids.join(', ')}`);
  }
);

server.tool(
  'submit_estimate',
  'Submit your complexity estimate for a task in a planning poker session.',
  {
    task_id: SafeId.describe('Task ID to estimate'),
    teammate_name: SafeId.describe('Your teammate name'),
    estimate: z.enum(['S', 'M', 'L', 'XL']).describe('Your complexity estimate'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ task_id, teammate_name, estimate, team_name }) => {
    const tn = resolveTeam(team_name);
    submitEstimate(tn, task_id, teammate_name, estimate);
    return text(`Estimate submitted: ${estimate} for task ${task_id}`);
  }
);

server.tool(
  'resolve_estimates',
  'Resolve planning poker estimates for a task. Picks the mode; ties go to higher size.',
  {
    task_id: SafeId.describe('Task ID to resolve'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ task_id, team_name }) => {
    if (isTeammate()) return text('Error: This operation is restricted to the Team Lead.');
    const tn = resolveTeam(team_name);
    const resolved = await resolveEstimates(tn, task_id);
    return text(`Estimates resolved for ${task_id}: ${resolved}`);
  }
);

server.tool(
  'balance_assignments',
  'Balance task assignments across teammates by weight to respect capacity limits.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ team_name }) => {
    if (isTeammate()) return text('Error: This operation is restricted to the Team Lead.');
    const tn = resolveTeam(team_name);
    const tasks = readTaskList(tn).filter(t => t.status === 'pending' && t.complexity);
    const statuses = getTeammateStatuses(tn);
    const activeTeammates = statuses.filter(s => s.status === 'active').map(s => s.name);
    if (activeTeammates.length === 0) return text('No active teammates to assign to.');
    const assignments = balanceAssignments(tasks, activeTeammates);
    return json(assignments);
  }
);

// ════════════════════════════════════════
// PERMISSION MANAGEMENT
// ════════════════════════════════════════

server.tool(
  'request_permission',
  'Request permission for a privileged operation. Blocks until the Lead responds.',
  {
    teammate_name: SafeId.describe('Requesting teammate name'),
    operation: z.string().min(1).max(100).describe('Operation name (e.g. "write_file", "delete_task")'),
    description: z.string().max(500).describe('Description of what you want to do'),
    target_resource: z.string().max(200).describe('Target resource path or identifier'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ teammate_name, operation, description, target_resource, team_name }) => {
    const tn = resolveTeam(team_name);
    const response = await requestPermission(tn, teammate_name, operation, description, target_resource);
    return json(response);
  }
);

server.tool(
  'review_permission',
  'Approve or deny a pending permission request from a teammate.',
  {
    request_id: SafeId.describe('Permission request ID'),
    decision: z.enum(['approved', 'denied']).describe('Your decision'),
    rationale: z.string().max(500).optional().describe('Reason for your decision'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ request_id, decision, rationale, team_name }) => {
    if (isTeammate()) return text('Error: This operation is restricted to the Team Lead.');
    const tn = resolveTeam(team_name);
    const response = await reviewPermission(tn, request_id, decision, rationale);
    return json(response);
  }
);

server.tool(
  'read_audit_log',
  'Read the permission audit log showing all permission decisions.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ team_name }) => {
    if (isTeammate()) return text('Error: This operation is restricted to the Team Lead.');
    const tn = resolveTeam(team_name);
    const entries = readAuditLog(tn);
    if (entries.length === 0) return text('No audit log entries.');
    return json(entries);
  }
);

server.tool(
  'list_pending_permissions',
  'List all pending permission requests awaiting review.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ team_name }) => {
    if (isTeammate()) return text('Error: This operation is restricted to the Team Lead.');
    const tn = resolveTeam(team_name);
    const pending = loadPendingRequests(tn);
    if (pending.length === 0) return text('No pending permission requests.');
    return json(pending);
  }
);

// ════════════════════════════════════════
// HOOK CONFIGURATION
// ════════════════════════════════════════

server.tool(
  'list_hooks',
  'List all configured lifecycle hooks for the team.',
  {
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ team_name }) => {
    const tn = resolveTeam(team_name);
    const hooks = await loadHooks(tn);
    if (hooks.length === 0) return text('No hooks configured.');
    return json(hooks);
  }
);

server.tool(
  'save_hooks',
  'Save hook configurations for the team. Hooks run at lifecycle events (TeammateIdle, TaskCompleted).',
  {
    hooks: z.array(z.object({
      event: z.enum(['TeammateIdle', 'TaskCompleted']).describe('Lifecycle event'),
      command: z.string().min(1).max(500).describe('Command to run'),
      workingDir: z.string().optional().describe('Working directory'),
    })).describe('Hook configurations'),
    team_name: SafeTeamName.optional().describe('Team name (auto-detected)'),
  },
  async ({ hooks, team_name }) => {
    if (isTeammate()) return text('Error: This operation is restricted to the Team Lead.');
    const tn = resolveTeam(team_name);
    await saveHooks(tn, hooks);
    return text(`${hooks.length} hooks saved.`);
  }
);

// ── Start server ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
