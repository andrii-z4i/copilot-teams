# Copilot Teams — Implementation Plan

This document breaks down the requirements from `requirements.md` into discrete implementation units, each with an actionable checklist. The plan is organized in dependency order — foundational modules first, higher-level features later.

---

## Phase 0: Project Scaffolding

Before any feature work, establish the project structure, tooling, and shared infrastructure.

### R0: Project Setup

**Goal:** Initialize the project with build tooling, directory structure, linting, and test infrastructure.

- [x] Choose runtime and language (TypeScript + Node.js recommended to align with Copilot CLI ecosystem)
- [x] Initialize package with `package.json`, `tsconfig.json`, ESLint, Prettier
- [x] Create source directory structure:
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
- [x] Create test directory mirroring `src/` structure
- [x] Add shared types/interfaces file (`src/types.ts`) for `TeamConfig`, `Task`, `Message`, `PermissionRequest`, etc.
- [x] Add shared constants file (`src/constants.ts`) for well-known paths (`~/.copilot/teams/`, `~/.copilot/tasks/`), states, sizes
- [x] Set up unit test runner (Vitest or Jest)
- [x] Set up integration test harness that can create/cleanup temp directories

**Depends on:** Nothing  
**Requirement IDs:** Foundation for all requirements

---

## Phase 1: Configuration & Local Storage Foundation

### R1: Configuration & Feature Flag

**Goal:** Implement the feature-flag gating and configuration loading so that all subsequent features can check whether Teams is enabled and read display-mode settings.

**Requirement IDs:** CF-1, CF-2, CF-3, CF-4, NF-10, NF-11

- [x] Define `CopilotTeamsConfig` interface:
  ```ts
  {
    enabled: boolean;
    teammateMode: "auto" | "in-process" | "tmux";
  }
  ```
- [x] Implement `loadConfig()` that merges (in priority order):
  1. CLI flags (`--teammate-mode <mode>`) — highest priority
  2. Environment variable `COPILOT_TEAMS_ENABLED` — overrides settings file for enabled/disabled
  3. Settings file (`settings.json`) — base configuration
  4. Defaults (`enabled: false`, `teammateMode: "auto"`) — lowest priority
- [x] Implement `isTeamsEnabled(): boolean` guard used by all entry points
- [x] Validate `teammateMode` values; reject invalid values with clear error message
- [x] Write unit tests:
  - [x] Default config returns `enabled: false`, `teammateMode: "auto"`
  - [x] Env var `COPILOT_TEAMS_ENABLED=1` enables the feature
  - [x] Settings file `teammateMode: "tmux"` is respected
  - [x] CLI flag `--teammate-mode in-process` overrides settings file
  - [x] Invalid `teammateMode` value produces error
  - [x] Feature-gated entry point rejects calls when disabled

---

### R2: Local File Storage Utilities

**Goal:** Build reusable helpers for the local file system operations that all modules depend on (path resolution, atomic writes, file locking).

**Requirement IDs:** NF-4, NF-10, NF-11

- [x] Implement `resolvePath(teamName, ...segments)` that returns well-known paths:
  - Team config: `~/.copilot/teams/{team-name}/config.json`
  - Task list: `~/.copilot/teams/{team-name}/backlog.md`
  - Messages: `~/.copilot/teams/{team-name}/messages.md`
  - Sprint state: `~/.copilot/teams/{team-name}/sprint.md`
  - File claims: `~/.copilot/teams/{team-name}/files.md`
  - Permission audit log: `~/.copilot/teams/{team-name}/permission-audit.log`
- [x] Implement `ensureDir(path)` — create directory tree if not exists
- [x] Implement `atomicWriteFile(path, content)` — write-to-temp then rename (prevents partial reads)
- [x] Implement `acquireLock(path)` / `releaseLock(path)` — file-based advisory locking (e.g., `lockfile` or `proper-lockfile` package) for concurrency-safe task claiming
- [x] Write unit tests:
  - [x] Path resolution produces correct paths for various team names
  - [x] `ensureDir` creates nested directories
  - [x] `atomicWriteFile` is safe under concurrent reads
  - [x] Lock acquisition blocks concurrent access; lock release allows it
  - [x] Lock handles stale lockfiles gracefully

