# Copilot Teams — Implementation Plan

This document breaks down the requirements from `requirements.md` into discrete implementation units, each with an actionable checklist. The plan is organized in dependency order — foundational modules first, higher-level features later.

---

## Phase 0: Project Scaffolding

Before any feature work, establish the project structure, tooling, and shared infrastructure.

### R0: Project Setup

**Goal:** Initialize the project with build tooling, directory structure, linting, and test infrastructure.

- [ ] Choose runtime and language (TypeScript + Node.js recommended to align with Copilot CLI ecosystem)
- [ ] Initialize package with `package.json`, `tsconfig.json`, ESLint, Prettier
- [ ] Create source directory structure:
  ```
  src/
    config/        # Configuration loading & feature flag
    team/          # Team lifecycle (create, cleanup, constraints)
    teammate/      # Spawning, shutdown, permissions
    tasks/         # Task list, states, assignment, complexity
    comms/         # Mailbox messaging system
    display/       # In-process & split-pane display modes
    hooks/         # Quality gates / lifecycle hooks
    plan/          # Plan approval workflow
    utils/         # File locking, logging, path helpers
  ```
- [ ] Create test directory mirroring `src/` structure
- [ ] Add shared types/interfaces file (`src/types.ts`) for `TeamConfig`, `Task`, `Message`, `PermissionRequest`, etc.
- [ ] Add shared constants file (`src/constants.ts`) for well-known paths (`~/.copilot/teams/`, `~/.copilot/tasks/`), states, sizes
- [ ] Set up unit test runner (Vitest or Jest)
- [ ] Set up integration test harness that can create/cleanup temp directories

**Depends on:** Nothing  
**Requirement IDs:** Foundation for all requirements

---

## Phase 1: Configuration & Local Storage Foundation

### R1: Configuration & Feature Flag

**Goal:** Implement the feature-flag gating and configuration loading so that all subsequent features can check whether Teams is enabled and read display-mode settings.

**Requirement IDs:** CF-1, CF-2, CF-3, CF-4, NF-10, NF-11

- [ ] Define `CopilotTeamsConfig` interface:
  ```ts
  {
    enabled: boolean;
    teammateMode: "auto" | "in-process" | "tmux";
  }
  ```
- [ ] Implement `loadConfig()` that merges (in priority order):
  1. CLI flags (`--teammate-mode <mode>`) — highest priority
  2. Environment variable `COPILOT_TEAMS_ENABLED` — overrides settings file for enabled/disabled
  3. Settings file (`settings.json`) — base configuration
  4. Defaults (`enabled: false`, `teammateMode: "auto"`) — lowest priority
- [ ] Implement `isTeamsEnabled(): boolean` guard used by all entry points
- [ ] Validate `teammateMode` values; reject invalid values with clear error message
- [ ] Write unit tests:
  - [ ] Default config returns `enabled: false`, `teammateMode: "auto"`
  - [ ] Env var `COPILOT_TEAMS_ENABLED=1` enables the feature
  - [ ] Settings file `teammateMode: "tmux"` is respected
  - [ ] CLI flag `--teammate-mode in-process` overrides settings file
  - [ ] Invalid `teammateMode` value produces error
  - [ ] Feature-gated entry point rejects calls when disabled

---

### R2: Local File Storage Utilities

**Goal:** Build reusable helpers for the local file system operations that all modules depend on (path resolution, atomic writes, file locking).

**Requirement IDs:** NF-4, NF-10, NF-11

- [ ] Implement `resolvePath(teamName, ...segments)` that returns well-known paths:
  - Team config: `~/.copilot/teams/{team-name}/config.json`
  - Task list: `~/.copilot/tasks/{team-name}/backlog.md`
  - Mailbox: `~/.copilot/teams/{team-name}/mailbox/`
  - Permission audit log: `~/.copilot/teams/{team-name}/permission-audit.log`
