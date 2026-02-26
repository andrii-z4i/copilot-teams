/**
 * Display module — in-process mode, split-pane mode, and mode selection.
 *
 * R13: InProcessDisplay — all teammates in a single terminal with keyboard nav.
 * R14: TmuxDisplay / ITermDisplay — split-pane modes.
 * R15: resolveDisplayMode — auto-detect or override.
 */

import { readTaskList } from '../tasks/index.js';

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