---

## Phase 2: Team Lifecycle

### R3: Team Creation

**Goal:** Implement team creation — generating a unique team name, persisting team config, and enforcing constraints.

**Requirement IDs:** TL-1, TL-2, TL-3, TL-4, TL-5, TL-9, TL-10, TL-11

- [x] Define `TeamConfig` schema (JSON):
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
- [x] Implement `generateTeamName()` — generate a unique, human-readable team name (e.g., adjective-noun-hash: `swift-falcon-a3b2`)
- [x] Implement `createTeam(leadSessionId, members?)`:
  - Validate no active team exists for this lead session (TL-9)
  - Generate team name
  - Build `TeamConfig` with lead as first member
  - Persist config at `~/.copilot/teams/{team-name}/config.json`
  - Return created `TeamConfig`
- [x] Implement `loadTeam(teamName): TeamConfig` — read and parse config from disk
- [x] Implement `getActiveTeam(leadSessionId): TeamConfig | null` — find active team for a session
- [x] Implement guard: `assertNoActiveTeam(leadSessionId)` — error if team already exists (TL-9)
- [x] Implement guard: `assertIsLead(sessionId, teamConfig)` — error if not the lead (TL-10)
- [x] Implement guard: `assertNotTeammate(sessionId)` — error if a teammate tries to create a team (TL-11)
- [x] Support natural-language–driven creation: expose a function the lead can call after parsing user intent (TL-1)
- [x] Support lead-proposed creation with user confirmation gate (TL-2)
- [x] Write unit tests:
  - [x] `createTeam` generates unique name and persists valid config
  - [x] `createTeam` fails if an active team already exists for the session
  - [x] `loadTeam` correctly reads persisted config
  - [x] Teammate session cannot create a team
  - [x] Team config has correct `members` array structure

---

### R4: Team Cleanup

**Goal:** Implement team teardown — removing config, task list, and mailbox state, with pre-condition checks.

**Requirement IDs:** TL-6, TL-7, TL-8

- [x] Implement `cleanupTeam(teamName, leadSessionId)`:
  - Load team config
  - Assert caller is the lead
  - Check all teammates are stopped (TL-7); error with list of still-running teammates if not
  - Remove team directory (`~/.copilot/teams/{team-name}/`) including config, task list, messages, sprint state, file claims, and permission audit log
  - Return success/failure result
- [x] Implement `areAllTeammatesStopped(teamConfig): boolean` — check process status of each teammate
- [x] Write unit tests:
  - [x] Cleanup succeeds when all teammates are stopped
  - [x] Cleanup fails with clear error listing running teammates
  - [x] Cleanup removes entire team directory (config, backlog, messages, sprint, files, audit log)
  - [x] Non-lead cannot clean up team

---

## Phase 3: Communication Infrastructure

### R5: Mailbox Messaging System

**Goal:** Implement the append-only, Lead-mediated messaging system for inter-agent communication. The Team Lead is the **only writer** to the messages file (single-writer coordination invariant). Teammates request the Lead to send messages on their behalf.

**Requirement IDs:** CM-1, CM-2, CM-3, CM-4, CM-5, CM-6, CM-7

- [x] Define message entry format (matching requirements):
  ```
  [Timestamp] [MessageID] [FromID] [ToID|BROADCAST] [Body]
  ```
  - Message ID: monotonic counter (incrementing integer)
  - To: specific teammate ID or `BROADCAST`
- [x] Implement message storage:
  - Single append-only file: `~/.copilot/teams/{team-name}/messages.md`
  - Only the Lead appends entries; teammates MUST NOT write to this file
- [x] Implement `appendMessage(teamName, from, to, body)` (Lead-only):
  - Validate caller is the Lead (enforce single-writer invariant)
  - Assign next monotonic message ID
  - Append formatted entry to `messages.md`
  - Use file locking to ensure atomic append