- [ ] Implement `ensureDir(path)` — create directory tree if not exists
- [ ] Implement `atomicWriteFile(path, content)` — write-to-temp then rename (prevents partial reads)
- [ ] Implement `acquireLock(path)` / `releaseLock(path)` — file-based advisory locking (e.g., `lockfile` or `proper-lockfile` package) for concurrency-safe task claiming
- [ ] Write unit tests:
  - [ ] Path resolution produces correct paths for various team names
  - [ ] `ensureDir` creates nested directories
  - [ ] `atomicWriteFile` is safe under concurrent reads
  - [ ] Lock acquisition blocks concurrent access; lock release allows it
  - [ ] Lock handles stale lockfiles gracefully

---

## Phase 2: Team Lifecycle

### R3: Team Creation

**Goal:** Implement team creation — generating a unique team name, persisting team config, and enforcing constraints.

**Requirement IDs:** TL-1, TL-2, TL-3, TL-4, TL-5, TL-9, TL-10, TL-11

- [ ] Define `TeamConfig` schema (JSON):
  ```json
  {
    "teamName": "string",
    "leadSessionId": "string",
    "createdAt": "ISO8601",
    "members": [
      { "name": "string", "agentId": "string", "agentType": "string", "status": "string" }
    ]
  }
  ```
- [ ] Implement `generateTeamName()` — generate a unique, human-readable team name (e.g., adjective-noun-hash: `swift-falcon-a3b2`)
- [ ] Implement `createTeam(leadSessionId, members?)`:
  - Validate no active team exists for this lead session (TL-9)
  - Generate team name
  - Build `TeamConfig` with lead as first member
  - Persist config at `~/.copilot/teams/{team-name}/config.json`
  - Return created `TeamConfig`
- [ ] Implement `loadTeam(teamName): TeamConfig` — read and parse config from disk
- [ ] Implement `getActiveTeam(leadSessionId): TeamConfig | null` — find active team for a session
- [ ] Implement guard: `assertNoActiveTeam(leadSessionId)` — error if team already exists (TL-9)
- [ ] Implement guard: `assertIsLead(sessionId, teamConfig)` — error if not the lead (TL-10)
- [ ] Implement guard: `assertNotTeammate(sessionId)` — error if a teammate tries to create a team (TL-11)
- [ ] Support natural-language–driven creation: expose a function the lead can call after parsing user intent (TL-1)
- [ ] Support lead-proposed creation with user confirmation gate (TL-2)
- [ ] Write unit tests:
  - [ ] `createTeam` generates unique name and persists valid config
  - [ ] `createTeam` fails if an active team already exists for the session
  - [ ] `loadTeam` correctly reads persisted config
  - [ ] Teammate session cannot create a team
  - [ ] Team config has correct `members` array structure

---

### R4: Team Cleanup

**Goal:** Implement team teardown — removing config, task list, and mailbox state, with pre-condition checks.

**Requirement IDs:** TL-6, TL-7, TL-8

- [ ] Implement `cleanupTeam(teamName, leadSessionId)`:
  - Load team config
  - Assert caller is the lead
  - Check all teammates are stopped (TL-7); error with list of still-running teammates if not
  - Remove team config directory (`~/.copilot/teams/{team-name}/`)
  - Remove task list directory (`~/.copilot/tasks/{team-name}/`)
  - Return success/failure result
- [ ] Implement `areAllTeammatesStopped(teamConfig): boolean` — check process status of each teammate
- [ ] Write unit tests:
  - [ ] Cleanup succeeds when all teammates are stopped
  - [ ] Cleanup fails with clear error listing running teammates
  - [ ] Cleanup removes config, task list, and mailbox directories
  - [ ] Non-lead cannot clean up team

---

## Phase 3: Communication Infrastructure

### R5: Mailbox Messaging System

**Goal:** Implement the file-based mailbox for point-to-point and broadcast messaging between team members.

**Requirement IDs:** CM-1, CM-2, CM-3, CM-4, CM-5, CM-6, CM-7

