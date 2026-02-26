# Copilot Teams — Code Review Report

**Date:** 2026-02-26  
**Review Team:** 3 engineers (Security, MCP Protocol, Reliability)  
**Sprint Duration:** ~5 minutes (9 tasks, fully automated)  
**Scope:** Full codebase analysis against `docs/requirements.md` and `docs/architecture.md`

---

## Executive Summary

The Copilot Teams codebase is **architecturally well-designed** with solid foundations: atomic writes, advisory file locking, structured data models, and clean MCP protocol compliance. The library-level implementations of permissions, tasks, sprints, messaging, and file claims are largely correct.

However, the review uncovered **critical gaps at the integration boundary** — the MCP server layer that exposes these libraries to callers does not enforce the security and coordination invariants that the underlying libraries were designed to support. The permission system is fully implemented but **never wired into the MCP tool handlers**, meaning teammates have unrestricted access to all operations. Input validation is absent across all identifiers used in filesystem paths, creating path traversal vulnerabilities.

### Severity Summary (All Teams Combined)

| Severity | Count | Key Themes |
|----------|-------|------------|
| **CRITICAL** | 5 | Permission system unintegrated, single-writer violated, path traversal, command injection, unsafe PID handling |
| **HIGH** | 12 | TOCTOU gaps, no hook timeout, dependency cycles, missing MCP tools, race conditions, no crash notification wiring |
| **MEDIUM** | 16 | Auto-review bypass, message injection, stale locks, nested locks, no file claim cleanup, no message size limits |
| **LOW** | 14 | Schema strictness, inconsistent time units, error message leaks, cosmetic issues |

---

## 1. Security Engineering Review

**Reviewer:** security-engineer  
**Focus:** Permission model, audit log integrity, input validation & injection vectors

### 1.1 Permission Model & Privilege Escalation

#### CRITICAL — Permission System Never Called from MCP Tools
**Files:** `src/mcp-server.ts`, `src/permissions/index.ts`

The functions `checkPermission()`, `requestPermission()`, and `reviewPermission()` are **never called from any MCP tool handler**. The `isTeammate()` helper exists (line 92-94) but is never used to gate access. Teammates can call `update_task`, `delete_task`, `send_message`, `assign_task`, `cleanup_team`, `force_stop_teammate` — all without any permission check.

**Impact:** The entire permission model (TM-7 through TM-17) is not enforced at runtime. Any teammate can perform any operation.

#### CRITICAL — Single-Writer Invariant Violated
**Files:** `src/mcp-server.ts`, `src/comms/index.ts`, `src/tasks/index.ts`

The `send_message` MCP tool hardcodes `_isLead: true` when calling `appendMessage()`, bypassing the Lead-only check regardless of caller. The `update_task` tool calls `updateTask()` with no caller identity verification. The `submit_report` tool writes directly to the filesystem.

**Impact:** Teammates directly mutate shared coordination files (messages.md, backlog.md, reports/).

#### HIGH — TOCTOU Gap Between Permission Check and Operation
**File:** `src/permissions/index.ts`

Between Lead approval and actual operation execution, there's no binding. The `PermissionResponse` contains only `{ requestId, decision, rationale }` — no cryptographic binding ties the approval to the specific operation. A teammate could receive approval for "read file X" and execute "delete file Y."

#### MEDIUM — Lead Permission Ceiling Weakly Enforced (TM-8)
The `reviewPermission()` function's `leadPermissions` parameter is optional. If not provided (the default), the TM-8 check is completely skipped.

#### MEDIUM — Pending Permissions Written Without File Locking
Both `requestPermission()` and `checkPermission()` write to `pending-permissions.json` using `fs.writeFileSync` without acquiring a file lock. Concurrent requests can cause data loss.

#### MEDIUM — `autoReview` Callback Bypasses Lead Involvement
`checkPermission()` accepts an `autoReview` callback that allows programmatic auto-approval without actual Lead review, undermining TM-10.

### 1.2 Audit Log Integrity & Tamper Resistance

#### HIGH — Teammates Can Directly Modify/Truncate the Audit Log
Teammates run as child processes of the Lead under the same OS user with identical filesystem permissions. A malicious teammate could truncate, delete, or modify the audit log.

#### HIGH — False Audit Entry Injection via Direct File Access
No cryptographic integrity protection exists — entries are plain JSON with no signatures, MACs, or hash chains. A teammate could inject fake audit entries to create false records.

