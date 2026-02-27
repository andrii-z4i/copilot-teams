/**
 * Mailbox messaging system — append-only, Lead-mediated inter-agent communication.
 *
 * The Team Lead is the ONLY writer to the messages file (single-writer invariant).
 * Teammates request the Lead to send messages on their behalf.
 */

import fs from 'node:fs';
import { resolveTeamFile, appendFile, withLock, ensureDir } from '../utils/index.js';
import type { Message } from '../types.js';
import path from 'node:path';

// ── Message Format ──
// [Timestamp] [MSG-ID] [FromID] [ToID|BROADCAST] Body

const MESSAGE_PATTERN =
  /^\[([^\]]+)\] \[MSG-(\d+)\] \[([^\]]+)\] \[([^\]]+)\] (.+)$/;

// ── Internal State ──

/** Track the next message ID per team (in-memory monotonic counter). */
const messageCounters = new Map<string, number>();

/**
 * Get the next message ID for a team, initializing from file if needed.
 */
function getNextMessageId(teamId: string): number {
  if (messageCounters.has(teamId)) {
    const next = messageCounters.get(teamId)! + 1;
    messageCounters.set(teamId, next);
    return next;
  }

  // Initialize from file
  const messages = readAllMessages(teamId);
  const maxId = messages.reduce((max, m) => Math.max(max, m.id), 0);
  const next = maxId + 1;
  messageCounters.set(teamId, next);
  return next;
}

/**
 * Reset counter for a team (useful for testing).
 */
export function resetMessageCounter(teamId: string): void {
  messageCounters.delete(teamId);
}

// ── Message Parsing ──

function parseMessageLine(line: string): Message | null {
  const match = line.match(MESSAGE_PATTERN);
  if (!match) return null;
  return {
    timestamp: match[1],
    id: parseInt(match[2], 10),
    from: match[3],
    to: match[4],
    body: match[5],
  };
}

function formatMessage(msg: Message): string {
  return `[${msg.timestamp}] [MSG-${String(msg.id).padStart(3, '0')}] [${msg.from}] [${msg.to}] ${msg.body}`;
}

// ── Core Operations ──

/**
 * Append a message to the team's messages file (Lead-only).
 * Enforces single-writer invariant via caller validation.
 */
export async function appendMessage(
  teamId: string,
  from: string,
  to: string,
  body: string,
  _isLead: boolean = true,
): Promise<Message> {
  if (!_isLead) {
    throw new Error(
      'Only the Team Lead can write messages. ' +
        'Teammates must request the Lead to send messages on their behalf.',
    );
  }

  const messagesPath = resolveTeamFile(teamId, 'messages');

  // Sanitize body: replace newlines with spaces to prevent message injection
  const sanitizedBody = body.replace(/[\r\n]+/g, ' ');

  return withLock(messagesPath, () => {
    const id = getNextMessageId(teamId);
    const timestamp = new Date().toISOString();

    const message: Message = { id, timestamp, from, to, body: sanitizedBody };
    const line = formatMessage(message) + '\n';

    ensureDir(path.dirname(messagesPath));
    appendFile(messagesPath, line);

    return message;
  });
}

/**
 * Read all messages from the team's messages file.
 */
export function readAllMessages(teamId: string): Message[] {
  const messagesPath = resolveTeamFile(teamId, 'messages');
  if (!fs.existsSync(messagesPath)) return [];

  const content = fs.readFileSync(messagesPath, 'utf-8');
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(parseMessageLine)
    .filter((m): m is Message => m !== null);
}

/**
 * Read messages for a specific recipient (direct or broadcast).
 * Supports cursor-based reading via sinceId.
 */
export function readMessages(
  teamId: string,
  recipientId: string,
  sinceId?: number,
): Message[] {
  const all = readAllMessages(teamId);
  return all.filter((m) => {
    // Filter by recipient: direct message or broadcast
    const isForRecipient = m.to === recipientId || m.to === 'BROADCAST';
    // Filter by cursor
    const isAfterCursor = sinceId === undefined || m.id > sinceId;
    return isForRecipient && isAfterCursor;
  });
}