- [ ] Define `Message` interface:
  ```ts
  {
    id: string;
    from: string;        // sender name/ID
    to: string | "all";  // recipient or "all" for broadcast
    type: "message" | "notification" | "permission_request" | "permission_response" | "shutdown_request" | "shutdown_response" | "plan_approval_request" | "plan_approval_response";
    payload: object;
    timestamp: string;
    read: boolean;
  }
  ```
- [ ] Implement mailbox storage structure:
  ```
  ~/.copilot/teams/{team-name}/mailbox/
    {recipient-name}/
      {message-id}.json
  ```
- [ ] Implement `sendMessage(teamName, message)`:
  - Validate sender and recipient are team members
  - If `to === "all"`, write to every member's mailbox (broadcast)
  - If broadcast, log a cost warning (CM-4)
  - Use atomic write to prevent partial reads
- [ ] Implement `readMessages(teamName, recipientName, opts?)`:
  - Read all unread messages from recipient's mailbox directory
  - Support filtering by type, sender
  - Mark messages as read
- [ ] Implement file-watcher–based push delivery (CM-5, CM-7):
  - Use `fs.watch` or `chokidar` on mailbox directory
  - On new file, trigger callback with parsed message
  - Lead must receive messages automatically (push, not poll)
- [ ] Implement `broadcastCostWarning(teamSize)` — warn if team > N members (CM-4)
- [ ] Implement `notifyLeadIdle(teamName, teammateName)` — auto-notification when teammate finishes (CM-6)
- [ ] Write unit tests:
  - [ ] Point-to-point message is delivered to correct recipient's mailbox
  - [ ] Broadcast message is delivered to all members except sender
  - [ ] Broadcast triggers cost warning for large teams
  - [ ] `readMessages` returns only unread messages
  - [ ] File watcher triggers callback on new message
  - [ ] Idle notification is sent to lead when teammate finishes

---

## Phase 4: Teammate Management

### R6: Teammate Spawning

**Goal:** Implement spawning of independent Copilot CLI instances as teammates, with proper context injection and status tracking.

**Requirement IDs:** TM-1, TM-2, TM-3, TM-4, TM-5, TM-6

- [ ] Implement `spawnTeammate(teamName, options)`:
  ```ts
  options: {
    name: string;
    model?: string;        // TM-3
    spawnPrompt: string;   // TM-5: task-specific context
    count?: number;        // TM-2: batch spawn
  }
  ```
  - Launch a new Copilot CLI process (child process) with:
    - Same project context (cwd, conventions, MCP servers, tools) (TM-4)
    - Spawn prompt injected as initial message (TM-5)
    - Model override if specified (TM-3)
    - Team membership info (team name, teammate name, lead info)
  - Register teammate in team config (update `members` array)
  - Do NOT carry over lead's conversation history (TM-5)
- [ ] Implement `spawnMultipleTeammates(teamName, specs[])` — batch spawn N teammates (TM-2)
- [ ] Implement `getTeammateStatus(teamName): TeammateStatus[]` — returns name, status, current task for each teammate (TM-6)
- [ ] Implement `listActiveTeammates(teamName)` — formatted output for terminal display (TM-6)
- [ ] Implement teammate process lifecycle tracking:
  - Track PID, status (spawning, active, idle, stopped, crashed)
  - Update team config on status changes
- [ ] Write unit tests:
  - [ ] Spawning creates a new process and registers in team config
  - [ ] Spawn prompt is passed as initial context, not lead's history
  - [ ] Model override is applied correctly
  - [ ] Batch spawn creates N teammates
  - [ ] `getTeammateStatus` returns correct statuses
  - [ ] Project context (cwd, tools) is inherited by teammate

---

### R7: Permissions & Approval Flow

**Goal:** Implement the least-privilege permission model where teammates request single-use approvals from the lead for privileged operations.

**Requirement IDs:** TM-7, TM-8, TM-9, TM-10, TM-11, TM-12, TM-13, TM-14, TM-15, TM-16, TM-17

- [ ] Define `PermissionRequest` interface:
  ```ts
  {
    id: string;
    teammateName: string;
    operation: string;         // e.g., "file_write", "shell_command", "api_call"
    description: string;       // human-readable description
    targetResource: string;    // file path, command, URL, etc.
    timestamp: string;
  }
  ```