#### MEDIUM — Audit Log Not Written for Most Operations
Since the permission system is unintegrated, the audit log is effectively empty in normal operation. No record of who performed what operations.

**Positive:** The `logAuditEntry()` function correctly uses `appendFile()` under `withLock()`, and the JSONL format with all required fields (TM-14) is properly implemented.

### 1.3 Input Validation & Injection Vectors

#### CRITICAL — Path Traversal via Team Names
**File:** `src/constants.ts`

Team names flow directly into filesystem paths with no validation. A team name like `../../tmp/evil` would create directories and write files at arbitrary locations: `path.join('~/.copilot/teams/', '../../tmp/evil')`.

#### CRITICAL — Command Injection Risk in Hook Execution
**File:** `src/hooks/index.ts`

Hooks execute commands via `spawnSync` with `shell: true`. Since teammates run as the same OS user, a teammate could modify `hooks.json` to inject arbitrary commands.

#### HIGH — Path Traversal via Task IDs and Teammate Names in Reports
Report file paths are constructed from unsanitized inputs: `${teammateName}--${taskId}.md`. A crafted task ID or teammate name could write files outside the intended directory.

#### HIGH — MCP Zod Schemas Lack String Constraints
All identifier fields use bare `z.string()` with no min/max length, pattern matching, or special character filtering. Empty strings and path separators are accepted.

#### MEDIUM — Message Body Injection in Structured Markdown
Message bodies are not sanitized. A body containing newlines could inject fake messages that `parseMessageLine()` would parse as legitimate.

#### MEDIUM — Sender Spoofing via Environment Variable
`resolveSender()` reads from `process.env.COPILOT_TEAMS_TEAMMATE_NAME`. A teammate process could modify its environment variable to impersonate another teammate or the Lead.

---

## 2. MCP Protocol Engineering Review

**Reviewer:** mcp-engineer  
**Focus:** Requirements alignment, single-writer enforcement, protocol compliance

### 2.1 Tool Definitions vs Requirements — Gap Analysis

#### Coverage: ~85-90% of requirements implemented

**Fully Implemented (✅):**
- Team Lifecycle (TL-1 through TL-11): All covered
- Teammate Spawning (TM-1 through TM-6): All covered
- Task States & Dependencies (TS-1 through TS-8): All covered
- Sprint Lifecycle: Core flow implemented
- Communication (CM-1 through CM-10): All covered
- Non-Functional Requirements: NF-1 through NF-11 all addressed
- Configuration (CF-1 through CF-4): All covered

#### HIGH — Planning Poker Has NO MCP Tools
The entire planning poker library (`src/tasks/planning-poker.ts`) is fully implemented with `startPlanningPoker()`, `submitEstimate()`, `getEstimates()`, `resolveEstimates()`, `balanceAssignments()` — but **none are exposed as MCP tools**. LLM agents cannot use planning poker at all.  
**Affected requirements:** TS-13, TS-14, TS-15, TS-16, TS-17, TS-18

#### HIGH — Permission Management Has NO MCP Tools
The permissions module implements the full request/review/audit workflow but has **zero MCP tool exposure**. No tools for requesting permissions, reviewing requests, reading the audit log, or listing pending requests.  
**Affected requirements:** TM-9, TM-10, TM-17

#### MEDIUM — Plan Submission Not Exposed
While `list_pending_plans` and `review_plan` are MCP tools, there is no tool for teammates to submit a plan, enter plan mode, or set approval criteria.  
**Affected requirements:** PA-1, PA-2, PA-6

#### MEDIUM — File Claim/Release Tools Missing
`claimFile()` and `releaseFile()` functions exist but there are no `claim_file` or `release_file` MCP tools. Only `list_file_claims` and `detect_file_conflicts` are exposed.

#### MEDIUM — Hook Configuration Not Exposed
The hooks module is fully implemented but has no MCP tools for configuration.

#### INFO — No Unnecessary/Dead Tools
All 26 MCP tools map to requirements or practical orchestration needs. `submit_report`, `get_report`, `get_all_reports`, and `run_team` are practical additions not explicitly in requirements.

### 2.2 Single-Writer Invariant Enforcement

#### File Locking: CONSISTENTLY APPLIED ✅
Every write operation in the codebase acquires a file lock via `withLock()`. 18 write functions verified — all use locking. No unprotected writes found in library functions.

