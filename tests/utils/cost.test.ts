import { describe, it, expect } from 'vitest';
import {
  warnTeamSize,
  TOKEN_USAGE_NOTICE,
  getLargeTeamThreshold,
} from '../../src/utils/cost.js';

describe('warnTeamSize (NF-2)', () => {
  it('warns for team size > 5', () => {
    const result = warnTeamSize(6);
    expect(result.warn).toBe(true);
    expect(result.message).toContain('6 teammates');
    expect(result.message).toContain('token usage');
    expect(result.requestedSize).toBe(6);
  });

  it('warns for team size of 10', () => {
    const result = warnTeamSize(10);
    expect(result.warn).toBe(true);
    expect(result.message).toContain('10 teammates');
  });

  it('does NOT warn for team size = 5', () => {
    const result = warnTeamSize(5);
    expect(result.warn).toBe(false);
    expect(result.message).toBeNull();
  });

  it('does NOT warn for team size < 5', () => {
    const result = warnTeamSize(3);
    expect(result.warn).toBe(false);
    expect(result.message).toBeNull();
  });

  it('does NOT warn for team size = 1', () => {
    const result = warnTeamSize(1);
    expect(result.warn).toBe(false);
  });

  it('threshold is 5', () => {
    expect(getLargeTeamThreshold()).toBe(5);
  });
});

describe('TOKEN_USAGE_NOTICE (NF-1)', () => {
  it('documents token scaling', () => {
    expect(TOKEN_USAGE_NOTICE).toContain('Token Usage Notice');
    expect(TOKEN_USAGE_NOTICE).toContain('linearly');
    expect(TOKEN_USAGE_NOTICE).toContain('context window');
  });
});