- [ ] Define `PermissionResponse` interface:
  ```ts
  {
    requestId: string;
    decision: "approved" | "denied";
    rationale?: string;
  }
  ```
- [ ] Implement `requestPermission(teamName, request)`:
  - Send permission request message to lead via mailbox (TM-9)
  - Block teammate execution until response is received (TM-16)
  - Return approval/denial result
- [ ] Implement `reviewPermission(teamName, requestId, decision, rationale?)`:
  - Validate lead has sufficient permissions (TM-8)
  - Send response to requesting teammate via mailbox (TM-10)
  - Log to permission audit log (TM-13)
- [ ] Implement permission enforcement at teammate level:
  - Intercept privileged operations (file write, shell exec, API calls)
  - Auto-trigger `requestPermission` before execution
  - Ensure grants are single-use — no caching or reuse (TM-11, TM-12)
  - Default to minimum permissions at spawn (TM-7)
- [ ] Implement permission audit log:
  - File: `~/.copilot/teams/{team-name}/permission-audit.log`
  - Format: one JSON line per entry with timestamp, teammate, operation, target, decision, rationale (TM-14)
  - Append-only; teammates cannot modify or truncate (TM-15)
  - Expose `readAuditLog(teamName)` for user review (TM-17)
- [ ] Write unit tests:
  - [ ] Teammate starts with minimum permissions (no inherited elevation)
  - [ ] Permission request blocks until lead responds
  - [ ] Approved request allows one execution only
  - [ ] Second identical request requires fresh approval
  - [ ] Denied request blocks the operation
  - [ ] Lead cannot grant permissions beyond its own level
  - [ ] Audit log entry contains all required fields
  - [ ] Audit log is append-only (write to existing, never overwrite)
  - [ ] User can read full audit log

---

### R8: Teammate Shutdown

**Goal:** Implement graceful shutdown of individual teammates with negotiation.

**Requirement IDs:** TM-18, TM-19, TM-20, TM-21

- [ ] Implement `requestShutdown(teamName, teammateName)`:
  - Send shutdown request message to target teammate via mailbox (TM-19)
  - Wait for response (approve/reject)
- [ ] Implement `handleShutdownRequest(teamName)` (teammate-side):
  - If no in-progress operation: approve and begin graceful exit (TM-20)
  - If in-progress operation: finish current operation, then exit (TM-21)
  - If rejecting: send rejection with explanation (TM-20)
- [ ] Implement `forceShutdown(teamName, teammateName)` — kill process if teammate is unresponsive (fallback)
- [ ] Update team config member status to `"stopped"` after shutdown
- [ ] Remove teammate from active process tracking
- [ ] Write unit tests:
  - [ ] Shutdown request triggers graceful exit when idle
  - [ ] Teammate finishes in-progress work before shutting down
  - [ ] Teammate can reject shutdown with explanation
  - [ ] Team config is updated after shutdown
  - [ ] Force shutdown terminates unresponsive teammate

---

## Phase 5: Task Management

### R9: Task List & Task States

**Goal:** Implement the shared, persistent task list with state management and dependency tracking.

**Requirement IDs:** TS-1, TS-2, TS-3, TS-4, TS-5, TS-6, TS-7, TS-8

- [ ] Define `Task` interface:
  ```ts
  {
    id: string;
    title: string;
    description: string;
    status: "pending" | "in_progress" | "completed";
    assignee?: string;         // teammate name
    dependencies: string[];    // task IDs
    complexity?: "S" | "M" | "L" | "XL";
    createdAt: string;
    updatedAt: string;
  }
  ```
- [ ] Define `TaskList` (backlog) serialization format in Markdown:
  - Human-readable markdown with YAML frontmatter per task
  - Stored at `~/.copilot/tasks/{team-name}/backlog.md`
