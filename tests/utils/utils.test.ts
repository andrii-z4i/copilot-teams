import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolvePath,
  resolveTeamFile,
  resolveAllTeamFiles,
  ensureDir,
  ensureTeamDir,
  atomicWriteFile,
  appendFile,
  acquireLock,
  isLocked,
  withLock,
} from '../../src/utils/index.js';
import { TEAMS_BASE_DIR } from '../../src/constants.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-teams-utils-test-'));
}

describe('path resolution', () => {
  it('resolvePath returns correct team directory', () => {
    const p = resolvePath('my-team');
    expect(p).toBe(path.join(TEAMS_BASE_DIR, 'my-team'));
  });

  it('resolvePath appends extra segments', () => {
    const p = resolvePath('my-team', 'sub', 'file.txt');
    expect(p).toBe(path.join(TEAMS_BASE_DIR, 'my-team', 'sub', 'file.txt'));
  });

  it('resolveTeamFile returns correct path for config', () => {
    expect(resolveTeamFile('t1', 'config')).toBe(path.join(TEAMS_BASE_DIR, 't1', 'config.json'));
  });

  it('resolveTeamFile returns correct path for backlog', () => {
    expect(resolveTeamFile('t1', 'backlog')).toBe(path.join(TEAMS_BASE_DIR, 't1', 'backlog.md'));
  });

  it('resolveTeamFile returns correct path for messages', () => {
    expect(resolveTeamFile('t1', 'messages')).toBe(
      path.join(TEAMS_BASE_DIR, 't1', 'messages.md'),
    );
  });

  it('resolveTeamFile returns correct path for sprint', () => {
    expect(resolveTeamFile('t1', 'sprint')).toBe(path.join(TEAMS_BASE_DIR, 't1', 'sprint.md'));
  });

  it('resolveTeamFile returns correct path for files', () => {
    expect(resolveTeamFile('t1', 'files')).toBe(path.join(TEAMS_BASE_DIR, 't1', 'files.md'));
  });

  it('resolveTeamFile returns correct path for permission-audit', () => {
    expect(resolveTeamFile('t1', 'permission-audit')).toBe(
      path.join(TEAMS_BASE_DIR, 't1', 'permission-audit.log'),
    );
  });

  it('resolveAllTeamFiles returns all known file paths', () => {
    const all = resolveAllTeamFiles('t1');
    expect(Object.keys(all)).toEqual([
      'config',
      'backlog',
      'messages',
      'sprint',
      'files',
      'permission-audit',
    ]);
    expect(all.config).toContain('config.json');
    expect(all.backlog).toContain('backlog.md');
  });
});

describe('ensureDir', () => {
  it('creates nested directories', () => {
    const dir = path.join(tmpDir(), 'a', 'b', 'c');
    expect(fs.existsSync(dir)).toBe(false);
    ensureDir(dir);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  it('is idempotent on existing directory', () => {
    const dir = tmpDir();
    ensureDir(dir);
    ensureDir(dir); // should not throw
    expect(fs.existsSync(dir)).toBe(true);
  });
});

describe('ensureTeamDir', () => {
  // We can't easily test this without mocking TEAMS_BASE_DIR,
  // but we verify it returns the expected path format.
  it('returns a path under TEAMS_BASE_DIR', () => {
    const dir = ensureTeamDir('test-team-xyz');
    expect(dir).toBe(path.join(TEAMS_BASE_DIR, 'test-team-xyz'));
  });
});

describe('atomicWriteFile', () => {
  it('writes content that can be read back', () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'test.txt');
    atomicWriteFile(filePath, 'hello world');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello world');
  });

  it('overwrites existing file', () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'test.txt');
    atomicWriteFile(filePath, 'first');
    atomicWriteFile(filePath, 'second');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('second');
  });

  it('creates parent directories if needed', () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'sub', 'deep', 'test.txt');
    atomicWriteFile(filePath, 'nested');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('nested');
  });

  it('does not leave temp files on success', () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'test.txt');
    atomicWriteFile(filePath, 'content');
    const files = fs.readdirSync(dir);
    expect(files).toEqual(['test.txt']);
  });
});

describe('appendFile', () => {
  it('creates file and appends content', () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'append.txt');
    appendFile(filePath, 'line1\n');
    appendFile(filePath, 'line2\n');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('line1\nline2\n');
  });

  it('creates parent directories if needed', () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'sub', 'append.txt');
    appendFile(filePath, 'data');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('data');
  });
});

describe('file locking', () => {
  it('acquireLock returns a release function', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'locktest.txt');
    fs.writeFileSync(filePath, '');
    const release = await acquireLock(filePath);
    expect(typeof release).toBe('function');
    await release();
  });

  it('locked file reports as locked', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'locktest.txt');
    fs.writeFileSync(filePath, '');
    const release = await acquireLock(filePath);
    expect(await isLocked(filePath)).toBe(true);
    await release();
  });

  it('released file reports as unlocked', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'locktest.txt');
    fs.writeFileSync(filePath, '');
    const release = await acquireLock(filePath);
    await release();
    expect(await isLocked(filePath)).toBe(false);
  });

  it('acquireLock creates file if it does not exist', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'nonexistent.txt');
    const release = await acquireLock(filePath);
    expect(fs.existsSync(filePath)).toBe(true);
    await release();
  });

  it('withLock executes callback and releases lock', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'withlock.txt');
    fs.writeFileSync(filePath, '');
    const result = await withLock(filePath, () => {
      return 42;
    });
    expect(result).toBe(42);
    expect(await isLocked(filePath)).toBe(false);
  });

  it('withLock releases lock even if callback throws', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'withlock-err.txt');
    fs.writeFileSync(filePath, '');
    await expect(
      withLock(filePath, () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');
    expect(await isLocked(filePath)).toBe(false);
  });

  it('concurrent lock acquisition is serialized', async () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'concurrent.txt');
    fs.writeFileSync(filePath, '');
    const order: number[] = [];

    const p1 = withLock(filePath, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
    });

    // Small delay so p1 acquires first
    await new Promise((r) => setTimeout(r, 10));

    const p2 = withLock(filePath, async () => {
      order.push(3);
    });

    await Promise.all([p1, p2]);
    // p1 should complete (1,2) before p2 starts (3)
    expect(order).toEqual([1, 2, 3]);
  });
});