- [x] Implement teammate message request flow:
  - Teammates request the Lead to send a message (CM-2, CM-3)
  - The Lead validates the request and calls `appendMessage` on their behalf
- [x] Implement `readMessages(teamName, recipientId, sinceId?)`:
  - Parse `messages.md` and filter by recipient (direct or BROADCAST)
  - Support reading only messages after a given ID (cursor-based)
  - Available to all team members (read-only)
- [x] Implement broadcast support:
  - When `to === "BROADCAST"`, the message is visible to all members (CM-3)
  - Log a cost warning when broadcasting to large teams (CM-4)
- [x] Implement file-watcher–based push delivery (CM-5, CM-7):
  - Use `fs.watch` or `chokidar` on `messages.md`
  - On file change, parse new entries and trigger callbacks for recipients
  - Lead receives messages automatically (push, not poll) (CM-7)
- [x] Implement `notifyLeadIdle(teamName, teammateName)` — teammate requests Lead to record idle notification (CM-6)
- [x] Write unit tests:
  - [x] Only the Lead can append messages (single-writer invariant enforced)
  - [x] Teammate message request is mediated by the Lead
  - [x] Point-to-point message is visible to correct recipient
  - [x] Broadcast message is visible to all members
  - [x] Broadcast triggers cost warning for large teams
  - [x] `readMessages` with cursor returns only messages after given ID
  - [x] File watcher triggers callback on new message
  - [x] Idle notification is recorded when teammate finishes
  - [x] Messages file is append-only (no deletions or modifications)

---

## Phase 4: Teammate Management

### R6: Teammate Spawning

**Goal:** Implement spawning of independent Copilot CLI instances as teammates, with proper context injection and status tracking.

**Requirement IDs:** TM-1, TM-2, TM-3, TM-4, TM-5, TM-6

- [x] Implement `spawnTeammate(teamName, options)`:
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
- [x] Implement `spawnMultipleTeammates(teamName, specs[])` — batch spawn N teammates (TM-2)
- [x] Implement `getTeammateStatus(teamName): TeammateStatus[]` — returns name, status, current task for each teammate (TM-6)
- [x] Implement `listActiveTeammates(teamName)` — formatted output for terminal display (TM-6)
- [x] Implement teammate process lifecycle tracking:
  - Track PID, status (spawning, active, idle, stopped, crashed)
  - Update team config on status changes
- [x] Write unit tests:
  - [x] Spawning creates a new process and registers in team config
  - [x] Spawn prompt is passed as initial context, not lead's history
  - [x] Model override is applied correctly
  - [x] Batch spawn creates N teammates
  - [x] `getTeammateStatus` returns correct statuses
  - [x] Project context (cwd, tools) is inherited by teammate

---

### R7: Permissions & Approval Flow

**Goal:** Implement the least-privilege permission model where teammates request single-use approvals from the lead for privileged operations.

**Requirement IDs:** TM-7, TM-8, TM-9, TM-10, TM-11, TM-12, TM-13, TM-14, TM-15, TM-16, TM-17

- [x] Define `PermissionRequest` interface:
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
- [x] Define `PermissionResponse` interface:
  ```ts
  {
    requestId: string;
    decision: "approved" | "denied";
    rationale?: string;
  }
  ```
- [x] Implement `requestPermission(teamName, request)`:
  - Teammate requests the Lead to record the permission request (TM-9)
  - The Lead writes the request to the messaging system on the teammate's behalf
  - Teammate blocks until the Lead responds (TM-16)
  - Return approval/denial result
- [x] Implement `reviewPermission(teamName, requestId, decision, rationale?)`:
  - Validate lead has sufficient permissions (TM-8)
  - Lead records response via messaging system (TM-10)
  - Log to permission audit log (TM-13)
- [x] Implement permission enforcement at teammate level:
  - Intercept privileged operations (file write, shell exec, API calls)
  - Auto-trigger `requestPermission` before execution
  - Ensure grants are single-use — no caching or reuse (TM-11, TM-12)
  - Default to minimum permissions at spawn (TM-7)
