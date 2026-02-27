/**
 * Lifecycle hooks (R17).
 *
 * Hooks run shell commands at defined lifecycle points:
 * - TeammateIdle: when a teammate is about to go idle (QG-2)
 * - TaskCompleted: when a task is being marked complete (QG-3)
 *
 * Exit code 2 = "veto": prevents the transition and sends stdout as feedback.
 * Any other exit code = allow the transition.
 */

import type { HookConfig, HookEvent } from '../types.js';
import { resolvePath, atomicWriteFile } from '../utils/index.js';
import { HOOKS_FILE } from '../constants.js';
import fs from 'node:fs/promises';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

// ── Types ──

export interface HookContext {
  teamId: string;
  teammateName?: string;
  taskId?: string;
  taskTitle?: string;
  [key: string]: string | undefined;
}

export interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True when the hook vetoed the transition (exit code 2). */
  vetoed: boolean;
  feedback: string | null;
}

// ── Constants ──

const VETO_EXIT_CODE = 2;

// ── Command runner abstraction (for testability) ──

type CommandRunner = (
  command: string,
  env: Record<string, string>,
  cwd?: string
) => { exitCode: number; stdout: string; stderr: string };

let commandRunner: CommandRunner | null = null;

export function setCommandRunner(runner: CommandRunner | null): void {
  commandRunner = runner;
}

function runCommand(
  command: string,
  env: Record<string, string>,
  cwd?: string
): { exitCode: number; stdout: string; stderr: string } {
  if (commandRunner) {
    return commandRunner(command, env, cwd);
  }
  const result: SpawnSyncReturns<string> = spawnSync(command, {
    shell: true,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, ...env },
    cwd,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// ── Hook configuration ──

/**
 * Load hook configurations for a team.
 */
export async function loadHooks(teamId: string): Promise<HookConfig[]> {
  const filePath = resolvePath(teamId, HOOKS_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Save hook configurations for a team (QG-4).
 */
export async function saveHooks(
  teamId: string,
  hooks: HookConfig[]
): Promise<void> {
  const filePath = resolvePath(teamId, HOOKS_FILE);
  await atomicWriteFile(filePath, JSON.stringify(hooks, null, 2));
}

/**
 * Get hooks configured for a specific event.
 */
export async function getHooksForEvent(
  teamId: string,
  event: HookEvent
): Promise<HookConfig[]> {
  const hooks = await loadHooks(teamId);
  return hooks.filter((h) => h.event === event);
}

// ── Hook execution ──

/**
 * Run a single hook. Returns the result including whether it vetoed.
 */
export function runHook(hook: HookConfig, context: HookContext): HookResult {
  // Build env vars from context
  const env: Record<string, string> = {
    HOOK_EVENT: hook.event,
  };
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) {
      env[`HOOK_${key.toUpperCase()}`] = value;
    }
  }

  const result = runCommand(hook.command, env, hook.workingDir);
  const vetoed = result.exitCode === VETO_EXIT_CODE;

  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    vetoed,
    feedback: vetoed ? result.stdout.trim() || null : null,
  };
}

/**
 * Run all hooks for a given event. Returns results in order.
 * If any hook vetoes, the transition should be prevented.
 */
export async function runHooksForEvent(
  teamId: string,
  event: HookEvent,
  context: HookContext
): Promise<HookResult[]> {
  const hooks = await getHooksForEvent(teamId, event);
  return hooks.map((hook) => runHook(hook, context));
}

// ── High-level lifecycle helpers ──

/**
 * TeammateIdle hook (QG-2).
 *
 * Returns { allowIdle: true } if the teammate may go idle.
 * Returns { allowIdle: false, feedback } if a hook vetoed.
 */
export async function onTeammateIdle(
  teamId: string,
  teammateName: string
): Promise<{ allowIdle: boolean; feedback: string | null }> {
  const results = await runHooksForEvent(teamId, 'TeammateIdle', {
    teamId,
    teammateName,
  });

  const veto = results.find((r) => r.vetoed);
  if (veto) {
    return { allowIdle: false, feedback: veto.feedback };
  }
  return { allowIdle: true, feedback: null };
}

/**
 * TaskCompleted hook (QG-3).
 *
 * Returns { allowCompletion: true } if the task may be completed.
 * Returns { allowCompletion: false, feedback } if a hook vetoed.
 */
export async function onTaskCompleted(
  teamId: string,
  taskId: string,
  taskTitle: string,
  teammateName?: string
): Promise<{ allowCompletion: boolean; feedback: string | null }> {
  const results = await runHooksForEvent(teamId, 'TaskCompleted', {
    teamId,
    taskId,
    taskTitle,
    teammateName,
  });

  const veto = results.find((r) => r.vetoed);
  if (veto) {
    return { allowCompletion: false, feedback: veto.feedback };
  }
  return { allowCompletion: true, feedback: null };
}