- [ ] Implement `createTask(teamName, task)` — lead-only, add task to backlog (TS-4)
- [ ] Implement `updateTask(teamName, taskId, updates)` — lead-only, update fields (TS-4)
- [ ] Implement `deleteTask(teamName, taskId)` — lead-only (TS-4)
- [ ] Implement `readTaskList(teamName): Task[]` — available to all members (TS-3)
- [ ] Implement state transition logic:
  - `pending → in_progress` — when claimed/assigned
  - `in_progress → completed` — when teammate marks done
  - No backward transitions allowed
- [ ] Implement dependency resolution:
  - `getBlockedTasks(tasks)` — tasks with unresolved dependencies (TS-7)
  - `getUnblockedTasks(tasks)` — pending tasks with all deps completed
  - When a task completes, re-evaluate blocked tasks and unblock if ready (TS-8)
- [ ] Use file locking for concurrent access to `backlog.md` (NF-4)
- [ ] Write unit tests:
  - [ ] Task created with correct defaults (`status: pending`)
  - [ ] Only lead can create/update/delete tasks
  - [ ] Teammates can read task list
  - [ ] State transitions work correctly (pending → in_progress → completed)
  - [ ] Invalid transitions are rejected
  - [ ] Dependency blocking works — task with incomplete deps is not unblocked
  - [ ] Completing a dep automatically unblocks dependent tasks
  - [ ] Concurrent reads/writes are safe with file locking

---

### R10: Task Assignment & Claiming

**Goal:** Implement task assignment by the lead and self-claiming by teammates, with concurrency safety.

**Requirement IDs:** TS-9, TS-10, TS-11, TS-12

- [ ] Implement `assignTask(teamName, taskId, teammateName)`:
  - Lead-only operation
  - Validate task is `pending` and unblocked
  - Set `assignee` and transition to `in_progress`
  - Notify assigned teammate via mailbox
- [ ] Implement `claimNextTask(teamName, teammateName)`:
  - Teammate sends claim request to lead via mailbox (TS-10, TS-12)
  - Lead validates and assigns (prevents race conditions via centralized coordination)
  - Returns claimed task or null if none available
- [ ] Implement auto-pickup after task completion (TS-11):
  - When teammate completes a task, automatically trigger `claimNextTask`
  - Skip if no unassigned, unblocked pending tasks remain
- [ ] Write unit tests:
  - [ ] Lead can assign a pending, unblocked task to a teammate
  - [ ] Assignment fails for blocked tasks
  - [ ] Teammate claim request goes through lead coordination
  - [ ] Two simultaneous claims do not result in double-assignment
  - [ ] Auto-pickup triggers after task completion
  - [ ] Auto-pickup returns null when no tasks available

---

### R11: Task Complexity & Planning Poker

**Goal:** Implement complexity estimation via planning poker and capacity-based assignment balancing.

**Requirement IDs:** TS-13, TS-14, TS-15, TS-16, TS-17, TS-18, TS-19

- [ ] Define complexity weights constant:
  ```ts
  const COMPLEXITY_WEIGHTS = { S: 1, M: 1.33, L: 2, XL: 4 };
  const CAPACITY_PER_ITERATION = 4;
  ```
- [ ] Implement `startPlanningPoker(teamName, taskIds)`:
  - Lead sends estimation request to all teammates (TS-15)
  - Each teammate submits estimate independently
  - Estimates are hidden until all submitted (prevent anchoring) (TS-15)
- [ ] Implement `submitEstimate(teamName, taskId, teammateName, size)`:
  - Validate size is S/M/L/XL
  - Store in temporary estimates file (hidden from other teammates)
- [ ] Implement `resolveEstimates(teamName, taskId)`:
  - Collect all estimates
  - Pick mode (most frequent); on tie, pick higher size (TS-14)
  - Assign resolved complexity to task (TS-13)
- [ ] Implement `calculateTeammateLoad(teamName, teammateName): number`:
  - Sum weights of all `in_progress` + assigned tasks for the teammate
- [ ] Implement `balanceAssignments(teamName)`:
  - Distribute pending tasks across teammates evenly by weight (TS-17)
  - Ensure no teammate exceeds 4 points per iteration (TS-16)
  - Flag XL tasks for potential decomposition (TS-18)