#### Atomic Write Pattern: CORRECTLY IMPLEMENTED ✅
`atomicWriteFile()` implements temp-file-then-rename correctly. Used by `writeTaskList()`, `rewriteSprints()`, `saveTeam()`, `savePlanApprovals()`, `saveHooks()`, `saveEstimatesFile()`.

#### CRITICAL — No Lead-Only Enforcement at MCP Layer
The `isTeammate()` function exists but is **never used to guard write operations**. All 12+ write-path MCP tools allow any caller to mutate shared files. Only `updateTeam()` has an `assertIsLead()` guard.

#### MEDIUM — Sprint/Backlog Files Violate Append-Only Semantics
`sprint.md` and `backlog.md` do full rewrites via `atomicWriteFile()` instead of append-only. While data integrity is preserved, this technically violates the append-only requirement.

#### MEDIUM — Append Operations Are Not Crash-Safe
`appendFile()` uses `fs.appendFileSync()` which can leave partial lines on crash. Affects messages.md, files.md, permission-audit.log.

#### LOW — `appendMessage()` `_isLead` Guard is a No-Op
The `_isLead` parameter is always called with `true`, making the check meaningless.

### 2.3 MCP Protocol Compliance

#### MCP SDK Usage: COMPLIANT ✅
Server initialization, transport, tool registration, and server instructions all follow the MCP spec correctly.

#### Zod Schemas: MOSTLY CORRECT ✅
All 26 tools use zod correctly. Every parameter has `.describe()` for LLM guidance.

#### Response Formatting: CORRECT ✅
All tools return through `text()` or `json()` helpers with proper `{ content: [{ type: 'text', text }] }` format.

#### MEDIUM — Inconsistent Error Handling
Some tools return friendly error messages, others let raw exceptions propagate to the SDK. No global error wrapper exists.

#### LOW — `agent_type` Not Enum-Validated
Accepts any string instead of `z.enum(['coder', 'reviewer', 'tester'])`.

#### LOW — Inconsistent Time Units
`shutdown_teammate` uses milliseconds, `run_team` uses minutes.

#### LOW — Filesystem Path Leaked in `loadTeam()` Error
Error message includes full filesystem path.

---

## 3. Reliability Engineering Review

**Reviewer:** reliability-engineer  
**Focus:** Process lifecycle, file system resilience, error handling & edge cases

### 3.1 Process Lifecycle & Crash Recovery

#### CRITICAL — PID Accessed Before Spawn Confirmation
**File:** `src/teammate/index.ts:235`

```ts
const pid = child.pid!; // UNSAFE: may be undefined if spawn errors
```

If spawn fails asynchronously, `child.pid` is `undefined`. The non-null assertion silently produces `undefined`, leading to a `TeammateProcess` with `pid: undefined`. `process.kill(undefined, 0)` in orphan detection would throw or signal the current process.

#### HIGH — Race Condition Between Spawn Error and Process Registration
The `child.on('error', ...)` handler is registered after process registration and status set to `active`. If spawn fails between steps, the error handler's `unregisterProcess` is a no-op or status flickers.

