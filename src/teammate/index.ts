/**
 * Teammate management — spawning, status tracking, and process lifecycle.
 *
 * Each teammate is a child process of the Lead, enabling crash detection,
 * forced termination, and PID tracking.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { updateTeam, loadTeam } from '../team/index.js';
import type { TeamConfig, TeamMember, MemberStatus } from '../types.js';

// ── Types ──

export interface SpawnOptions {
  name: string;
  model?: string;
  spawnPrompt: string;
  agentType?: string;
}

export interface TeammateStatus {
  name: string;
  status: MemberStatus;
  pid?: number;
  model?: string;
  currentTask?: string;
}

export interface TeammateProcess {
  name: string;
  process: ChildProcess;
  pid: number;
  teamName: string;
}

// ── Process Registry ──

const activeProcesses = new Map<string, TeammateProcess>();

function processKey(teamName: string, name: string): string {
  return `${teamName}:${name}`;
}

/**
 * Register a teammate process in the in-memory registry.
 */
function registerProcess(proc: TeammateProcess): void {
  activeProcesses.set(processKey(proc.teamName, proc.name), proc);
}

/**
 * Unregister a teammate process.
 */
function unregisterProcess(teamName: string, name: string): void {
  activeProcesses.delete(processKey(teamName, name));
}

/**
 * Get a registered teammate process.
 */
export function getProcess(teamName: string, name: string): TeammateProcess | undefined {
  return activeProcesses.get(processKey(teamName, name));
}

/**
 * Get all registered processes for a team.
 */
export function getAllProcesses(teamName: string): TeammateProcess[] {
  const result: TeammateProcess[] = [];
  for (const [key, proc] of activeProcesses) {
    if (key.startsWith(`${teamName}:`)) {
      result.push(proc);
    }
  }
  return result;
}

/**
 * Clear all processes (for testing).
 */
export function clearProcesses(): void {
  activeProcesses.clear();
}

// ── Spawn Command Builder ──

/**
 * Build the command and args for spawning a teammate process.
 * Can be overridden for testing via `setSpawnCommandBuilder`.
 */
export type SpawnCommandBuilder = (
  teamName: string,
  options: SpawnOptions,
  teamConfig: TeamConfig,
) => { command: string; args: string[]; env?: Record<string, string> };

let spawnCommandBuilder: SpawnCommandBuilder = defaultSpawnCommandBuilder;

function defaultSpawnCommandBuilder(
  teamName: string,
  options: SpawnOptions,
  _teamConfig: TeamConfig,
): { command: string; args: string[]; env?: Record<string, string> } {
  // Build teammate context that gets prepended to the user's prompt
  const teammateContext = [
    `You are teammate "${options.name}" on team "${teamName}".`,
    `Role: ${options.agentType ?? 'coder'}.`,
    '',
    'TEAM COMMUNICATION (use copilot-teams MCP tools):',
    `- Use send_message to report progress or ask questions (to: "lead", team_name: "${teamName}")`,
    `- Use update_task to mark tasks in_progress or completed (team_name: "${teamName}")`,
    `- Use list_tasks to see your assigned tasks (team_name: "${teamName}")`,
    `- Use claim_file before editing files to avoid conflicts (team_name: "${teamName}")`,
    '',
    'When you finish your work, send a message to "lead" summarizing what you did.',
    '',
    'YOUR TASK:',
  ].join('\n');

  const fullPrompt = `${teammateContext}\n${options.spawnPrompt}`;

  const args: string[] = [
    '-p', fullPrompt,
    '--autopilot',
    '--allow-all',
  ];

  if (options.model) {
    args.push('--model', options.model);
  }

  return {
    command: 'copilot',
    args,
    env: {
      COPILOT_TEAMS_TEAMMATE: '1',
      COPILOT_TEAMS_TEAM_NAME: teamName,
      COPILOT_TEAMS_TEAMMATE_NAME: options.name,
    },
  };
}

/**
 * Override the spawn command builder (useful for testing).
 */
export function setSpawnCommandBuilder(builder: SpawnCommandBuilder): void {
  spawnCommandBuilder = builder;
}

/**
 * Reset to default spawn command builder.
 */
