import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  appendMessage,
  readAllMessages,
  readMessages,
  sendMessage,
  broadcastMessage,
  notifyLeadIdle,
  watchMessages,
  stopWatching,
  resetMessageCounter,
} from '../../src/comms/index.js';
import * as constants from '../../src/constants.js';

let originalTeamsBaseDir: string;
let tmpBase: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-teams-comms-test-'));
  originalTeamsBaseDir = constants.TEAMS_BASE_DIR;
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: tmpBase,
    writable: true,
    configurable: true,
  });
  // Ensure team dir exists
  fs.mkdirSync(path.join(tmpBase, 'test-team'), { recursive: true });
  resetMessageCounter('test-team');
});

afterEach(() => {
  stopWatching('test-team');
  Object.defineProperty(constants, 'TEAMS_BASE_DIR', {
    value: originalTeamsBaseDir,
    writable: true,
    configurable: true,
  });
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('single-writer invariant', () => {
  it('only the Lead can append messages', async () => {
    await expect(
      appendMessage('test-team', 'teammate-a', 'lead', 'hello', false),
    ).rejects.toThrow('Only the Team Lead can write messages');
  });

  it('Lead can append messages', async () => {
    const msg = await appendMessage('test-team', 'lead', 'teammate-a', 'hello', true);
    expect(msg.from).toBe('lead');
    expect(msg.to).toBe('teammate-a');
    expect(msg.body).toBe('hello');
  });
});

describe('appendMessage', () => {
  it('assigns monotonic IDs', async () => {
    const m1 = await appendMessage('test-team', 'lead', 'a', 'first');
    const m2 = await appendMessage('test-team', 'lead', 'b', 'second');
    const m3 = await appendMessage('test-team', 'lead', 'a', 'third');
    expect(m1.id).toBe(1);
    expect(m2.id).toBe(2);
    expect(m3.id).toBe(3);
  });

  it('persists messages to file in correct format', async () => {
    await appendMessage('test-team', 'lead', 'reviewer-1', 'Review auth module');
    const content = fs.readFileSync(
      path.join(tmpBase, 'test-team', 'messages.md'),
      'utf-8',
    );
    expect(content).toMatch(/\[MSG-001\]/);
    expect(content).toMatch(/\[lead\]/);
    expect(content).toMatch(/\[reviewer-1\]/);
    expect(content).toContain('Review auth module');
  });

  it('appends (does not overwrite) existing messages', async () => {
    await appendMessage('test-team', 'lead', 'a', 'first');
    await appendMessage('test-team', 'lead', 'b', 'second');
    const all = readAllMessages('test-team');
    expect(all).toHaveLength(2);
  });
});

describe('readAllMessages', () => {
  it('returns empty array for nonexistent file', () => {
    expect(readAllMessages('no-such-team')).toEqual([]);
  });

  it('parses all messages correctly', async () => {
    await appendMessage('test-team', 'lead', 'a', 'msg one');
    await appendMessage('test-team', 'lead', 'BROADCAST', 'msg two');
    const all = readAllMessages('test-team');
    expect(all).toHaveLength(2);
    expect(all[0].from).toBe('lead');
    expect(all[0].to).toBe('a');
    expect(all[0].body).toBe('msg one');
    expect(all[1].to).toBe('BROADCAST');
  });
});

describe('readMessages (filtered)', () => {
  it('point-to-point message is visible to correct recipient', async () => {
    await appendMessage('test-team', 'lead', 'alice', 'for alice');
    await appendMessage('test-team', 'lead', 'bob', 'for bob');

    const aliceMsgs = readMessages('test-team', 'alice');
    expect(aliceMsgs).toHaveLength(1);
    expect(aliceMsgs[0].body).toBe('for alice');

    const bobMsgs = readMessages('test-team', 'bob');
    expect(bobMsgs).toHaveLength(1);
    expect(bobMsgs[0].body).toBe('for bob');
  });

  it('broadcast message is visible to all members', async () => {
    await appendMessage('test-team', 'lead', 'BROADCAST', 'all hands');
    expect(readMessages('test-team', 'alice')).toHaveLength(1);
    expect(readMessages('test-team', 'bob')).toHaveLength(1);
    expect(readMessages('test-team', 'lead')).toHaveLength(1);
  });

  it('cursor-based read returns only messages after given ID', async () => {
    await appendMessage('test-team', 'lead', 'alice', 'msg 1');
    await appendMessage('test-team', 'lead', 'alice', 'msg 2');
    await appendMessage('test-team', 'lead', 'alice', 'msg 3');

    const afterId1 = readMessages('test-team', 'alice', 1);
    expect(afterId1).toHaveLength(2);
    expect(afterId1[0].body).toBe('msg 2');
    expect(afterId1[1].body).toBe('msg 3');

    const afterId2 = readMessages('test-team', 'alice', 2);
    expect(afterId2).toHaveLength(1);
    expect(afterId2[0].body).toBe('msg 3');

    const afterId3 = readMessages('test-team', 'alice', 3);
    expect(afterId3).toHaveLength(0);
  });
});

describe('broadcastMessage', () => {
  it('sends broadcast and returns message', async () => {
    const { message } = await broadcastMessage('test-team', 'lead', 'sprint 1 active');
    expect(message.to).toBe('BROADCAST');
    expect(message.body).toBe('sprint 1 active');
  });

  it('triggers cost warning for large teams (>3)', async () => {
    const { costWarning } = await broadcastMessage('test-team', 'lead', 'hi', 5);
    expect(costWarning).toBeDefined();
    expect(costWarning).toContain('5 teammates');
    expect(costWarning).toContain('token usage');
  });

  it('no cost warning for small teams (≤3)', async () => {
    const { costWarning } = await broadcastMessage('test-team', 'lead', 'hi', 3);
    expect(costWarning).toBeUndefined();
  });
});

describe('notifyLeadIdle (CM-6)', () => {
  it('records idle notification as message to lead', async () => {
    const msg = await notifyLeadIdle('test-team', 'worker-a');
    expect(msg.from).toBe('worker-a');
    expect(msg.to).toBe('lead');
    expect(msg.body).toContain('[IDLE]');
    expect(msg.body).toContain('worker-a');
  });
});

describe('messages file is append-only', () => {
  it('new messages are appended without modifying existing entries', async () => {
    await appendMessage('test-team', 'lead', 'a', 'first');
    const contentAfterFirst = fs.readFileSync(
      path.join(tmpBase, 'test-team', 'messages.md'),
      'utf-8',
    );

    await appendMessage('test-team', 'lead', 'b', 'second');
    const contentAfterSecond = fs.readFileSync(
      path.join(tmpBase, 'test-team', 'messages.md'),
      'utf-8',
    );

    // Second content should start with first content
    expect(contentAfterSecond.startsWith(contentAfterFirst)).toBe(true);
    // And have additional content
    expect(contentAfterSecond.length).toBeGreaterThan(contentAfterFirst.length);
  });
});

describe('watchMessages (CM-5, CM-7)', () => {
  it('triggers callback on new message', async () => {
    const received: Message[] = [];

    watchMessages('test-team', 'alice', (msgs) => {
      received.push(...msgs);
    });

    // Give watcher time to initialize
    await new Promise((r) => setTimeout(r, 50));

    await appendMessage('test-team', 'lead', 'alice', 'watched message');

    // Give fs.watch time to fire
    await new Promise((r) => setTimeout(r, 200));

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].body).toBe('watched message');
  });

  it('does not trigger for messages to other recipients', async () => {
    const received: Message[] = [];

    watchMessages('test-team', 'alice', (msgs) => {
      received.push(...msgs);
    });

    await new Promise((r) => setTimeout(r, 50));

    await appendMessage('test-team', 'lead', 'bob', 'not for alice');

    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(0);
  });

  it('broadcast triggers callback for all watchers', async () => {
    const aliceReceived: Message[] = [];
    const bobReceived: Message[] = [];

    watchMessages('test-team', 'alice', (msgs) => aliceReceived.push(...msgs));
    watchMessages('test-team', 'bob', (msgs) => bobReceived.push(...msgs));

    await new Promise((r) => setTimeout(r, 50));

    await appendMessage('test-team', 'lead', 'BROADCAST', 'for everyone');

    await new Promise((r) => setTimeout(r, 200));

    expect(aliceReceived.length).toBeGreaterThanOrEqual(1);
    expect(bobReceived.length).toBeGreaterThanOrEqual(1);
  });

  it('unsubscribe stops callback', async () => {
    const received: Message[] = [];

    const unsubscribe = watchMessages('test-team', 'alice', (msgs) => {
      received.push(...msgs);
    });

    await new Promise((r) => setTimeout(r, 50));

    unsubscribe();

    await appendMessage('test-team', 'lead', 'alice', 'after unsub');

    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(0);
  });
});