- [x] Implement permission audit log:
  - File: `~/.copilot/teams/{team-name}/permission-audit.log`
  - Format: one JSON line per entry with timestamp, teammate, operation, target, decision, rationale (TM-14)
  - Append-only; teammates cannot modify or truncate (TM-15)
  - Only the Lead and the user may read the audit log; teammates MUST NOT read it (TM-15)
  - Expose `readAuditLog(teamName)` for user review (TM-17)
- [x] Write unit tests:
  - [x] Teammate starts with minimum permissions (no inherited elevation)
  - [x] Permission request blocks until lead responds
  - [x] Approved request allows one execution only
  - [x] Second identical request requires fresh approval
  - [x] Denied request blocks the operation
  - [x] Lead cannot grant permissions beyond its own level
  - [x] Audit log entry contains all required fields
  - [x] Audit log is append-only (write to existing, never overwrite)
  - [x] User can read full audit log

---

### R8: Teammate Shutdown

**Goal:** Implement graceful shutdown of individual teammates with negotiation.

**Requirement IDs:** TM-18, TM-19, TM-20, TM-21

- [x] Implement `requestShutdown(teamName, teammateName)`:
  - Lead sends shutdown request to target teammate via messaging system (TM-19)
  - Wait for response (approve/reject)
- [x] Implement `handleShutdownRequest(teamName)` (teammate-side):
  - If no in-progress operation: approve and begin graceful exit (TM-20)
  - If in-progress operation: finish current operation, then exit (TM-21)
  - If rejecting: send rejection with explanation (TM-20)
- [x] Implement `forceShutdown(teamName, teammateName)` — kill process if teammate is unresponsive (fallback)
- [x] Update team config member status to `"stopped"` after shutdown
- [x] Remove teammate from active process tracking
- [x] Write unit tests:
  - [x] Shutdown request triggers graceful exit when idle
  - [x] Teammate finishes in-progress work before shutting down
  - [x] Teammate can reject shutdown with explanation
  - [x] Team config is updated after shutdown
  - [x] Force shutdown terminates unresponsive teammate

---

## Phase 5: Task Management

### R9: Task List & Task States

**Goal:** Implement the shared, persistent task list with state management and dependency tracking. The Lead is the **only writer** to the task list (single-writer coordination invariant).

**Requirement IDs:** TS-1, TS-2, TS-3, TS-4, TS-5, TS-6, TS-7, TS-8

- [x] Define `Task` interface:
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
- [x] Define `TaskList` (backlog) serialization format in Markdown:
  - Human-readable markdown with YAML frontmatter per task
  - Stored at `~/.copilot/teams/{team-name}/backlog.md`
- [x] Implement `createTask(teamName, task)` — lead-only, add task to backlog (TS-4)
- [x] Implement `updateTask(teamName, taskId, updates)` — lead-only, update fields (TS-4)
- [x] Implement `deleteTask(teamName, taskId)` — lead-only (TS-4)
- [x] Implement `readTaskList(teamName): Task[]` — available to all members (TS-3)
- [x] Implement state transition logic:
  - `pending → in_progress` — when claimed/assigned
  - `in_progress → completed` — when teammate marks done
  - No backward transitions allowed
- [x] Implement dependency resolution:
  - `getBlockedTasks(tasks)` — tasks with unresolved dependencies (TS-7)
  - `getUnblockedTasks(tasks)` — pending tasks with all deps completed
  - When a task completes, re-evaluate blocked tasks and unblock if ready (TS-8)
- [x] Use file locking for concurrent access to `backlog.md` (NF-4)
- [x] Write unit tests:
  - [x] Task created with correct defaults (`status: pending`)
  - [x] Only lead can create/update/delete tasks
  - [x] Teammates can read task list
  - [x] State transitions work correctly (pending → in_progress → completed)
  - [x] Invalid transitions are rejected
  - [x] Dependency blocking works — task with incomplete deps is not unblocked
  - [x] Completing a dep automatically unblocks dependent tasks
  - [x] Concurrent reads/writes are safe with file locking

