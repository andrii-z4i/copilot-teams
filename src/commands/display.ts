/**
 * copilot-teams display — show or set display mode.
 */

import { parseFlags, resolveTeamName } from './helpers.js';
import { resolveDisplayMode, detectTerminalEnvironment } from '../display/index.js';
import { loadConfig } from '../config/index.js';
import type { TeammateMode } from '../types.js';

const HELP = `
Usage: copilot-teams display [subcommand] [options]

Subcommands:
  show      Show current display mode (default)
  detect    Detect terminal environment (tmux/iTerm2/unknown)

Options:
  --teammate-mode <mode>  Override: in-process | tmux | auto
`.trim();

export async function cmdDisplay(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const sub = positional[0] ?? 'show';

  if (flags['help']) {
    console.log(HELP);
    return;
  }

  switch (sub) {
    case 'show': {
      const config = loadConfig({ teammateMode: flags['teammate-mode'] as TeammateMode });
      const mode = resolveDisplayMode(config, {
        teammateMode: flags['teammate-mode'] as TeammateMode,
      });
      console.log(`Display mode: ${mode}`);
      console.log(`Terminal: ${detectTerminalEnvironment()}`);
      break;
    }
    case 'detect': {
      const env = detectTerminalEnvironment();
      console.log(`Detected terminal: ${env}`);
      break;
    }
    default:
      console.error(`Unknown subcommand: display ${sub}`);
      console.log(HELP);
      process.exit(1);
  }
}