- [ ] Write unit tests:
  - [ ] Tasks without complexity size cannot be assigned (TS-13)
  - [ ] Planning poker resolves to mode of estimates
  - [ ] Tie-breaking picks higher size
  - [ ] Teammate cannot see others' estimates before all submitted
  - [ ] Capacity limit of 4 points is enforced
  - [ ] Balance algorithm distributes weight evenly
  - [ ] XL task triggers decomposition suggestion

---

## Phase 6: Display Modes

### R12: In-Process Display Mode

**Goal:** Implement the in-process mode where all teammates run in a single terminal with keyboard navigation.

**Requirement IDs:** DM-1, DM-2, DM-3, DM-4, DM-5, CM-9

- [ ] Implement `InProcessDisplay` class:
  - Manages rendering of multiple teammate outputs in a single terminal
  - Tracks which teammate is currently "focused"
  - Uses `process.stdin` raw mode for key capture
- [ ] Implement keyboard navigation:
  - `Shift+Down`: cycle to next teammate; wrap to lead after last (DM-2, CM-9)
  - `Enter`: view focused teammate's session (DM-3)
  - `Escape`: interrupt focused teammate's current turn (DM-3)
  - `Ctrl+T`: toggle task list overlay (DM-4)
- [ ] Implement status bar showing all teammates and their statuses
- [ ] Implement task list overlay view (toggled by `Ctrl+T`)
- [ ] Ensure no external dependencies for in-process mode (DM-5) — only built-in terminal APIs
- [ ] Write unit tests:
  - [ ] Cycling advances focus to next teammate
  - [ ] Cycling wraps from last teammate to lead
  - [ ] Task list toggle shows/hides overlay
  - [ ] No external terminal tools required (no tmux, no iTerm2)

---

### R13: Split-Pane Display Mode

**Goal:** Implement split-pane mode for tmux and iTerm2, where each teammate gets its own pane.

**Requirement IDs:** DM-6, DM-7, DM-8, DM-9, CM-10

- [ ] Implement `TmuxDisplay` class:
  - Create tmux window/panes for each teammate
  - Each pane runs an independent Copilot CLI process
  - Provide helper to send commands to specific panes
- [ ] Implement `ITermDisplay` class:
  - Use `it2` CLI to create split panes in iTerm2
  - Each pane runs an independent Copilot CLI process
- [ ] Implement `detectTerminalEnvironment()`:
  - Check `$TMUX` env var for tmux (DM-9)
  - Check iTerm2 env vars / `it2` availability (DM-9)
  - Return detected environment type
- [ ] All panes visible simultaneously (DM-7)
- [ ] User can click into a pane to interact directly with that teammate (CM-10)
- [ ] Write unit tests:
  - [ ] tmux panes are created correctly for N teammates
  - [ ] iTerm2 panes are created via `it2` CLI
  - [ ] Auto-detection picks tmux when `$TMUX` is set
  - [ ] Auto-detection picks iTerm2 when available and not in tmux

---

### R14: Display Mode Selection

**Goal:** Implement the auto-detection and override logic for choosing display mode.

**Requirement IDs:** DM-10, DM-11, DM-12

- [ ] Implement `resolveDisplayMode(config, cliFlags)`:
  - If CLI flag `--teammate-mode` is set → use it (DM-12)
  - Else if `teammateMode` in settings → use it (DM-11)
  - Else `"auto"`:
    - If inside tmux → split-pane (tmux) (DM-10)
    - Else → in-process (DM-10)
- [ ] Instantiate correct display class based on resolved mode
- [ ] Write unit tests:
  - [ ] CLI flag overrides settings file
  - [ ] Settings file overrides auto
  - [ ] Auto mode picks split-pane inside tmux
  - [ ] Auto mode picks in-process outside tmux

---

## Phase 7: Plan Approval Workflow

### R15: Plan Approval

**Goal:** Implement the plan-then-implement workflow where teammates produce plans for lead review before coding.