---

### R10: Task Assignment & Claiming

**Goal:** Implement task assignment by the lead and self-claiming by teammates, with concurrency safety.

**Requirement IDs:** TS-9, TS-10, TS-11, TS-12

- [x] Implement `assignTask(teamName, taskId, teammateName)`:
  - Lead-only operation
  - Validate task is `pending` and unblocked
  - Set `assignee` and transition to `in_progress`
  - Notify assigned teammate via mailbox
- [x] Implement `claimNextTask(teamName, teammateName)`:
  - Teammate sends claim request to lead via mailbox (TS-10, TS-12)
  - Lead validates and assigns (prevents race conditions via centralized coordination)
  - Returns claimed task or null if none available
- [x] Implement auto-pickup after task completion (TS-11):
  - When teammate completes a task, check if there are more assigned tasks for this teammate in the current sprint
  - If yes, automatically pick up the next assigned task
  - If no assigned tasks remain, teammate MUST remain idle until the next sprint begins (TS-11)
  - Teammates MUST NOT claim unassigned tasks on their own — only work on tasks assigned within the current sprint
- [x] Write unit tests:
  - [x] Lead can assign a pending, unblocked task to a teammate
  - [x] Assignment fails for blocked tasks
  - [x] Teammate claim request goes through lead coordination
  - [x] Two simultaneous claims do not result in double-assignment
  - [x] Auto-pickup triggers for next assigned sprint task after task completion
  - [x] Teammate goes idle when no more assigned sprint tasks remain
  - [x] Teammate does NOT claim unassigned tasks outside its sprint assignment

---

### R11: Task Complexity & Planning Poker

**Goal:** Implement complexity estimation via planning poker and capacity-based assignment balancing.

**Requirement IDs:** TS-13, TS-14, TS-15, TS-16, TS-17, TS-18, TS-19

- [x] Define complexity weights constant:
  ```ts
  const COMPLEXITY_WEIGHTS = { S: 1, M: 1.33, L: 2, XL: 4 };
  const CAPACITY_PER_ITERATION = 4;
  ```
- [x] Implement `startPlanningPoker(teamName, taskIds)`:
  - Lead sends estimation request to all teammates (TS-15)
  - Each teammate submits estimate independently
  - Estimates are hidden until all submitted (prevent anchoring) (TS-15)
- [x] Implement `submitEstimate(teamName, taskId, teammateName, size)`:
  - Validate size is S/M/L/XL
  - Store in temporary estimates file (hidden from other teammates)
- [x] Implement `resolveEstimates(teamName, taskId)`:
  - Collect all estimates
  - Pick mode (most frequent); on tie, pick higher size (TS-14)
  - Assign resolved complexity to task (TS-13)
- [x] Implement `calculateTeammateLoad(teamName, teammateName): number`:
  - Sum weights of all `in_progress` + assigned tasks for the teammate
- [x] Implement `balanceAssignments(teamName)`:
  - Distribute pending tasks across teammates evenly by weight (TS-17)
  - Ensure no teammate exceeds 4 points per iteration (TS-16)
  - Flag XL tasks for potential decomposition (TS-18)
- [x] Write unit tests:
  - [x] Tasks without complexity size cannot be assigned (TS-13)
  - [x] Planning poker resolves to mode of estimates
  - [x] Tie-breaking picks higher size
  - [x] Teammate cannot see others' estimates before all submitted
  - [x] Capacity limit of 4 points is enforced
  - [x] Balance algorithm distributes weight evenly
  - [x] XL task triggers decomposition suggestion

---

### R12: Sprint Lifecycle Management

**Goal:** Implement discrete sprint cycles with planning, execution, and closure phases. The Lead is the only writer to the sprint state file.

**Requirement IDs:** TS-11, §3.3.5 (Sprint Lifecycle)

