import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TeammateOutputViewer,
  relayInstructionThroughLead,
  assertSenderIsLead,
  broadcastInstructionFromLead,
} from '../../src/display/visibility.js';
import { InProcessDisplay, type TeammateView } from '../../src/display/index.js';
import * as constants from '../../src/constants.js';
import { createTempDir, cleanupTempDir } from '../helpers.js';
import { createTeam } from '../../src/team/index.js';
import { readAllMessages } from '../../src/comms/index.js';

let tmpBase: string;
const teamName = 'visibility-test';

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

describe('TeammateOutputViewer', () => {
  it('provides read-only viewing of teammate output', () => {
    const viewer = new TeammateOutputViewer();
    viewer.appendOutput('tm-1', 'Working on TASK-1...');
    viewer.appendOutput('tm-1', 'Reading src/auth.ts');
    viewer.appendOutput('tm-2', 'Running tests');

    expect(viewer.getOutput('tm-1')).toEqual([
      'Working on TASK-1...',
      'Reading src/auth.ts',
    ]);
    expect(viewer.getOutput('tm-2')).toEqual(['Running tests']);
  });

  it('viewer is always read-only', () => {
    const viewer = new TeammateOutputViewer();
    expect(viewer.isReadOnly()).toBe(true);
  });

  it('returns empty array for unknown teammate', () => {
    const viewer = new TeammateOutputViewer();
    expect(viewer.getOutput('nonexistent')).toEqual([]);
  });

  it('lists all teammates with output', () => {
    const viewer = new TeammateOutputViewer();
    viewer.appendOutput('tm-1', 'line1');
    viewer.appendOutput('tm-2', 'line2');
    viewer.appendOutput('tm-3', 'line3');

    expect(viewer.getTeammateNames()).toEqual(['tm-1', 'tm-2', 'tm-3']);
  });
});

describe('in-process mode cycling allows viewing teammate output (CM-9)', () => {
  it('user cycles through teammates to view their output', () => {
    const views: TeammateView[] = [
      { name: 'lead', status: 'active', outputLines: ['Lead output'] },
      { name: 'tm-1', status: 'active', outputLines: ['Teammate 1 output'] },
      { name: 'tm-2', status: 'active', outputLines: ['Teammate 2 output'] },
    ];

    const display = new InProcessDisplay(teamName);
    display.setTeammates(views);

    // Initially focused on lead
    expect(display.getFocusedTeammate()?.name).toBe('lead');
    expect(display.getFocusedTeammate()?.outputLines).toEqual(['Lead output']);

    // Cycle to tm-1
    display.cycleNext();
    expect(display.getFocusedTeammate()?.name).toBe('tm-1');
    expect(display.getFocusedTeammate()?.outputLines).toEqual(['Teammate 1 output']);

    // Cycle to tm-2
    display.cycleNext();
    expect(display.getFocusedTeammate()?.name).toBe('tm-2');
    expect(display.getFocusedTeammate()?.outputLines).toEqual(['Teammate 2 output']);
  });
});

describe('user cannot send direct input to a teammate (CM-8)', () => {
  it('assertSenderIsLead throws when sender is not the lead', () => {
    expect(() => assertSenderIsLead('user', 'lead')).toThrow(
      'Direct user-to-teammate communication is not allowed'
    );
  });

  it('assertSenderIsLead passes when sender is the lead', () => {
    expect(() => assertSenderIsLead('lead', 'lead')).not.toThrow();
  });
});

describe('all instructions to teammates are routed through the Lead', () => {
  it('relayInstructionThroughLead sends message from lead', async () => {
    const msg = await relayInstructionThroughLead(
      teamName,
      'lead',
      'tm-1',
      'Please focus on TASK-3'
    );

    expect(msg.from).toBe('lead');
    expect(msg.to).toBe('tm-1');
    expect(msg.body).toBe('Please focus on TASK-3');

    const allMsgs = readAllMessages(teamName);
    expect(allMsgs).toHaveLength(1);
    expect(allMsgs[0].from).toBe('lead');
  });

  it('broadcastInstructionFromLead broadcasts from lead', async () => {
    const msg = await broadcastInstructionFromLead(
      teamName,
      'lead',
      'Sprint review in 5 minutes'
    );

    expect(msg.from).toBe('lead');
    expect(msg.to).toBe('BROADCAST');

    const allMsgs = readAllMessages(teamName);
    expect(allMsgs).toHaveLength(1);
  });
});
