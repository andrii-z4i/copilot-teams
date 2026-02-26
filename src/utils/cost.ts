/**
 * Token & cost efficiency (R19).
 *
 * Cost awareness warnings and team size validation.
 * NF-1: Document token scaling.
 * NF-2: Warn before creating large teams.
 * NF-3: Broadcast cost warning (already in comms module).
 */

// ── Constants ──

const LARGE_TEAM_THRESHOLD = 5;

// ── Token usage documentation (NF-1) ──

export const TOKEN_USAGE_NOTICE = `
Token Usage Notice
==================
Each active teammate runs its own Copilot CLI instance with a separate
context window. Token usage scales linearly with the number of active
teammates:

  Total tokens ≈ (N teammates + 1 lead) × tokens per session

Broadcast messages are duplicated to every teammate, further increasing
token consumption proportional to team size.

Recommendations:
  • Keep teams small (2–5 teammates) for cost efficiency.
  • Use targeted messages instead of broadcasts when possible.
  • Close sprints and stop idle teammates promptly.
`.trim();

// ── Team size warning (NF-2) ──

export interface TeamSizeWarning {
  warn: boolean;
  message: string | null;
  requestedSize: number;
  threshold: number;
}

/**
 * Check if the requested team size exceeds the warning threshold.
 * Returns a warning object; callers should prompt the user for
 * confirmation before proceeding if `warn` is true.
 */
export function warnTeamSize(teammateCount: number): TeamSizeWarning {
  if (teammateCount > LARGE_TEAM_THRESHOLD) {
    return {
      warn: true,
      message:
        `Warning: You are about to create a team with ${teammateCount} teammates. ` +
        `Teams larger than ${LARGE_TEAM_THRESHOLD} significantly increase token usage ` +
        `and cost. Each teammate runs its own context window. ` +
        `Please confirm you want to proceed.`,
      requestedSize: teammateCount,
      threshold: LARGE_TEAM_THRESHOLD,
    };
  }

  return {
    warn: false,
    message: null,
    requestedSize: teammateCount,
    threshold: LARGE_TEAM_THRESHOLD,
  };
}

/**
 * Get the large team threshold.
 */
export function getLargeTeamThreshold(): number {
  return LARGE_TEAM_THRESHOLD;
}