**Requirement IDs:** PA-1, PA-2, PA-3, PA-4, PA-5, PA-6

- [ ] Implement teammate plan mode:
  - Teammate enters read-only plan mode (PA-1)
  - In plan mode, teammate can explore code and produce a plan but MUST NOT modify files
  - Plan is stored as a structured document (Markdown)
- [ ] Implement `submitPlanForApproval(teamName, teammateName, plan)`:
  - Teammate sends plan approval request to lead via mailbox (PA-2)
  - Teammate blocks, awaiting response
- [ ] Implement `reviewPlan(teamName, requestId, decision, feedback?)`:
  - Lead approves → teammate exits plan mode and begins implementation (PA-5)
  - Lead rejects → teammate receives feedback, stays in plan mode, revises (PA-4)
- [ ] Implement lead approval criteria customization:
  - User can set approval criteria via prompt to the lead (PA-6)
  - Lead uses criteria to make autonomous approval/rejection decisions
- [ ] Write unit tests:
  - [ ] Teammate in plan mode cannot write files
  - [ ] Plan approval request is sent via mailbox
  - [ ] Approved plan transitions teammate to implementation mode
  - [ ] Rejected plan keeps teammate in plan mode with feedback
  - [ ] Lead can apply custom approval criteria

---

## Phase 8: Quality Gates (Hooks)

### R16: Lifecycle Hooks

**Goal:** Implement hook system for `TeammateIdle` and `TaskCompleted` lifecycle events.

**Requirement IDs:** QG-1, QG-2, QG-3, QG-4

- [ ] Define hook interface:
  ```ts
  {
    event: "TeammateIdle" | "TaskCompleted";
    command: string;      // shell command to execute
    workingDir?: string;
  }
  ```
- [ ] Implement hook configuration loading:
  - Read from project's existing Copilot CLI hook configuration (QG-4)
  - Support per-project and global hooks
- [ ] Implement `runHook(event, context)`:
  - Execute configured command for the event
  - Pass context as environment variables or JSON stdin
  - Capture exit code and stdout/stderr
- [ ] Implement `TeammateIdle` hook (QG-2):
  - Triggered when a teammate is about to go idle
  - Exit code 2 → send stdout as feedback to teammate, keep it working
  - Other exit codes → proceed with idle state
- [ ] Implement `TaskCompleted` hook (QG-3):
  - Triggered when a task is being marked complete
  - Exit code 2 → prevent completion, send stdout as feedback
  - Other exit codes → allow completion
- [ ] Write unit tests:
  - [ ] Hook configuration is loaded from project config
  - [ ] `TeammateIdle` hook with exit code 2 sends feedback and prevents idle
  - [ ] `TeammateIdle` hook with exit code 0 allows idle
  - [ ] `TaskCompleted` hook with exit code 2 prevents completion
  - [ ] `TaskCompleted` hook with exit code 0 allows completion
  - [ ] Hook receives correct context (teammate name, task info)

---

## Phase 9: User ↔ Teammate Direct Interaction

### R17: Direct User-Teammate Communication

**Goal:** Allow the user to interact with any teammate directly without going through the lead.

**Requirement IDs:** CM-8, CM-9, CM-10

- [ ] Implement `directInteract(teammateName)`:
  - In-process mode: focus switches to teammate; user types directly to its session (CM-9)
  - Split-pane mode: user clicks into the pane (native behavior) (CM-10)
- [ ] Ensure direct interaction does not disrupt the lead or other teammates
- [ ] Ensure teammate can receive both lead messages and user input
- [ ] Write unit tests:
  - [ ] In-process mode focus switch routes input to correct teammate
  - [ ] Direct interaction does not affect lead's mailbox or state

---

## Phase 10: Non-Functional — Resilience & Cost Awareness

### R18: Token & Cost Efficiency

**Goal:** Implement cost awareness warnings and documentation.

**Requirement IDs:** NF-1, NF-2, NF-3