- [ ] Define sprint states: `planning`, `active`, `closed`
- [ ] Implement sprint state file at `~/.copilot/teams/{team-name}/sprint.md`:
  - Append-only format — each sprint is a new section:
    ```
    Sprint #[Number]
    Status: planning | active | closed
    StartedAt: [timestamp]
    ClosedAt: [timestamp or null]

    [Teammate] - [Task ID] - [Task Title] - [Estimate]
    ```
  - Closed sprint sections MUST NOT be modified
  - Only the Lead may append to this file (single-writer invariant)
- [ ] Implement `startSprint(teamName, sprintNumber)`:
  - Lead selects tasks from backlog for the sprint
  - Initiates planning poker for estimation (integrates with R11)
  - Sets sprint status to `planning`
- [ ] Implement `activateSprint(teamName, sprintNumber)`:
  - After estimation and assignment are complete, transition to `active`
  - Teammates begin working on assigned tasks
- [ ] Implement `closeSprint(teamName, sprintNumber)`:
  - Triggered when all tasks assigned for the sprint are completed
  - Set sprint status to `closed` with closing timestamp
  - Unfinished tasks return to backlog for next sprint
- [ ] Implement `getCurrentSprint(teamName)`:
  - Parse `sprint.md` and return the latest non-closed sprint
  - Return null if no active sprint
- [ ] Implement sprint constraint enforcement:
  - Teammates MUST only work on tasks assigned within the current sprint (TS-11)
  - When a teammate completes all assigned sprint tasks, it remains idle until next sprint
- [ ] Write unit tests:
  - [ ] Sprint file is created with correct format
  - [ ] Sprint transitions: planning → active → closed
  - [ ] Closed sprint sections are immutable (append-only)
  - [ ] Only Lead can write to sprint file
  - [ ] `getCurrentSprint` returns active sprint
  - [ ] Teammate cannot work on tasks outside current sprint
  - [ ] Sprint closure returns unfinished tasks to backlog

---

## Phase 6: Display Modes

### R13: In-Process Display Mode

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

### R14: Split-Pane Display Mode

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
- [ ] User can click into a pane to view that teammate's output (CM-10)
- [ ] Write unit tests:
  - [ ] tmux panes are created correctly for N teammates
  - [ ] iTerm2 panes are created via `it2` CLI
  - [ ] Auto-detection picks tmux when `$TMUX` is set
  - [ ] Auto-detection picks iTerm2 when available and not in tmux

---

### R15: Display Mode Selection

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

### R16: Plan Approval

**Goal:** Implement the plan-then-implement workflow where teammates produce plans for lead review before coding.

**Requirement IDs:** PA-1, PA-2, PA-3, PA-4, PA-5, PA-6

- [ ] Implement teammate plan mode:
  - Teammate enters read-only plan mode (PA-1)
  - In plan mode, teammate can explore code and produce a plan but MUST NOT modify files
  - Plan is stored as a structured document (Markdown)
- [ ] Implement `submitPlanForApproval(teamName, teammateName, plan)`:
  - Teammate requests the Lead to record the plan approval request (PA-2)
  - Teammate blocks, awaiting response
- [ ] Implement `reviewPlan(teamName, requestId, decision, feedback?)`:
  - Lead approves → teammate exits plan mode and begins implementation (PA-5)
  - Lead rejects → teammate receives feedback, stays in plan mode, revises (PA-4)
- [ ] Implement plan revision limit:
  - Track revision count per task per teammate
  - A teammate MAY submit at most **3 plan revisions** per task
  - If 3 consecutive plans are rejected, the task MUST return to the backlog and be reconsidered during next sprint planning
  - The teammate MAY remain idle for the remainder of the sprint
- [ ] Implement lead approval criteria customization:
  - User can set approval criteria via prompt to the lead (PA-6)
  - Lead uses criteria to make autonomous approval/rejection decisions
- [ ] Write unit tests:
  - [ ] Teammate in plan mode cannot write files
  - [ ] Plan approval request is mediated by the Lead
  - [ ] Approved plan transitions teammate to implementation mode
  - [ ] Rejected plan keeps teammate in plan mode with feedback
  - [ ] After 3 rejections, task returns to backlog
  - [ ] After 3 rejections, teammate goes idle for remainder of sprint
  - [ ] Lead can apply custom approval criteria

