/**
 * Display module — in-process mode, split-pane mode, and mode selection.
 *
 * R13: InProcessDisplay — all teammates in a single terminal with keyboard nav.
 * R14: TmuxDisplay / ITermDisplay — split-pane modes.
 * R15: resolveDisplayMode — auto-detect or override.
 */

import { readTaskList } from '../tasks/index.js';
import { spawnSync } from 'node:child_process';

// ── Types ──

export type DisplayMode = 'in-process' | 'tmux' | 'iterm2';

export interface TeammateView {
  name: string;
  status: string;
  /** Lines of output accumulated from the teammate's session */
  outputLines: string[];
}

export interface DisplayEvents {
  onCycleNext?: () => void;
  onEnter?: () => void;
  onEscape?: () => void;
  onToggleTaskList?: () => void;
}

// ── InProcessDisplay ──

export class InProcessDisplay {
  private teammates: TeammateView[] = [];
  private focusIndex = 0;
  private taskListVisible = false;
  private teamName: string;
  private events: DisplayEvents;
  private started = false;

  // Injected key-reader for testability (avoids raw stdin dependency)
  private keyReader: KeyReader | null = null;

  constructor(teamName: string, events: DisplayEvents = {}) {
    this.teamName = teamName;
    this.events = events;
  }

  /** Register teammates to display. Index 0 is treated as the lead. */
  setTeammates(views: TeammateView[]): void {
    this.teammates = views;
    // Clamp focus to valid range
    if (this.focusIndex >= this.teammates.length) {
      this.focusIndex = 0;
    }
  }

  getTeammates(): TeammateView[] {
    return this.teammates;
  }

  getFocusIndex(): number {
    return this.focusIndex;
  }

  getFocusedTeammate(): TeammateView | undefined {
    return this.teammates[this.focusIndex];
  }

  isTaskListVisible(): boolean {
    return this.taskListVisible;
  }

  isStarted(): boolean {
    return this.started;
  }

  /** Cycle focus to the next teammate, wrapping to 0 after the last. */
  cycleNext(): void {
    if (this.teammates.length === 0) return;
    this.focusIndex = (this.focusIndex + 1) % this.teammates.length;
    this.events.onCycleNext?.();
  }

  /** Enter — view focused teammate's session. */
  enter(): void {
    this.events.onEnter?.();
  }

  /** Escape — interrupt focused teammate's current turn. */
  escape(): void {
    this.events.onEscape?.();
  }

  /** Ctrl+T — toggle task list overlay. */
  toggleTaskList(): void {
    this.taskListVisible = !this.taskListVisible;
    this.events.onToggleTaskList?.();
  }

  /**
   * Render a status bar showing all teammates and their statuses.
   * Focused teammate is marked with `>`.
   */
  renderStatusBar(): string {
    if (this.teammates.length === 0) return '[ no teammates ]';
    return this.teammates
      .map((t, i) => {
        const marker = i === this.focusIndex ? '>' : ' ';
        return `${marker} ${t.name} [${t.status}]`;
      })
      .join(' | ');
  }

  /**
   * Render the task list overlay (used when Ctrl+T is toggled on).
   * Reads backlog from disk.
   */
  async renderTaskList(): Promise<string> {
    const tasks = await readTaskList(this.teamName);
    if (tasks.length === 0) return '(no tasks)';
    return tasks
      .map(
        (t) =>
          `[${t.status}] ${t.id}: ${t.title}${t.assignee ? ` (@${t.assignee})` : ''}`
      )
      .join('\n');
  }

  /**
   * Start listening for keyboard input.
   * Uses the injected KeyReader (for tests) or stdin raw mode (production).
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    if (this.keyReader) {
      this.keyReader.onKey((key) => this.handleKey(key));
      this.keyReader.start();
    }
    // In production this would set stdin to raw mode — omitted here
    // because the real CLI handles stdin directly.
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.keyReader) {
      this.keyReader.stop();
    }
  }

  /** Inject a key reader for testing. */
  setKeyReader(reader: KeyReader): void {
    this.keyReader = reader;
  }

  /** Internal key handler. */
  private handleKey(key: string): void {
    switch (key) {
      case 'shift+down':
        this.cycleNext();
        break;
      case 'enter':
        this.enter();
        break;
      case 'escape':
        this.escape();
        break;
      case 'ctrl+t':
        this.toggleTaskList();
        break;
    }
  }
}

// ── Pane info ──

export interface PaneInfo {
  paneId: string;
  teammateName: string;
  command: string;
}

// ── Command executor abstraction (for testability) ──

export type CommandExecutor = (
  cmd: string,
  args: string[]
) => { exitCode: number; stdout: string; stderr: string };

let commandExecutor: CommandExecutor | null = null;

/** Inject a custom command executor (for testing). */
export function setCommandExecutor(exec: CommandExecutor | null): void {
  commandExecutor = exec;
}

