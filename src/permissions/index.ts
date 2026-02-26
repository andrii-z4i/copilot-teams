/**
 * Permission model — least-privilege, single-use approval flow with audit log.
 *
 * Teammates start with minimum permissions. Every privileged operation requires
 * a fresh, single-use approval from the Team Lead. All requests and decisions
 * are logged to an append-only audit trail.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import lockfile from 'proper-lockfile';
import { resolveTeamFile, appendFile, withLock, ensureDir } from '../utils/index.js';
import type { PermissionRequest, PermissionResponse, PermissionAuditEntry } from '../types.js';

// Synchronous lock helper for use in synchronous contexts (e.g., Promise constructors)
function withLockSync<T>(filePath: string, fn: () => T): T {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf-8');
  }
  lockfile.lockSync(filePath);
  try {
    return fn();
  } finally {
    lockfile.unlockSync(filePath);
  }
}

// ── Pending Requests ──

type PermissionResolver = (response: PermissionResponse) => void;
const pendingRequests = new Map<string, PermissionResolver>();

/**
 * Clear all pending requests (for testing).
 */
export function clearPendingRequests(): void {
  pendingRequests.clear();
}

// ── Permission Request Flow ──

/**
 * Generate a unique permission request ID.
 */
function generateRequestId(): string {
  return `perm-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Submit a permission request from a teammate (TM-9).
 * Blocks until the Lead responds with approve/deny (TM-16).
 * Returns the Lead's decision.
 */
export function requestPermission(
  teamName: string,
  teammateName: string,
  operation: string,
  description: string,
  targetResource: string,
): Promise<PermissionResponse> {
  const request: PermissionRequest = {
    id: generateRequestId(),
    teammateName,
    operation,
    description,
    targetResource,
    timestamp: new Date().toISOString(),
  };

  return new Promise<PermissionResponse>((resolve) => {
    // Register pending request — teammate blocks here until Lead responds (TM-16)
    pendingRequests.set(request.id, resolve);

    // Store request in pending file for the Lead to discover
    const pendingPath = resolveTeamFile(teamName, 'messages');
    ensureDir(path.dirname(pendingPath));
    const pendingRequestsPath = path.join(
      path.dirname(resolveTeamFile(teamName, 'config')),
      'pending-permissions.json',
    );
    ensureDir(path.dirname(pendingRequestsPath));

    // Append to pending permissions file (with lock)
    withLockSync(pendingRequestsPath, () => {
      const existing = loadPendingRequests(teamName);
      existing.push(request);
      fs.writeFileSync(pendingRequestsPath, JSON.stringify(existing, null, 2), 'utf-8');
    });
  });
}

/**
 * Load pending permission requests for a team.
 */
export function loadPendingRequests(teamName: string): PermissionRequest[] {
  const pendingPath = path.join(
    path.dirname(resolveTeamFile(teamName, 'config')),
    'pending-permissions.json',
  );
  if (!fs.existsSync(pendingPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(pendingPath, 'utf-8')) as PermissionRequest[];
  } catch {
    return [];
  }
}

/**
 * Remove a request from the pending list.
 */
async function removePendingRequest(teamName: string, requestId: string): Promise<void> {
  const pendingPath = path.join(
    path.dirname(resolveTeamFile(teamName, 'config')),
    'pending-permissions.json',
  );
  await withLock(pendingPath, () => {
    const existing = loadPendingRequests(teamName);
    const filtered = existing.filter((r) => r.id !== requestId);
    fs.writeFileSync(pendingPath, JSON.stringify(filtered, null, 2), 'utf-8');
  });
}

// ── Lead Review ──

/**
 * Lead reviews a permission request and makes a decision (TM-10).
 * Logs the decision to the audit log (TM-13).
 * Resolves the teammate's blocking promise.
 */
export async function reviewPermission(
  teamName: string,
  requestId: string,
  decision: 'approved' | 'denied',
  rationale?: string,
  leadPermissions?: Set<string>,
): Promise<PermissionResponse> {
  // Find the pending request to get details for audit
  const pending = loadPendingRequests(teamName);
  const request = pending.find((r) => r.id === requestId);
  if (!request) {
    throw new Error(`Permission request "${requestId}" not found.`);
  }

  // TM-8: Lead cannot grant permissions beyond its own level
  if (decision === 'approved' && leadPermissions && !leadPermissions.has(request.operation)) {
    throw new Error(
      `Lead cannot grant "${request.operation}" permission — lead does not have this permission itself (TM-8).`,
    );
  }

  const response: PermissionResponse = { requestId, decision, rationale };

  // TM-13: Log to audit trail
  await logAuditEntry(teamName, {
    timestamp: new Date().toISOString(),
    teammate: request.teammateName,
    operation: request.operation,
    target: request.targetResource,
    decision,
    rationale,
  });

  // Remove from pending
  await removePendingRequest(teamName, requestId);

  // Resolve the teammate's blocking promise (TM-16)
  const resolver = pendingRequests.get(requestId);
  if (resolver) {
    resolver(response);
    pendingRequests.delete(requestId);
  }

  return response;
}

// ── Audit Log ──

/**
 * Append an entry to the permission audit log (TM-13, TM-14).
 * Format: one JSON line per entry (JSONL). Append-only (TM-15).
 */
async function logAuditEntry(
  teamName: string,
  entry: PermissionAuditEntry,
): Promise<void> {
  const auditPath = resolveTeamFile(teamName, 'permission-audit');

  await withLock(auditPath, () => {
    appendFile(auditPath, JSON.stringify(entry) + '\n');
  });
}

/**
 * Read the full audit log (TM-17). Available to Lead and user only.
 */
export function readAuditLog(teamName: string): PermissionAuditEntry[] {
  const auditPath = resolveTeamFile(teamName, 'permission-audit');
  if (!fs.existsSync(auditPath)) return [];

  const content = fs.readFileSync(auditPath, 'utf-8');
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as PermissionAuditEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is PermissionAuditEntry => e !== null);
}

// ── Permission Enforcement ──

/**
 * Single-use permission check (TM-11, TM-12).
 * Each call creates a new request — no caching, no reuse.
 * Returns true if approved, false if denied.
 */
export async function checkPermission(
  teamName: string,
  teammateName: string,
  operation: string,
  description: string,
  targetResource: string,
  autoReview?: (request: PermissionRequest) => { decision: 'approved' | 'denied'; rationale?: string },
): Promise<{ approved: boolean; response: PermissionResponse }> {
  const request: PermissionRequest = {
    id: generateRequestId(),
    teammateName,
    operation,
    description,
    targetResource,
    timestamp: new Date().toISOString(),
  };

  if (autoReview) {
    // For programmatic use: Lead auto-reviews immediately
    const { decision, rationale } = autoReview(request);
    const response: PermissionResponse = { requestId: request.id, decision, rationale };

    await logAuditEntry(teamName, {
      timestamp: new Date().toISOString(),
      teammate: teammateName,
      operation,
      target: targetResource,
      decision,
      rationale,
    });

    return { approved: decision === 'approved', response };
  }

  // Store pending request for manual review (with lock)
  const pendingPath = path.join(
    path.dirname(resolveTeamFile(teamName, 'config')),
    'pending-permissions.json',
  );
  ensureDir(path.dirname(pendingPath));
  await withLock(pendingPath, () => {
    const existing = loadPendingRequests(teamName);
    existing.push(request);
    fs.writeFileSync(pendingPath, JSON.stringify(existing, null, 2), 'utf-8');
  });

  // Block until reviewed
  return new Promise<{ approved: boolean; response: PermissionResponse }>((resolve) => {
    pendingRequests.set(request.id, (response) => {
      resolve({ approved: response.decision === 'approved', response });
    });
  });
}

// ── Default Permissions (TM-7) ──

/**
 * Get the default (minimum) permissions for a newly spawned teammate.
 * Teammates start with NO elevated permissions.
 */
export function getDefaultPermissions(): Set<string> {
  return new Set<string>(); // Empty — minimum permissions (TM-7)
}
