import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  InProcessDisplay,
  TestKeyReader,
  type TeammateView,
} from '../../src/display/index.js';
import * as constants from '../../src/constants.js';
import { createTempDir, cleanupTempDir } from '../helpers.js';
import { createTask } from '../../src/tasks/index.js';
import { createTeam } from '../../src/team/index.js';

let tmpBase: string;
let teamName: string;

beforeEach(async () => {
  tmpBase = createTempDir();
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: tmpBase,
    writable: true,
    configurable: true,
  });
  teamName = 'display-test';
  await createTeam(teamName, 'lead-session-1');
});

afterEach(() => {
  cleanupTempDir(tmpBase);
});

function makeViews(count: number): TeammateView[] {
  const views: TeammateView[] = [
    { name: 'lead', status: 'active', outputLines: ['line1'] },
  ];
  for (let i = 1; i < count; i++) {
    views.push({
      name: `tm-${i}`,
      status: 'active',
      outputLines: [`output-${i}`],
    });
  }
  return views;
}

describe('InProcessDisplay', () => {
  describe('cycling', () => {
    it('advances focus to next teammate', () => {
      const display = new InProcessDisplay(teamName);
      display.setTeammates(makeViews(3));

      expect(display.getFocusIndex()).toBe(0);
      display.cycleNext();
      expect(display.getFocusIndex()).toBe(1);
      display.cycleNext();
      expect(display.getFocusIndex()).toBe(2);
    });

    it('wraps from last teammate back to lead (index 0)', () => {
      const display = new InProcessDisplay(teamName);
      display.setTeammates(makeViews(3));

      display.cycleNext(); // 0→1
      display.cycleNext(); // 1→2
      display.cycleNext(); // 2→0  (wrap)
      expect(display.getFocusIndex()).toBe(0);
      expect(display.getFocusedTeammate()?.name).toBe('lead');
    });

    it('cycleNext does nothing with no teammates', () => {
      const display = new InProcessDisplay(teamName);
      display.cycleNext();
      expect(display.getFocusIndex()).toBe(0);
    });
  });

  describe('task list toggle', () => {
    it('toggleTaskList shows then hides overlay', () => {
      const display = new InProcessDisplay(teamName);
      expect(display.isTaskListVisible()).toBe(false);

      display.toggleTaskList();
      expect(display.isTaskListVisible()).toBe(true);

      display.toggleTaskList();
      expect(display.isTaskListVisible()).toBe(false);
    });

    it('renderTaskList reads tasks from backlog', async () => {
      const display = new InProcessDisplay(teamName);

      await createTask(teamName, {
        id: 'TASK-1',
        title: 'Do something',
        description: 'Details',
        status: 'pending',
        dependencies: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const rendered = await display.renderTaskList();
      expect(rendered).toContain('TASK-1');
      expect(rendered).toContain('Do something');
      expect(rendered).toContain('[pending]');
    });

    it('renderTaskList shows "(no tasks)" when backlog is empty', async () => {
      const display = new InProcessDisplay(teamName);
      const rendered = await display.renderTaskList();
      expect(rendered).toBe('(no tasks)');
    });
  });

  describe('status bar', () => {
    it('renders teammates with focus marker', () => {
      const display = new InProcessDisplay(teamName);
      display.setTeammates(makeViews(3));

      const bar = display.renderStatusBar();
      expect(bar).toContain('> lead [active]');
      expect(bar).toContain('  tm-1 [active]');
      expect(bar).toContain('  tm-2 [active]');
    });

    it('focus marker moves with cycleNext', () => {
      const display = new InProcessDisplay(teamName);
      display.setTeammates(makeViews(2));
      display.cycleNext();

      const bar = display.renderStatusBar();
      expect(bar).toContain('  lead [active]');
      expect(bar).toContain('> tm-1 [active]');
    });

    it('renders placeholder with no teammates', () => {
      const display = new InProcessDisplay(teamName);
      expect(display.renderStatusBar()).toBe('[ no teammates ]');
    });
  });

  describe('keyboard events via TestKeyReader', () => {
    it('Shift+Down cycles focus', () => {
      const display = new InProcessDisplay(teamName);
      display.setTeammates(makeViews(3));

      const reader = new TestKeyReader();
      display.setKeyReader(reader);
      display.start();

      reader.emit('shift+down');
      expect(display.getFocusIndex()).toBe(1);
      reader.emit('shift+down');
      expect(display.getFocusIndex()).toBe(2);
      reader.emit('shift+down');
      expect(display.getFocusIndex()).toBe(0); // wrap

      display.stop();
    });

    it('Ctrl+T toggles task list', () => {
      const display = new InProcessDisplay(teamName);
      const reader = new TestKeyReader();
      display.setKeyReader(reader);
      display.start();

      reader.emit('ctrl+t');
      expect(display.isTaskListVisible()).toBe(true);
      reader.emit('ctrl+t');
      expect(display.isTaskListVisible()).toBe(false);

      display.stop();
    });

    it('fires event callbacks on key presses', () => {
      let cycled = false;
      let entered = false;
      let escaped = false;
      let toggled = false;

      const display = new InProcessDisplay(teamName, {
        onCycleNext: () => { cycled = true; },
        onEnter: () => { entered = true; },
        onEscape: () => { escaped = true; },
        onToggleTaskList: () => { toggled = true; },
      });
      display.setTeammates(makeViews(2));

      const reader = new TestKeyReader();
      display.setKeyReader(reader);
      display.start();

      reader.emit('shift+down');
      expect(cycled).toBe(true);

      reader.emit('enter');
      expect(entered).toBe(true);

      reader.emit('escape');
      expect(escaped).toBe(true);

      reader.emit('ctrl+t');
      expect(toggled).toBe(true);

      display.stop();
    });

    it('does not emit keys when stopped', () => {
      const display = new InProcessDisplay(teamName);
      display.setTeammates(makeViews(3));

      const reader = new TestKeyReader();
      display.setKeyReader(reader);
      // Don't call start()

      reader.emit('shift+down');
      expect(display.getFocusIndex()).toBe(0); // unchanged
    });
  });

  describe('no external dependencies (DM-5)', () => {
    it('InProcessDisplay uses only built-in APIs', () => {
      // Verify that constructing and using InProcessDisplay
      // does not require tmux, iTerm2, or any external process.
      const display = new InProcessDisplay(teamName);
      display.setTeammates(makeViews(2));
      display.cycleNext();
      display.toggleTaskList();
      const bar = display.renderStatusBar();

      // If we got this far, no external tool was needed.
      expect(bar).toBeTruthy();
      expect(display.isTaskListVisible()).toBe(true);
    });
  });
});