- [ ] Document token usage scaling in user-facing help/docs (NF-1)
- [ ] Implement `warnTeamSize(n)` — warn user before creating large teams (NF-2):
  - Threshold: warn if N > 5 teammates
  - Require user confirmation to proceed
- [ ] Implement broadcast cost warning (NF-3) — already part of mailbox (CM-4), ensure it's visible to user
- [ ] Write unit tests:
  - [ ] Warning triggers for team size > 5
  - [ ] Warning does NOT trigger for team size ≤ 5

---

### R19: Concurrency & Conflict Avoidance

**Goal:** Implement file conflict detection and work partitioning guidance.

**Requirement IDs:** NF-4, NF-5, NF-6

- [ ] File locking for task claiming — already covered in R2 (utils) and R9 (task list)
- [ ] Implement `detectFileConflicts(teamName)`:
  - Track which files each teammate is working on (via task metadata or file watchers)
  - Warn if two teammates are editing or plan to edit the same file (NF-6)
- [ ] Implement partitioning guidance:
  - Lead should suggest file ownership when assigning tasks (NF-5)
  - Include file-ownership info in task metadata
- [ ] Write unit tests:
  - [ ] Conflict warning when two teammates target same file
  - [ ] No warning when teammates target different files

---

### R20: Resilience & Error Handling

**Goal:** Handle teammate crashes, orphaned processes, and recovery.

**Requirement IDs:** NF-7, NF-8, NF-9

- [ ] Implement crash detection:
  - Monitor teammate process exit codes
  - On unexpected exit, notify lead immediately (NF-7)
  - Include error info (exit code, last stderr) in notification
- [ ] Implement recovery options (NF-8):
  - User can give stopped teammate additional instructions (if process can be restarted)
  - User can spawn a replacement teammate with the same task context
- [ ] Implement orphan cleanup (NF-9):
  - On team startup, check for stale processes from previous sessions
  - On unclean shutdown, detect and kill orphaned tmux panes
  - Clean up stale lockfiles
- [ ] Write unit tests:
  - [ ] Lead is notified on teammate crash
  - [ ] Replacement teammate can be spawned with same context
  - [ ] Stale lockfiles are detected and cleaned
  - [ ] Orphaned tmux panes are detected

---

## Dependency Graph (Summary)

```
R0  (Project Setup)
 └─► R1  (Config & Feature Flag)
 └─► R2  (Local File Storage Utils)
      ├─► R3  (Team Creation)
      │    └─► R4  (Team Cleanup)
      ├─► R5  (Mailbox Messaging)
      │    ├─► R6  (Teammate Spawning)
      │    │    ├─► R7  (Permissions & Approval)
      │    │    ├─► R8  (Teammate Shutdown)
      │    │    └─► R17 (Direct User-Teammate Interaction)
      │    ├─► R10 (Task Assignment & Claiming)
      │    ├─► R15 (Plan Approval)
      │    └─► R20 (Resilience)
      ├─► R9  (Task List & States)
      │    ├─► R10 (Task Assignment & Claiming)
      │    └─► R11 (Task Complexity & Planning Poker)
      ├─► R12 (In-Process Display)
      ├─► R13 (Split-Pane Display)
      └─► R14 (Display Mode Selection)
           └─ depends on R12, R13
R16 (Lifecycle Hooks) — depends on R6, R9
R18 (Token & Cost) — depends on R5, R6
R19 (Concurrency) — depends on R2, R9
```

---

## Known Limitations to Implement (v1 Guardrails)

These should be implemented as explicit checks/warnings in the system:

| Limitation ID | Where to enforce |
|---------------|-----------------|
| LM-1 (No session resumption) | Teammate spawning — warn on resume |
| LM-2 (Task status lag) | Task list — manual override option |
| LM-3 (Slow shutdown) | Shutdown flow — inform user of delay |
| LM-4 (One team per session) | Team creation guard (TL-9) |
| LM-5 (No nested teams) | Team creation guard (TL-11) |
| LM-6 (Fixed lead) | Team config — no transfer API |
| LM-7 (Single-use permissions) | Permission flow (TM-11, TM-12) |
