import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  requestPermission,
  reviewPermission,
  readAuditLog,
  loadPendingRequests,
  checkPermission,
  getDefaultPermissions,
  clearPendingRequests,
} from '../../src/permissions/index.js';
import * as constants from '../../src/constants.js';

let originalTeamsBaseDir: string;
let tmpBase: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-teams-perm-test-'));
  originalTeamsBaseDir = constants.TEAMS_BASE_DIR;
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: tmpBase,
    writable: true,
    configurable: true,
  });
  fs.mkdirSync(path.join(tmpBase, 'test-team'), { recursive: true });
  clearPendingRequests();
});

afterEach(() => {
  clearPendingRequests();
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: originalTeamsBaseDir,
    writable: true,
    configurable: true,
  });
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('default permissions (TM-7)', () => {
  it('teammate starts with minimum permissions (empty set)', () => {
    const perms = getDefaultPermissions();
    expect(perms.size).toBe(0);
  });
});

describe('requestPermission & reviewPermission', () => {
  it('permission request blocks until lead responds (TM-16)', async () => {
    // Start the request (will block)
    const requestPromise = requestPermission(
      'test-team',
      'worker-a',
      'file_write',
      'Write auth module',
      'src/auth/login.ts',
    );

    // Verify it's pending
    const pending = loadPendingRequests('test-team');
    expect(pending).toHaveLength(1);
    expect(pending[0].teammateName).toBe('worker-a');
    expect(pending[0].operation).toBe('file_write');

    // Lead reviews — approve
    const response = await reviewPermission(
      'test-team',
      pending[0].id,
      'approved',
      'Within assigned task scope',
    );

    expect(response.decision).toBe('approved');

    // The request promise should now resolve
    const result = await requestPromise;
    expect(result.decision).toBe('approved');
  });

  it('denied request blocks the operation (TM-10)', async () => {
    const requestPromise = requestPermission(
      'test-team',
      'worker-a',
      'shell_command',
      'Run dangerous command',
      'rm -rf /',
    );

    const pending = loadPendingRequests('test-team');
    await reviewPermission('test-team', pending[0].id, 'denied', 'Dangerous command');

    const result = await requestPromise;
    expect(result.decision).toBe('denied');
  });

  it('review throws for unknown request ID', async () => {
    await expect(
      reviewPermission('test-team', 'nonexistent-id', 'approved'),
    ).rejects.toThrow('not found');
  });
});

describe('single-use grants (TM-11, TM-12)', () => {
  it('approved request allows one execution only — second requires fresh approval', async () => {
    // First request via checkPermission with auto-review
    const first = await checkPermission(
      'test-team',
      'worker-a',
      'file_write',
      'Write file',
      'src/foo.ts',
      () => ({ decision: 'approved', rationale: 'ok' }),
    );
    expect(first.approved).toBe(true);

    // Second identical request — must be a separate request
    const second = await checkPermission(
      'test-team',
      'worker-a',
      'file_write',
      'Write file',
      'src/foo.ts',
      () => ({ decision: 'approved', rationale: 'ok again' }),
    );
    expect(second.approved).toBe(true);

    // Verify two separate audit entries
    const log = readAuditLog('test-team');
    expect(log).toHaveLength(2);
    expect(log[0].target).toBe('src/foo.ts');
    expect(log[1].target).toBe('src/foo.ts');
    // Different request IDs
    expect(first.response.requestId).not.toBe(second.response.requestId);
  });
});

describe('lead permission escalation guard (TM-8)', () => {
  it('lead cannot grant permissions beyond its own level', async () => {
    // Create a pending request
    const requestPromise = requestPermission(
      'test-team',
      'worker-a',
      'admin_access',
      'Access admin panel',
      '/admin',
    );

    const pending = loadPendingRequests('test-team');
    const leadPerms = new Set(['file_write', 'shell_command']); // no admin_access

    await expect(
      reviewPermission('test-team', pending[0].id, 'approved', 'sure', leadPerms),
    ).rejects.toThrow('lead does not have this permission itself');

    // Clean up: deny so the promise resolves
    // Reload pending since the request should still be there
    const stillPending = loadPendingRequests('test-team');
    if (stillPending.length > 0) {
      await reviewPermission('test-team', stillPending[0].id, 'denied', 'no escalation');
      await requestPromise;
    }
  });
});

describe('audit log (TM-13, TM-14, TM-15)', () => {
  it('audit log entry contains all required fields', async () => {
    await checkPermission(
      'test-team',
      'sec-reviewer',
      'file_write',
      'Modify auth file',
      'src/auth/login.ts',
      () => ({ decision: 'approved', rationale: 'Within scope' }),
    );

    const log = readAuditLog('test-team');
    expect(log).toHaveLength(1);
    const entry = log[0];
    expect(entry.timestamp).toBeTruthy();
    expect(entry.teammate).toBe('sec-reviewer');
    expect(entry.operation).toBe('file_write');
    expect(entry.target).toBe('src/auth/login.ts');
    expect(entry.decision).toBe('approved');
    expect(entry.rationale).toBe('Within scope');
  });

  it('audit log is append-only', async () => {
    await checkPermission('test-team', 'a', 'op1', 'd1', 't1', () => ({
      decision: 'approved',
    }));
    const afterFirst = readAuditLog('test-team');
    expect(afterFirst).toHaveLength(1);

    await checkPermission('test-team', 'b', 'op2', 'd2', 't2', () => ({
      decision: 'denied',
      rationale: 'nope',
    }));
    const afterSecond = readAuditLog('test-team');
    expect(afterSecond).toHaveLength(2);

    // First entry unchanged
    expect(afterSecond[0].teammate).toBe('a');
    expect(afterSecond[0].decision).toBe('approved');
    // Second appended
    expect(afterSecond[1].teammate).toBe('b');
    expect(afterSecond[1].decision).toBe('denied');
  });

  it('user can read full audit log (TM-17)', async () => {
    await checkPermission('test-team', 'w1', 'file_write', 'd', 'f1.ts', () => ({
      decision: 'approved',
    }));
    await checkPermission('test-team', 'w2', 'shell_command', 'd', 'ls', () => ({
      decision: 'denied',
    }));

    const log = readAuditLog('test-team');
    expect(log).toHaveLength(2);
    expect(log.map((e) => e.teammate)).toEqual(['w1', 'w2']);
  });

  it('returns empty array for nonexistent audit log', () => {
    expect(readAuditLog('no-team')).toEqual([]);
  });
});

describe('checkPermission with auto-review', () => {
  it('approved check returns approved: true', async () => {
    const result = await checkPermission(
      'test-team',
      'worker',
      'file_write',
      'Write file',
      'src/x.ts',
      () => ({ decision: 'approved' }),
    );
    expect(result.approved).toBe(true);
  });

  it('denied check returns approved: false', async () => {
    const result = await checkPermission(
      'test-team',
      'worker',
      'shell_command',
      'Run command',
      'rm -rf /',
      () => ({ decision: 'denied', rationale: 'dangerous' }),
    );
    expect(result.approved).toBe(false);
  });
});