---

## Phase 8: Quality Gates (Hooks)

### R17: Lifecycle Hooks

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

## Phase 9: User ↔ Teammate Visibility

### R18: User-Teammate Visibility

**Goal:** Allow the user to **view** any teammate's session output. All control and instructions MUST go through the Team Lead — the user MUST NOT communicate directly with teammates.

**Requirement IDs:** CM-8, CM-9, CM-10

- [ ] Implement read-only teammate output viewing:
  - In-process mode: user cycles through teammates using `Shift+Down` to view their output (CM-9)
  - Split-pane mode: user clicks into a teammate's pane to view their output (CM-10)
  - Viewing is **read-only** — user cannot type input directly to teammates
- [ ] All control and instructions to teammates MUST go through the Team Lead (§3.4):
  - User communicates with the Lead
  - The Lead relays instructions to teammates via the messaging system
- [ ] Write unit tests:
  - [ ] In-process mode cycling allows viewing teammate output
  - [ ] User cannot send direct input to a teammate
  - [ ] All instructions to teammates are routed through the Lead

---

## Phase 10: Non-Functional — Resilience & Cost Awareness

### R19: Token & Cost Efficiency

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

### R20: Concurrency & Conflict Avoidance

**Goal:** Implement Lead-mediated file conflict detection and work partitioning guidance using the `files.md` coordination file.

**Requirement IDs:** NF-4, NF-5, NF-6

- [ ] File locking for task claiming — already covered in R2 (utils) and R9 (task list)
- [ ] Implement file claims storage at `~/.copilot/teams/{team-name}/files.md`:
  - Append-only format, each entry:
    ```
    [Timestamp] [TeammateID] [TaskID] [FilePath] [Status: in-use | free]
    ```
  - Only the Lead may write to this file (single-writer invariant)
  - Prior entries MUST NOT be modified
- [ ] Implement Lead-mediated file claim flow:
  - Teammates request file claims via the Lead
  - The Lead checks `files.md` for active "in-use" leases on the requested file
  - The Lead MUST deny claims if another teammate currently holds an active "in-use" lease (NF-6)
  - On approval, the Lead appends a new "in-use" entry
  - On file release, the Lead appends a "free" entry
- [ ] Implement `detectFileConflicts(teamName)`:
  - Parse `files.md` to identify files with active leases by multiple teammates
  - Warn if two teammates are editing or plan to edit the same file (NF-6)
- [ ] Implement partitioning guidance:
  - Lead should suggest file ownership when assigning tasks (NF-5)
  - Include file-ownership info in task metadata
- [ ] Write unit tests:
  - [ ] Only Lead can write to files.md
  - [ ] File claim is denied when another teammate holds active lease
  - [ ] File claim is approved when no active lease exists
  - [ ] Releasing a file appends a "free" entry
  - [ ] Conflict warning when two teammates target same file
  - [ ] No warning when teammates target different files
  - [ ] files.md entries are append-only (no modifications)

---

### R21: Resilience & Error Handling

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
      │    │    └─► R18 (User-Teammate Visibility)
      │    ├─► R10 (Task Assignment & Claiming)
      │    ├─► R16 (Plan Approval)
      │    └─► R21 (Resilience)
      ├─► R9  (Task List & States)
      │    ├─► R10 (Task Assignment & Claiming)
      │    ├─► R11 (Task Complexity & Planning Poker)
      │    └─► R12 (Sprint Lifecycle)
      │         └─ depends on R11
      ├─► R13 (In-Process Display)
      ├─► R14 (Split-Pane Display)
      └─► R15 (Display Mode Selection)
           └─ depends on R13, R14
R17 (Lifecycle Hooks) — depends on R6, R9
R19 (Token & Cost) — depends on R5, R6
R20 (Concurrency & File Claims) — depends on R2, R9
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