export function resetSpawnCommandBuilder(): void {
  spawnCommandBuilder = defaultSpawnCommandBuilder;
}

// ── Spawn Implementation ──

async function updateMemberStatus(
  teamName: string,
  leadSessionId: string,
  memberName: string,
  status: MemberStatus,
  pid?: number,
): Promise<void> {
  await updateTeam(teamName, leadSessionId, (config) => ({
    ...config,
    members: config.members.map((m) =>
      m.name === memberName ? { ...m, status, ...(pid !== undefined ? { pid } : {}) } : m,
    ),
  }));
}

/**
 * Spawn a single teammate as a child process (TM-1, TM-3, TM-4, TM-5).
 */
export async function spawnTeammate(
  teamName: string,
  leadSessionId: string,
  options: SpawnOptions,
): Promise<TeammateProcess> {
  const teamConfig = loadTeam(teamName);

  // Ensure the member is registered in team config
  const existingMember = teamConfig.members.find((m) => m.name === options.name);
  if (!existingMember) {
    await updateTeam(teamName, leadSessionId, (config) => ({
      ...config,
      members: [
        ...config.members,
        {
          name: options.name,
          agentId: `agent-${options.name}-${Date.now()}`,
          agentType: options.agentType ?? 'teammate',
          status: 'spawning' as const,
          model: options.model,
        },
      ],
    }));
  } else {
    await updateMemberStatus(teamName, leadSessionId, options.name, 'spawning');
  }

  // Build spawn command
  const { command, args, env: extraEnv } = spawnCommandBuilder(
    teamName,
    options,
    loadTeam(teamName),
  );

  // Spawn child process (TM-4: same cwd/project context)
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  // Handle spawn errors (e.g., command not found) gracefully
  child.on('error', async (err) => {
    unregisterProcess(teamName, options.name);
    try {
      await updateMemberStatus(teamName, leadSessionId, options.name, 'crashed');
    } catch {
      // Team may have been cleaned up
    }
  });

  const pid = child.pid!;

  const teammateProc: TeammateProcess = {
    name: options.name,
    process: child,
    pid,
    teamName,
  };

  registerProcess(teammateProc);

  // Update status to active with PID
  await updateMemberStatus(teamName, leadSessionId, options.name, 'active', pid);

  // Monitor process exit for crash detection
  child.on('exit', async (code, signal) => {
    // If process was already unregistered (e.g., by forceShutdown), skip
    if (!getProcess(teamName, options.name)) return;
    unregisterProcess(teamName, options.name);
    const newStatus: MemberStatus = code === 0 || signal === 'SIGTERM' ? 'stopped' : 'crashed';
    try {
      await updateMemberStatus(teamName, leadSessionId, options.name, newStatus);
    } catch {
      // Team may have been cleaned up
    }
  });

  return teammateProc;
}

/**
 * Spawn multiple teammates in parallel (TM-2).
 */
export async function spawnMultipleTeammates(
  teamName: string,
  leadSessionId: string,
  specs: SpawnOptions[],
): Promise<TeammateProcess[]> {
  const results = await Promise.all(
    specs.map((spec) => spawnTeammate(teamName, leadSessionId, spec)),
  );
  return results;
}

// ── Status Queries ──

/**
 * Get status of all teammates (TM-6).
 */
export function getTeammateStatuses(teamName: string): TeammateStatus[] {
  const config = loadTeam(teamName);
  return config.members.map((m) => ({
    name: m.name,
    status: m.status,
    pid: m.pid,
    model: m.model,
  }));
}

/**
 * Format teammate list for terminal display (TM-6).
 */
export function formatTeammateList(statuses: TeammateStatus[]): string {
  if (statuses.length === 0) return 'No teammates.';

  const lines = statuses.map((s) => {
    const pidStr = s.pid ? ` (PID: ${s.pid})` : '';
    const modelStr = s.model ? ` [${s.model}]` : '';
    const taskStr = s.currentTask ? ` → ${s.currentTask}` : '';
    return `  ${statusIcon(s.status)} ${s.name}${modelStr}${pidStr}${taskStr}`;
  });

  return `Teammates (${statuses.length}):\n${lines.join('\n')}`;
}

