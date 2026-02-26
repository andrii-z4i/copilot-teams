import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveDisplayMode,
  createDisplay,
  InProcessDisplay,
  TmuxDisplay,
  ITermDisplay,
  setEnvReader,
  setIt2Checker,
  setCommandExecutor,
} from '../../src/display/index.js';
import type { CopilotTeamsConfig } from '../../src/types.js';

afterEach(() => {
  setEnvReader(null);
  setIt2Checker(null);
  setCommandExecutor(null);
});

const defaultConfig: CopilotTeamsConfig = { enabled: true, teammateMode: 'auto' };

describe('resolveDisplayMode', () => {
  it('CLI flag overrides settings file (DM-12)', () => {
    setEnvReader(() => ({}));
    setIt2Checker(() => false);
    const config: CopilotTeamsConfig = { enabled: true, teammateMode: 'tmux' };
    const mode = resolveDisplayMode(config, { teammateMode: 'in-process' });
    expect(mode).toBe('in-process');
  });

  it('settings file overrides auto (DM-11)', () => {
    setEnvReader(() => ({}));
    setIt2Checker(() => false);
    const config: CopilotTeamsConfig = { enabled: true, teammateMode: 'tmux' };
    const mode = resolveDisplayMode(config);
    expect(mode).toBe('tmux');
  });

  it('auto mode picks tmux when inside tmux (DM-10)', () => {
    setEnvReader(() => ({ TMUX: '/tmp/tmux-1000/default,1234,0' }));
    const mode = resolveDisplayMode(defaultConfig);
    expect(mode).toBe('tmux');
  });

  it('auto mode picks in-process outside tmux (DM-10)', () => {
    setEnvReader(() => ({}));
    setIt2Checker(() => false);
    const mode = resolveDisplayMode(defaultConfig);
    expect(mode).toBe('in-process');
  });

  it('auto mode picks iterm2 when ITERM_SESSION_ID is set', () => {
    setEnvReader(() => ({ ITERM_SESSION_ID: 'w0t0p0:XXX' }));
    const mode = resolveDisplayMode(defaultConfig);
    expect(mode).toBe('iterm2');
  });

  it('CLI flag "auto" falls through to auto-detect', () => {
    setEnvReader(() => ({ TMUX: '/tmp/tmux' }));
    const mode = resolveDisplayMode(defaultConfig, { teammateMode: 'auto' });
    expect(mode).toBe('tmux');
  });
});

describe('createDisplay', () => {
  it('creates InProcessDisplay for in-process mode', () => {
    const display = createDisplay('in-process', 'team-1');
    expect(display).toBeInstanceOf(InProcessDisplay);
  });

  it('creates TmuxDisplay for tmux mode', () => {
    setCommandExecutor(() => ({ exitCode: 0, stdout: '', stderr: '' }));
    const display = createDisplay('tmux', 'team-1');
    expect(display).toBeInstanceOf(TmuxDisplay);
  });

  it('creates ITermDisplay for iterm2 mode', () => {
    setCommandExecutor(() => ({ exitCode: 0, stdout: '', stderr: '' }));
    const display = createDisplay('iterm2', 'team-1');
    expect(display).toBeInstanceOf(ITermDisplay);
  });
});