/**
 * Send a direct message from one member to another (Lead-mediated).
 */
export async function sendMessage(
  teamId: string,
  from: string,
  to: string,
  body: string,
): Promise<Message> {
  return appendMessage(teamId, from, to, body, true);
}

/**
 * Broadcast a message to all team members (Lead-mediated).
 * Logs a cost warning for large teams.
 */
export async function broadcastMessage(
  teamId: string,
  from: string,
  body: string,
  teamSize?: number,
): Promise<{ message: Message; costWarning?: string }> {
  let costWarning: string | undefined;
  if (teamSize !== undefined && teamSize > 3) {
    costWarning =
      `Broadcasting to ${teamSize} teammates. ` +
      'Each teammate will process this message in their context window, ' +
      'increasing token usage proportionally.';
  }

  const message = await appendMessage(teamId, from, 'BROADCAST', body, true);
  return { message, costWarning };
}

/**
 * Record an idle notification from a teammate (Lead-mediated, CM-6).
 */
export async function notifyLeadIdle(
  teamId: string,
  teammateName: string,
): Promise<Message> {
  return appendMessage(
    teamId,
    teammateName,
    'lead',
    `[IDLE] Teammate ${teammateName} has finished all tasks and is now idle.`,
    true,
  );
}

// ── File Watcher for Push Delivery ──

export type MessageCallback = (messages: Message[]) => void;

interface WatcherState {
  watcher: fs.FSWatcher;
  lastId: number;
  callbacks: Map<string, MessageCallback>;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

const watchers = new Map<string, WatcherState>();

/**
 * Watch the messages file for new entries and trigger callbacks (CM-5, CM-7).
 * Push-based delivery — no polling required.
 */
export function watchMessages(
  teamId: string,
  recipientId: string,
  callback: MessageCallback,
): () => void {
  const messagesPath = resolveTeamFile(teamId, 'messages');
  ensureDir(path.dirname(messagesPath));

  // Ensure file exists for watcher
  if (!fs.existsSync(messagesPath)) {
    fs.writeFileSync(messagesPath, '', 'utf-8');
  }

  let state = watchers.get(teamId);

  if (!state) {
    const existingMessages = readAllMessages(teamId);
    const lastId = existingMessages.reduce((max, m) => Math.max(max, m.id), 0);

    const watcher = fs.watch(messagesPath, () => {
      const st = watchers.get(teamId);
      if (st?.debounceTimer) clearTimeout(st.debounceTimer);
      const timer = setTimeout(() => {
        const currentState = watchers.get(teamId);
        if (!currentState) return;

        const newMessages = readAllMessages(teamId).filter(
          (m) => m.id > currentState.lastId,
        );
        if (newMessages.length === 0) return;

        currentState.lastId = Math.max(...newMessages.map((m) => m.id));

        for (const [rid, cb] of currentState.callbacks) {
          const relevant = newMessages.filter(
            (m) => m.to === rid || m.to === 'BROADCAST',
          );
          if (relevant.length > 0) cb(relevant);
        }
      }, 50);
      const st2 = watchers.get(teamId);
      if (st2) st2.debounceTimer = timer;
    });

    state = { watcher, lastId, callbacks: new Map(), debounceTimer: null };
    watchers.set(teamId, state);
  }

  state.callbacks.set(recipientId, callback);

  // Return unsubscribe function
  return () => {
    const s = watchers.get(teamId);
    if (!s) return;
    s.callbacks.delete(recipientId);
    if (s.callbacks.size === 0) {
      if (s.debounceTimer) clearTimeout(s.debounceTimer);
      s.watcher.close();
      watchers.delete(teamId);
    }
  };
}

/**
 * Stop all watchers for a team.
 */
export function stopWatching(teamId: string): void {
  const state = watchers.get(teamId);
  if (state) {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.watcher.close();
    watchers.delete(teamId);
  }
}
