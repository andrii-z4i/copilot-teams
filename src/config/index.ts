/**
 * Configuration loading and feature flag for Copilot Teams.
 *
 * Priority order (highest to lowest):
 * 1. CLI flags (--teammate-mode)
 * 2. Environment variable (COPILOT_TEAMS_ENABLED)
 * 3. Settings file (settings.json)
 * 4. Defaults (enabled: false, teammateMode: "auto")
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ENV_TEAMS_ENABLED, TEAMMATE_MODES } from '../constants.js';
import type { CopilotTeamsConfig, TeammateMode } from '../types.js';

const SETTINGS_PATH = path.join(os.homedir(), '.copilot', 'settings.json');

const DEFAULT_CONFIG: CopilotTeamsConfig = {
  enabled: false,
  teammateMode: 'auto',
};

export interface CliFlags {
  teammateMode?: string;
}

interface SettingsFile {
  teams?: {
    enabled?: boolean;
    teammateMode?: string;
  };
}

function isValidTeammateMode(value: string): value is TeammateMode {
  return (TEAMMATE_MODES as readonly string[]).includes(value);
}

function loadSettingsFile(settingsPath: string = SETTINGS_PATH): SettingsFile {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    return JSON.parse(raw) as SettingsFile;
  } catch {
    return {};
  }
}

/**
 * Load and merge configuration from all sources.
 */
export function loadConfig(
  cliFlags: CliFlags = {},
  settingsPath?: string,
): CopilotTeamsConfig {
  const settings = loadSettingsFile(settingsPath);
  const config: CopilotTeamsConfig = { ...DEFAULT_CONFIG };

  // Layer 3: Settings file (lowest priority after defaults)
  if (settings.teams?.enabled !== undefined) {
    config.enabled = settings.teams.enabled;
  }
  if (settings.teams?.teammateMode !== undefined) {
    const mode = settings.teams.teammateMode;
    if (!isValidTeammateMode(mode)) {
      throw new Error(
        `Invalid teammateMode "${mode}" in settings file. Valid values: ${TEAMMATE_MODES.join(', ')}`,
      );
    }
    config.teammateMode = mode;
  }

  // Layer 2: Environment variable
  const envEnabled = process.env[ENV_TEAMS_ENABLED];
  if (envEnabled !== undefined) {
    config.enabled = envEnabled === '1' || envEnabled.toLowerCase() === 'true';
  }

  // Layer 1: CLI flags (highest priority)
  if (cliFlags.teammateMode !== undefined) {
    if (!isValidTeammateMode(cliFlags.teammateMode)) {
      throw new Error(
        `Invalid --teammate-mode "${cliFlags.teammateMode}". Valid values: ${TEAMMATE_MODES.join(', ')}`,
      );
    }
    config.teammateMode = cliFlags.teammateMode;
  }

  return config;
}

/**
 * Check whether Copilot Teams is enabled.
 */
export function isTeamsEnabled(config?: CopilotTeamsConfig): boolean {
  const resolved = config ?? loadConfig();
  return resolved.enabled;
}

/**
 * Guard that throws if Teams is disabled.
 */
export function assertTeamsEnabled(config?: CopilotTeamsConfig): void {
  if (!isTeamsEnabled(config)) {
    throw new Error(
      'Copilot Teams is disabled. Enable it by setting COPILOT_TEAMS_ENABLED=1 or enabling it in settings.',
    );
  }
}
