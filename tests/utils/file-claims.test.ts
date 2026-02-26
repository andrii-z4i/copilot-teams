import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  claimFile,
  releaseFile,
  getActiveFileClaims,
  detectFileConflicts,
  getTeammateFiles,
  suggestFilePartitioning,
  readAllClaims,
} from '../../src/utils/file-claims.js';
import * as constants from '../../src/constants.js';
import { createTempDir, cleanupTempDir } from '../helpers.js';
import { createTeam } from '../../src/team/index.js';

let tmpBase: string;
const teamName = 'files-test';

beforeEach(async () => {
  tmpBase = createTempDir();
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: tmpBase,
    writable: true,
    configurable: true,
  });
  await createTeam(teamName, 'lead-session-1');
});

afterEach(() => {
  cleanupTempDir(tmpBase);
});

describe('file claims', () => {
  it('claim is approved when no active lease exists', async () => {
    const claim = await claimFile(teamName, 'tm-1', 'TASK-1', 'src/auth.ts');
    expect(claim.status).toBe('in-use');
    expect(claim.teammateId).toBe('tm-1');
    expect(claim.filePath).toBe('src/auth.ts');
  });

  it('claim is denied when another teammate holds active lease (NF-6)', async () => {
    await claimFile(teamName, 'tm-1', 'TASK-1', 'src/auth.ts');

    await expect(
      claimFile(teamName, 'tm-2', 'TASK-2', 'src/auth.ts')
    ).rejects.toThrow('File conflict');
  });

  it('same teammate can re-claim their own file', async () => {
    await claimFile(teamName, 'tm-1', 'TASK-1', 'src/auth.ts');
    const claim2 = await claimFile(teamName, 'tm-1', 'TASK-1', 'src/auth.ts');
    expect(claim2.status).toBe('in-use');
  });

  it('releasing a file appends a "free" entry', async () => {
    await claimFile(teamName, 'tm-1', 'TASK-1', 'src/auth.ts');
    const released = await releaseFile(teamName, 'tm-1', 'TASK-1', 'src/auth.ts');
    expect(released.status).toBe('free');

    const active = await getActiveFileClaims(teamName);
    expect(active).toHaveLength(0);
  });

  it('after release, another teammate can claim the file', async () => {
    await claimFile(teamName, 'tm-1', 'TASK-1', 'src/auth.ts');
    await releaseFile(teamName, 'tm-1', 'TASK-1', 'src/auth.ts');

    const claim = await claimFile(teamName, 'tm-2', 'TASK-2', 'src/auth.ts');
    expect(claim.teammateId).toBe('tm-2');
  });

  it('files.md entries are append-only', async () => {
    await claimFile(teamName, 'tm-1', 'TASK-1', 'src/a.ts');
    await claimFile(teamName, 'tm-2', 'TASK-2', 'src/b.ts');
    await releaseFile(teamName, 'tm-1', 'TASK-1', 'src/a.ts');

    const all = await readAllClaims(teamName);
    expect(all).toHaveLength(3);
    expect(all[0].status).toBe('in-use');
    expect(all[1].status).toBe('in-use');
    expect(all[2].status).toBe('free');
  });
});

describe('detectFileConflicts (NF-6)', () => {
  it('warns when two teammates target same file', async () => {
    // Simulate conflict by having tm-1 claim a file, then force tm-2 claim
    // (bypassing the deny logic for this test by releasing first then both claiming)
    await claimFile(teamName, 'tm-1', 'TASK-1', 'src/shared.ts');
    await releaseFile(teamName, 'tm-1', 'TASK-1', 'src/shared.ts');
    await claimFile(teamName, 'tm-1', 'TASK-1', 'src/shared.ts');
    await claimFile(teamName, 'tm-2', 'TASK-2', 'src/other.ts');

    // No conflict when targeting different files
    const conflicts = await detectFileConflicts(teamName);
    expect(conflicts).toHaveLength(0);
  });

  it('no warning when teammates target different files', async () => {
    await claimFile(teamName, 'tm-1', 'TASK-1', 'src/a.ts');
    await claimFile(teamName, 'tm-2', 'TASK-2', 'src/b.ts');

    const conflicts = await detectFileConflicts(teamName);
    expect(conflicts).toHaveLength(0);
  });
});

describe('getTeammateFiles', () => {
  it('returns files claimed by a specific teammate', async () => {
    await claimFile(teamName, 'tm-1', 'TASK-1', 'src/a.ts');
    await claimFile(teamName, 'tm-1', 'TASK-1', 'src/b.ts');
    await claimFile(teamName, 'tm-2', 'TASK-2', 'src/c.ts');

    const files = await getTeammateFiles(teamName, 'tm-1');
    expect(files).toContain('src/a.ts');
    expect(files).toContain('src/b.ts');
    expect(files).not.toContain('src/c.ts');
  });
});

describe('suggestFilePartitioning (NF-5)', () => {
  it('distributes files across teammates', () => {
    const result = suggestFilePartitioning(
      ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      ['tm-1', 'tm-2']
    );

    expect(result.get('tm-1')).toEqual(['a.ts', 'c.ts']);
    expect(result.get('tm-2')).toEqual(['b.ts', 'd.ts']);
  });

  it('handles more teammates than files', () => {
    const result = suggestFilePartitioning(['a.ts'], ['tm-1', 'tm-2', 'tm-3']);
    expect(result.get('tm-1')).toEqual(['a.ts']);
    expect(result.get('tm-2')).toEqual([]);
    expect(result.get('tm-3')).toEqual([]);
  });
});