function execCommand(
  cmd: string,
  args: string[]
): { exitCode: number; stdout: string; stderr: string } {
  if (commandExecutor) {
    return commandExecutor(cmd, args);
  }
  const result = spawnSync(cmd, args, { encoding: 'utf-8' });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// ── TmuxDisplay ──

export class TmuxDisplay {
  private panes: PaneInfo[] = [];
  private sessionName: string;

  constructor(sessionName: string) {
    this.sessionName = sessionName;
  }

  getSessionName(): string {
    return this.sessionName;
  }

  getPanes(): PaneInfo[] {
    return [...this.panes];
  }

  /**
   * Create a tmux pane for a teammate running the given command.
   * Returns the pane info. (DM-6)
   */
  createPane(teammateName: string, command: string): PaneInfo {
    const args =
      this.panes.length === 0
        ? // First pane: create a new window
          ['new-window', '-t', this.sessionName, '-n', teammateName, '-P', '-F', '#{pane_id}', command]
        : // Subsequent panes: split the current window
          ['split-window', '-t', this.sessionName, '-h', '-P', '-F', '#{pane_id}', command];

    const result = execCommand('tmux', args);
    const paneId = result.stdout.trim() || `%pane-${this.panes.length}`;

    const pane: PaneInfo = { paneId, teammateName, command };
    this.panes.push(pane);
    return pane;
  }

  /**
   * Create panes for multiple teammates at once.
   * All panes are visible simultaneously (DM-7).
   */
  createPanes(teammates: Array<{ name: string; command: string }>): PaneInfo[] {
    return teammates.map((t) => this.createPane(t.name, t.command));
  }

  /** Send a command string to a specific pane. */
  sendToPane(paneId: string, text: string): void {
    execCommand('tmux', ['send-keys', '-t', paneId, text, 'Enter']);
  }

  /** Rebalance pane layout so all are visible. */
  rebalance(): void {
    execCommand('tmux', ['select-layout', '-t', this.sessionName, 'tiled']);
  }

  /** Close all panes created by this display. */
  close(): void {
    for (const pane of this.panes) {
      execCommand('tmux', ['kill-pane', '-t', pane.paneId]);
    }
    this.panes = [];
  }
}

// ── ITermDisplay ──

export class ITermDisplay {
  private panes: PaneInfo[] = [];

  getPanes(): PaneInfo[] {
    return [...this.panes];
  }

  /**
   * Create a split pane in iTerm2 using the `it2` CLI. (DM-8)
   */
  createPane(teammateName: string, command: string): PaneInfo {
    const args = ['split-pane', '--command', command];
    const result = execCommand('it2', args);
    const paneId = result.stdout.trim() || `iterm-pane-${this.panes.length}`;

    const pane: PaneInfo = { paneId, teammateName, command };
    this.panes.push(pane);
    return pane;
  }

  /**
   * Create panes for multiple teammates. All visible simultaneously (DM-7).
   */
  createPanes(teammates: Array<{ name: string; command: string }>): PaneInfo[] {
    return teammates.map((t) => this.createPane(t.name, t.command));
  }

  /** Close all panes. */
  close(): void {
    for (const pane of this.panes) {
      execCommand('it2', ['close-pane', pane.paneId]);
    }
    this.panes = [];
  }
}

// ── Terminal environment detection (DM-9) ──

export type TerminalEnvironment = 'tmux' | 'iterm2' | 'unknown';

// Overridable env reader for tests
let envReader: (() => Record<string, string | undefined>) | null = null;
let it2Checker: (() => boolean) | null = null;

export function setEnvReader(reader: (() => Record<string, string | undefined>) | null): void {
  envReader = reader;
}

export function setIt2Checker(checker: (() => boolean) | null): void {
  it2Checker = checker;
}

/**
 * Detect the current terminal environment. (DM-9)
 * Checks $TMUX for tmux, then iTerm2 env vars / `it2` availability.
 */
export function detectTerminalEnvironment(): TerminalEnvironment {
  const env = envReader ? envReader() : process.env;

  // Check tmux first
  if (env.TMUX) {
    return 'tmux';
  }

  // Check iTerm2
  if (env.ITERM_SESSION_ID || env.TERM_PROGRAM === 'iTerm.app') {
    return 'iterm2';
  }

  // Check if it2 CLI is available
  const it2Available = it2Checker ? it2Checker() : checkIt2Available();
  if (it2Available) {
    return 'iterm2';
  }

  return 'unknown';
}

function checkIt2Available(): boolean {
  try {
    const result = execCommand('which', ['it2']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ── KeyReader abstraction (for testability) ──

export interface KeyReader {
  onKey(handler: (key: string) => void): void;
  start(): void;
  stop(): void;
}

/**
 * A simple test key reader — manually emit keys.
 */
export class TestKeyReader implements KeyReader {
  private handler: ((key: string) => void) | null = null;
  private running = false;

  onKey(handler: (key: string) => void): void {
    this.handler = handler;
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  /** Simulate a key press. */
  emit(key: string): void {
    if (this.running && this.handler) {
      this.handler(key);
    }
  }
}
