import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TmuxDisplay,
  ITermDisplay,
  detectTerminalEnvironment,
  setCommandExecutor,
  setEnvReader,
  setIt2Checker,
  type CommandExecutor,
} from '../../src/display/index.js';

// Track all commands issued to tmux / it2
let commandLog: Array<{ cmd: string; args: string[] }> = [];

const fakeExecutor: CommandExecutor = (cmd, args) => {
  commandLog.push({ cmd, args });
  // Return a fake pane id based on how many commands we've seen
  return { exitCode: 0, stdout: `fake-pane-${commandLog.length}\n`, stderr: '' };
};

beforeEach(() => {
  commandLog = [];
  setCommandExecutor(fakeExecutor);
});

afterEach(() => {
  setCommandExecutor(null);
  setEnvReader(null);
  setIt2Checker(null);
});

describe('TmuxDisplay', () => {
  it('creates panes for N teammates', () => {
    const display = new TmuxDisplay('my-session');
    const panes = display.createPanes([
      { name: 'tm-1', command: 'copilot-cli --team tm-1' },
      { name: 'tm-2', command: 'copilot-cli --team tm-2' },
      { name: 'tm-3', command: 'copilot-cli --team tm-3' },
    ]);

    expect(panes).toHaveLength(3);
    expect(panes[0].teammateName).toBe('tm-1');
    expect(panes[1].teammateName).toBe('tm-2');
    expect(panes[2].teammateName).toBe('tm-3');
    // Each pane has a unique id
    const ids = new Set(panes.map((p) => p.paneId));
    expect(ids.size).toBe(3);
  });

  it('first pane uses new-window, subsequent use split-window', () => {
    const display = new TmuxDisplay('sess');
    display.createPane('tm-1', 'cmd1');
    display.createPane('tm-2', 'cmd2');

    expect(commandLog[0].args[0]).toBe('new-window');
    expect(commandLog[1].args[0]).toBe('split-window');
  });

  it('sendToPane issues tmux send-keys', () => {
    const display = new TmuxDisplay('sess');
    const pane = display.createPane('tm-1', 'cmd1');
    display.sendToPane(pane.paneId, 'hello');

    const sendCmd = commandLog.find((c) => c.args[0] === 'send-keys');
    expect(sendCmd).toBeDefined();
    expect(sendCmd!.args).toContain(pane.paneId);
    expect(sendCmd!.args).toContain('hello');
  });

  it('rebalance calls select-layout tiled', () => {
    const display = new TmuxDisplay('sess');
    display.createPane('tm-1', 'cmd1');
    display.createPane('tm-2', 'cmd2');
    display.rebalance();

    const layoutCmd = commandLog.find((c) => c.args[0] === 'select-layout');
    expect(layoutCmd).toBeDefined();
    expect(layoutCmd!.args).toContain('tiled');
  });

  it('close kills all panes', () => {
    const display = new TmuxDisplay('sess');
    display.createPane('tm-1', 'cmd1');
    display.createPane('tm-2', 'cmd2');
    expect(display.getPanes()).toHaveLength(2);

    display.close();
    expect(display.getPanes()).toHaveLength(0);

    const killCmds = commandLog.filter((c) => c.args[0] === 'kill-pane');
    expect(killCmds).toHaveLength(2);
  });
});

describe('ITermDisplay', () => {
  it('creates panes via it2 CLI for N teammates', () => {
    const display = new ITermDisplay();
    const panes = display.createPanes([
      { name: 'tm-1', command: 'copilot-cli --team tm-1' },
      { name: 'tm-2', command: 'copilot-cli --team tm-2' },
    ]);

    expect(panes).toHaveLength(2);
    expect(panes[0].teammateName).toBe('tm-1');
    expect(panes[1].teammateName).toBe('tm-2');

    // All commands should target `it2`
    const it2Cmds = commandLog.filter((c) => c.cmd === 'it2');
    expect(it2Cmds.length).toBe(2);
    expect(it2Cmds[0].args[0]).toBe('split-pane');
    expect(it2Cmds[0].args).toContain('--command');
  });

  it('close issues it2 close-pane for each pane', () => {
    const display = new ITermDisplay();
    display.createPane('tm-1', 'cmd1');
    display.createPane('tm-2', 'cmd2');

    display.close();
    expect(display.getPanes()).toHaveLength(0);

    const closeCmds = commandLog.filter(
      (c) => c.cmd === 'it2' && c.args[0] === 'close-pane'
    );
    expect(closeCmds).toHaveLength(2);
  });
});

describe('detectTerminalEnvironment', () => {
  it('detects tmux when $TMUX is set', () => {
    setEnvReader(() => ({ TMUX: '/tmp/tmux-1000/default,12345,0' }));
    expect(detectTerminalEnvironment()).toBe('tmux');
  });

  it('detects iTerm2 when ITERM_SESSION_ID is set', () => {
    setEnvReader(() => ({ ITERM_SESSION_ID: 'w0t0p0:XXXXXXXX' }));
    expect(detectTerminalEnvironment()).toBe('iterm2');
  });

  it('detects iTerm2 when TERM_PROGRAM is iTerm.app', () => {
    setEnvReader(() => ({ TERM_PROGRAM: 'iTerm.app' }));
    expect(detectTerminalEnvironment()).toBe('iterm2');
  });

  it('detects iTerm2 when it2 CLI is available', () => {
    setEnvReader(() => ({}));
    setIt2Checker(() => true);
    expect(detectTerminalEnvironment()).toBe('iterm2');
  });

  it('returns unknown when nothing is detected', () => {
    setEnvReader(() => ({}));
    setIt2Checker(() => false);
    expect(detectTerminalEnvironment()).toBe('unknown');
  });

  it('prefers tmux over iTerm2 when both are present', () => {
    setEnvReader(() => ({
      TMUX: '/tmp/tmux',
      ITERM_SESSION_ID: 'w0t0p0:XXX',
    }));
    expect(detectTerminalEnvironment()).toBe('tmux');
  });
});
