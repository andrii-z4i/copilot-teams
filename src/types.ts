/**
 * Shared type definitions for Copilot Teams.
 */

// ── Team Config ──

export type MemberStatus = 'spawning' | 'active' | 'idle' | 'stopped' | 'crashed';

export interface TeamMember {
  name: string;
  agentId: string;
  agentType: string;
  status: MemberStatus;
  pid?: number;
  model?: string;
}

export interface TeamConfig {
  teamId: string;
  teamName: string;
  leadSessionId: string;
  createdAt: string;
  members: TeamMember[];
}

// ── Tasks ──

export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type ComplexitySize = 'S' | 'M' | 'L' | 'XL';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee?: string;
  dependencies: string[];
  complexity?: ComplexitySize;
  createdAt: string;
  updatedAt: string;
}

// ── Messages ──

export interface Message {
  id: number;
  timestamp: string;
  from: string;
  to: string; // teammate name or 'BROADCAST'
  body: string;
}

// ── Permissions ──

export interface PermissionRequest {
  id: string;
  teammateName: string;
  operation: string;
  description: string;
  targetResource: string;
  timestamp: string;
}

export interface PermissionResponse {
  requestId: string;
  decision: 'approved' | 'denied';
  rationale?: string;
}

export interface PermissionAuditEntry {
  timestamp: string;
  teammate: string;
  operation: string;
  target: string;
  decision: 'approved' | 'denied';
  rationale?: string;
}

// ── Sprint ──

export type SprintStatus = 'planning' | 'active' | 'closed';

export interface SprintAssignment {
  teammate: string;
  taskId: string;
  taskTitle: string;
  estimate: ComplexitySize;
}

export interface Sprint {
  number: number;
  status: SprintStatus;
  startedAt: string;
  closedAt: string | null;
  assignments: SprintAssignment[];
}

// ── File Claims ──

export type FileClaimStatus = 'in-use' | 'free';

export interface FileClaim {
  timestamp: string;
  teammateId: string;
  taskId: string;
  filePath: string;
  status: FileClaimStatus;
}

// ── Hooks ──

export type HookEvent = 'TeammateIdle' | 'TaskCompleted';

export interface HookConfig {
  event: HookEvent;
  command: string;
  workingDir?: string;
}

// ── Configuration ──

export type TeammateMode = 'auto' | 'in-process' | 'tmux';

export interface CopilotTeamsConfig {
  enabled: boolean;
  teammateMode: TeammateMode;
}
