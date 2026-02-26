/**
 * User–Teammate visibility layer (R18).
 *
 * Provides read-only viewing of teammate output and enforces that all
 * control/instructions go through the Team Lead (CM-8, CM-9, CM-10).
 */

import type { Message } from '../types.js';
import { sendMessage, broadcastMessage } from '../comms/index.js';

// ── Types ──

export interface TeammateOutput {
  teammateName: string;
  lines: string[];
}

// ── Output buffer (read-only viewing) ──

/**
 * Manages read-only output buffers for all teammates.
 * The user can view output but cannot type input directly to teammates.
 */
export class TeammateOutputViewer {
  private buffers: Map<string, string[]> = new Map();
  private readOnly = true;

  /** Append output from a teammate (called by the system, not the user). */
  appendOutput(teammateName: string, line: string): void {
    if (!this.buffers.has(teammateName)) {
      this.buffers.set(teammateName, []);
    }
    this.buffers.get(teammateName)!.push(line);
  }

  /** Get all output for a teammate (read-only view). */
  getOutput(teammateName: string): string[] {
    return [...(this.buffers.get(teammateName) ?? [])];
  }

  /** Get all teammate names with output. */
  getTeammateNames(): string[] {
    return [...this.buffers.keys()];
  }

  /** Check if viewing is read-only (always true — user cannot send input). */
  isReadOnly(): boolean {
    return this.readOnly;
  }

  /** Clear output for a teammate. */
  clearOutput(teammateName: string): void {
    this.buffers.set(teammateName, []);
  }
}

// ── Lead-mediated communication enforcement ──

/**
 * Route an instruction from the user to a teammate through the Lead.
 * The user MUST NOT communicate directly with teammates (CM-8).
 *
 * @param teamName - The team
 * @param leadName - The Lead's name (sender)
 * @param teammateName - Target teammate
 * @param instruction - The instruction text
 */
export async function relayInstructionThroughLead(
  teamName: string,
  leadName: string,
  teammateName: string,
  instruction: string
): Promise<Message> {
  return sendMessage(teamName, leadName, teammateName, instruction);
}

/**
 * Validate that a message sender is the Lead, not a direct user-to-teammate
 * communication. Returns true if the sender is the lead.
 */
export function assertSenderIsLead(
  senderName: string,
  leadName: string
): void {
  if (senderName !== leadName) {
    throw new Error(
      `Direct user-to-teammate communication is not allowed. ` +
        `All instructions must go through the Team Lead (${leadName}).`
    );
  }
}

/**
 * Broadcast an instruction from the Lead to all teammates.
 */
export async function broadcastInstructionFromLead(
  teamName: string,
  leadName: string,
  instruction: string
): Promise<Message> {
  const result = await broadcastMessage(teamName, leadName, instruction);
  return result.message;
}