function statusIcon(status: MemberStatus): string {
  switch (status) {
    case 'spawning':
      return '⏳';
    case 'active':
      return '🟢';
    case 'idle':
      return '💤';
    case 'stopped':
      return '⏹️';
    case 'crashed':
      return '💥';
    default:
      return '❓';
  }
}

// ── Shutdown ──

/** Default timeout (ms) before force-killing an unresponsive teammate. */
const DEFAULT_SHUTDOWN_TIMEOUT = 10_000;

export type ShutdownDecision = 'approve' | 'reject';

export interface ShutdownResponse {
  decision: ShutdownDecision;
  reason?: string;
}

export interface ShutdownResult {
  success: boolean;
  teammateName: string;
  method: 'graceful' | 'forced' | 'rejected';
  reason?: string;
}

/** Teammate-side handler: decides whether to accept or reject shutdown. */
export type ShutdownHandler = (teammateName: string) => ShutdownResponse | Promise<ShutdownResponse>;

const shutdownHandlers = new Map<string, ShutdownHandler>();

/**
 * Register a shutdown handler for a teammate (teammate-side).
 * Called when the Lead requests shutdown (TM-20).
 */
export function registerShutdownHandler(
  teamName: string,
  teammateName: string,
  handler: ShutdownHandler,
): void {
  shutdownHandlers.set(processKey(teamName, teammateName), handler);
}

/**
 * Unregister a shutdown handler.
 */
export function unregisterShutdownHandler(teamName: string, teammateName: string): void {
  shutdownHandlers.delete(processKey(teamName, teammateName));
}

/**
 * Request graceful shutdown of a teammate (TM-18, TM-19).
 *
 * 1. Sends shutdown request to teammate via handler.
 * 2. Teammate can approve (graceful exit) or reject (with explanation) (TM-20).
 * 3. If approved, waits for current operation to finish (TM-21).
 * 4. Updates team config status to "stopped".
 */
export async function requestShutdown(
  teamName: string,
  leadSessionId: string,
  teammateName: string,
  timeoutMs: number = DEFAULT_SHUTDOWN_TIMEOUT,
): Promise<ShutdownResult> {
  const proc = getProcess(teamName, teammateName);

  // Invoke teammate-side handler if registered (TM-20)
  const handlerKey = processKey(teamName, teammateName);
  const handler = shutdownHandlers.get(handlerKey);

  if (handler) {
    const response = await handler(teammateName);

    if (response.decision === 'reject') {
      return {
        success: false,
        teammateName,
        method: 'rejected',
        reason: response.reason ?? 'Teammate rejected shutdown request.',
      };
    }
  }

  // Proceed with graceful shutdown
  if (proc) {
    // Send SIGTERM and wait for process to exit (TM-21)
    const exited = await waitForExit(proc, timeoutMs);

    if (!exited) {
      // Timeout — force kill
      return forceShutdown(teamName, leadSessionId, teammateName);
    }

    unregisterProcess(teamName, teammateName);
  }

  // Update team config
  await updateMemberStatus(teamName, leadSessionId, teammateName, 'stopped');
  shutdownHandlers.delete(handlerKey);

  return { success: true, teammateName, method: 'graceful' };
}

/**
 * Wait for a process to exit within a timeout.
 * Sends SIGTERM and waits.
 */
function waitForExit(proc: TeammateProcess, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }, timeoutMs);

    proc.process.on('exit', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(true);
      }
    });

    // Send SIGTERM for graceful exit
    try {
      proc.process.kill('SIGTERM');
    } catch {
      // Process may already be dead
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(true);
      }
    }
  });
}

/**
 * Force-kill a teammate process (fallback for unresponsive teammates).
 */
export async function forceShutdown(
  teamName: string,
  leadSessionId: string,
  teammateName: string,
): Promise<ShutdownResult> {
  const proc = getProcess(teamName, teammateName);

  if (proc) {
    try {
      proc.process.kill('SIGKILL');
    } catch {
      // Already dead
    }
    unregisterProcess(teamName, teammateName);
  }

  await updateMemberStatus(teamName, leadSessionId, teammateName, 'stopped');
  shutdownHandlers.delete(processKey(teamName, teammateName));

  return { success: true, teammateName, method: 'forced' };
}
