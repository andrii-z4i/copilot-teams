/**
 * Test helpers — temp directory management for integration tests.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createTempDir(prefix = 'copilot-teams-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function cleanupTempDir(dirPath: string): void {
  fs.rmSync(dirPath, { recursive: true, force: true });
}
