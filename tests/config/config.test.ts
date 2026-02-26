import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, isTeamsEnabled, assertTeamsEnabled } from '../../src/config/index.js';
import { ENV_TEAMS_ENABLED } from '../../src/constants.js';

function createTempSettings(content: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-teams-config-test-'));
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(content));
  return settingsPath;
}

describe('loadConfig', () => {
  const originalEnv = process.env[ENV_TEAMS_ENABLED];

  beforeEach(() => {
    delete process.env[ENV_TEAMS_ENABLED];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env[ENV_TEAMS_ENABLED] = originalEnv;
    } else {
      delete process.env[ENV_TEAMS_ENABLED];
    }
  });

  it('returns defaults when no config sources exist', () => {
    const config = loadConfig({}, '/nonexistent/settings.json');
    expect(config.enabled).toBe(false);
    expect(config.teammateMode).toBe('auto');
  });

  it('env var COPILOT_TEAMS_ENABLED=1 enables the feature', () => {
    process.env[ENV_TEAMS_ENABLED] = '1';
    const config = loadConfig({}, '/nonexistent/settings.json');
    expect(config.enabled).toBe(true);
  });

  it('env var COPILOT_TEAMS_ENABLED=true enables the feature', () => {
    process.env[ENV_TEAMS_ENABLED] = 'true';
    const config = loadConfig({}, '/nonexistent/settings.json');
    expect(config.enabled).toBe(true);
  });

  it('env var COPILOT_TEAMS_ENABLED=0 disables the feature', () => {
    process.env[ENV_TEAMS_ENABLED] = '0';
    const config = loadConfig({}, '/nonexistent/settings.json');
    expect(config.enabled).toBe(false);
  });

  it('settings file teammateMode is respected', () => {
    const settingsPath = createTempSettings({ teams: { teammateMode: 'tmux' } });
    const config = loadConfig({}, settingsPath);
    expect(config.teammateMode).toBe('tmux');
  });

  it('settings file enabled is respected', () => {
    const settingsPath = createTempSettings({ teams: { enabled: true } });
    const config = loadConfig({}, settingsPath);
    expect(config.enabled).toBe(true);
  });

  it('CLI flag --teammate-mode overrides settings file', () => {
    const settingsPath = createTempSettings({ teams: { teammateMode: 'tmux' } });
    const config = loadConfig({ teammateMode: 'in-process' }, settingsPath);
    expect(config.teammateMode).toBe('in-process');
  });

  it('env var overrides settings file for enabled', () => {
    const settingsPath = createTempSettings({ teams: { enabled: true } });
    process.env[ENV_TEAMS_ENABLED] = '0';
    const config = loadConfig({}, settingsPath);
    expect(config.enabled).toBe(false);
  });

  it('throws on invalid teammateMode in settings file', () => {
    const settingsPath = createTempSettings({ teams: { teammateMode: 'invalid' } });
    expect(() => loadConfig({}, settingsPath)).toThrow(
      'Invalid teammateMode "invalid" in settings file',
    );
  });

  it('throws on invalid --teammate-mode CLI flag', () => {
    expect(() => loadConfig({ teammateMode: 'invalid' })).toThrow(
      'Invalid --teammate-mode "invalid"',
    );
  });
});

describe('isTeamsEnabled', () => {
  it('returns false for default config', () => {
    expect(isTeamsEnabled({ enabled: false, teammateMode: 'auto' })).toBe(false);
  });

  it('returns true when enabled', () => {
    expect(isTeamsEnabled({ enabled: true, teammateMode: 'auto' })).toBe(true);
  });
});

describe('assertTeamsEnabled', () => {
  it('throws when disabled', () => {
    expect(() => assertTeamsEnabled({ enabled: false, teammateMode: 'auto' })).toThrow(
      'Copilot Teams is disabled',
    );
  });

  it('does not throw when enabled', () => {
    expect(() => assertTeamsEnabled({ enabled: true, teammateMode: 'auto' })).not.toThrow();
  });
});