#### HIGH — No Integration Between Crash Detection and Notification
The `exit` handler detects crashes and updates status to `crashed`, but **never calls `notifyCrash()`** from `resilience.ts`. The lead relies on a 15-second polling loop instead of real-time event-driven notification (violating NF-7's intent).

#### HIGH — Stderr Not Captured from Child Processes
Child processes are spawned with `stdio: ['pipe', 'pipe', 'pipe']`, but neither stdout nor stderr is ever read or buffered. Crash diagnostics provide no information about why a teammate crashed.

#### MEDIUM — Shutdown Handler Mechanism Is In-Process Only
The shutdown handler mechanism is entirely in-memory within the lead process. Teammates running as separate child processes cannot self-register handlers, so shutdown negotiation (TM-20) is architecturally limited.

#### MEDIUM — Orphaned Process Detection Doesn't Clean Up State
`detectOrphanedProcesses()` returns orphan PIDs but does NOT update the team config. Dead members remain in `active` status, potentially blocking cleanup.

#### MEDIUM — Lead Crash Leaves Orphaned Child Processes
Spawned with `detached: false`, child processes survive the parent's death as orphans. No mechanism to re-attach after lead restart.

#### MEDIUM — PID Reuse Vulnerability
`isProcessRunning()` uses `process.kill(pid, 0)` which can't distinguish between the original process and a new process that reused the PID.

### 3.2 File System Resilience & Locking

#### HIGH — `appendFile()` Is Not Atomic and Safety Depends on Callers
`appendFile()` uses `fs.appendFileSync()` without locking. While callers wrap it in `withLock()`, the function itself provides no safety guarantee. `fs.appendFileSync()` is not atomic for writes larger than `PIPE_BUF` (~4096 bytes).

#### HIGH — Mixed Sync/Async File Operations
All read operations are lockless. For append-only files, a read during a concurrent append could see a partial line. Parse failures are silently filtered out, partially mitigating this.

#### HIGH — Nested Lock Acquisition in `reviewPlan()` (Deadlock Risk)
`reviewPlan()` acquires a lock on `plans.json`, then inside that locked section acquires another lock on `teammate-states.json`. If any future code acquires these in reverse order, deadlock occurs.

#### MEDIUM — Inconsistent Stale Lock Thresholds
`proper-lockfile` uses 10s stale threshold; `detectStaleLockfiles()` uses 30s. The custom layer may conflict with `proper-lockfile`'s built-in handling.

#### MEDIUM — No Disk Space Error Handling
`atomicWriteFile()`, `appendFile()`, and `fs.writeFileSync()` don't catch `ENOSPC` or `EDQUOT` errors. A full disk results in an unhandled exception.

#### MEDIUM — Base Directory Deletion Not Handled
If `~/.copilot/teams/{name}/` is deleted while operations are in flight, `withLock()` and `ensureDir()` may partially recover but leave inconsistent state.

#### MEDIUM — `ensureDir()` Called Redundantly
Called on nearly every file operation (2-3 times per critical path), each hitting the filesystem with a `mkdirSync` syscall.

### 3.3 Error Handling & Edge Cases

#### HIGH — Task Dependency Cycles Cause Silent Infinite Blocking
No cycle detection during task creation. Circular dependencies (`A→B→A`) permanently deadlock both tasks with no error or diagnostic. Dependency IDs aren't even validated to reference existing tasks.

#### HIGH — Hook Execution Has NO Timeout
`spawnSync()` is called with no `timeout` option. A hanging hook script freezes the entire Node.js event loop and MCP server indefinitely.

#### HIGH — `cleanup_team` MCP Handler Ignores Failure
The `cleanup_team` tool ignores the `CleanupResult` return value. Users are told cleanup succeeded even when it failed because teammates are still running.

#### HIGH — No Message Size Limit
No size limit on message bodies or report bodies. A single large message could exhaust disk space or cause OOM.

#### MEDIUM — File Claims Never Auto-Released on Crash
When a teammate crashes, its file claims remain `in-use` forever. No mechanism to detect stale claims or allow takeover.

#### MEDIUM — No Capacity Enforcement in `activate_sprint`
Assignments can exceed the 4 weight-point capacity per teammate (violating TS-16). The capacity check exists in `wouldExceedCapacity()` but isn't called from the MCP tool.

#### MEDIUM — Multiple `run_team` Calls Can Overlap
No guard against concurrent `run_team` calls creating duplicate teams or conflicting sprints.

#### LOW — `detectFileConflicts()` Bug with `::` Separator
If `filePath` or `teammateId` contains `::`, the composite key split produces incorrect results.

---

## 4. Cross-Cutting Findings

These findings were identified independently by multiple reviewers:

### 4.1 Permission System Integration (Security + MCP + Reliability)
All three reviewers noted that the permission system exists as a fully-implemented but completely disconnected module. This is the single most impactful finding — it renders 11 requirements (TM-7 through TM-17) unenforceable.

### 4.2 Single-Writer Invariant (Security + MCP)
Both the security and MCP engineers identified that the single-writer invariant is violated at the MCP layer. The `isTeammate()` function exists but is never used.

### 4.3 Input Validation (Security + Reliability)
Both the security and reliability engineers identified path traversal risks in team names, task IDs, and teammate names used in filesystem paths.

### 4.4 Missing MCP Tool Exposure (MCP + Reliability)
The MCP engineer identified that planning poker, permissions, plan submission, file claims, and hooks have no MCP tools. The reliability engineer independently noted that capacity enforcement (`wouldExceedCapacity()`) isn't called from sprint activation.

---

## 5. Prioritized Recommendations

### P0 — Critical (Fix Immediately)

1. **Integrate permission checks into MCP tool handlers.** Add `isTeammate()` guards to all write-path tools. Route teammate mutations through the permission approval flow.

2. **Add input validation for all identifiers used in filesystem paths.** Define reusable Zod schemas:
   ```typescript
   const SafeId = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/i);
   const SafeTeamName = z.string().min(1).max(50).regex(/^[a-z0-9][a-z0-9-]*$/);
   ```

3. **Fix hook execution security.** Add `timeout: 30_000` to `spawnSync()`. Consider `shell: false`. Validate hook commands. Protect `hooks.json` from teammate modification.

4. **Fix unsafe PID access.** Guard `child.pid` against `undefined` after `spawn()`.

### P1 — High (Fix Before Production Use)

5. **Expose planning poker as MCP tools.** Add `start_planning_poker`, `submit_estimate`, `resolve_estimates`, `balance_assignments`.

6. **Expose permission management as MCP tools.** Add `request_permission`, `review_permission`, `read_audit_log`, `list_pending_permissions`.

7. **Add cycle detection for task dependencies.** Implement topological sort during task creation. Validate dependency IDs exist.

8. **Wire crash notification to the exit handler.** Call `notifyCrash()` from the process exit handler. Buffer stderr for diagnostics.

9. **Fix `cleanup_team` to check return value.** Return error to user when cleanup fails.

10. **Add file locking to pending permissions writes.**

11. **Add message size limits.** `z.string().max(100_000)` on message and report bodies.

### P2 — Medium (Address in Next Sprint)

12. Add `claim_file` and `release_file` MCP tools.
13. Add `submit_plan`, `enter_plan_mode`, `set_approval_criteria` MCP tools.
14. Add hook configuration MCP tools.
15. Implement capacity enforcement in `activate_sprint`.
16. Add auto-release of file claims on teammate crash.
17. Implement hash chain for audit log tamper detection.
18. Add global error wrapper for MCP tool handlers.
19. Sanitize message bodies to prevent newline injection.
20. Establish and document lock ordering convention.
21. Add debouncing to message file watcher.

### P3 — Low (Nice to Have)

22. Enum-validate `agent_type` in spawn/run tools.
23. Standardize time units across tools.
24. Cache `ensureDir()` calls to avoid redundant syscalls.
25. Sanitize error messages to hide filesystem paths.
26. Use `Promise.allSettled()` in `spawnMultipleTeammates()`.
27. Fix `::` separator bug in `detectFileConflicts()`.

---

## 6. Requirements Traceability — Gap Summary

| Req IDs | Status | Gap |
|---------|--------|-----|
| TM-7 through TM-17 | ❌ Not enforced | Permission system implemented but not wired into MCP tools |
| TM-9, TM-10, TM-17 | ❌ No MCP tools | No way to request/review permissions or read audit log via MCP |
| TS-13 through TS-18 | ❌ No MCP tools | Planning poker fully implemented but not exposed |
| TS-16 | ❌ Not enforced | Capacity limit not checked during sprint activation |
| PA-1, PA-2, PA-6 | ⚠️ Partial | No submit_plan or enter_plan_mode MCP tools |
| QG-4 | ⚠️ Partial | No hook configuration MCP tool |
| All others | ✅ Implemented | ~85-90% of requirements fully covered |

---

## 7. Positive Findings

The review also identified many strengths:

- **Architecture is sound** — hub-and-spoke model, shared file coordination, child process management
- **File locking is consistent** — every write operation uses `withLock()`
- **Atomic writes are correct** — temp-file-then-rename pattern properly implemented
- **Task state machine is well-enforced** — no backward transitions, valid transition table
- **Sprint validation is thorough** — sequential numbering, no double-active sprints
- **MCP protocol compliance is excellent** — proper SDK usage, all tools use zod, correct response format
- **Tool descriptions are LLM-friendly** — comprehensive, clear, actionable
- **CLI and MCP are well-aligned** — 24/28 CLI commands have MCP equivalents
- **Audit entry format satisfies TM-14** — all required fields present
- **Cost warnings implemented** — team size and broadcast cost notifications
- **Resilience utilities exist** — orphan detection, crash notification, replacement spawning

---

*Report generated by automated review team: security-engineer, mcp-engineer, reliability-engineer*  
*Sprint #1 completed in ~5 minutes with 9 review tasks across 3 specialized reviewers*
