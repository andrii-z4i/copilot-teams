# Copilot Teams — Requirements

## 1. Overview

Copilot Teams is a coordination layer for the GitHub Copilot CLI that enables multiple Copilot CLI instances to work together on complex tasks. One session acts as the **Team Lead**, orchestrating work across independently running **Teammate** instances. Teammates operate in their own context windows, communicate with each other through a shared messaging system, and coordinate via a shared task list.

The system targets the terminal-based Copilot CLI exclusively.

### 1.1 Goals

- Enable parallel exploration, implementation, and review across multiple Copilot CLI instances.
- Provide a clear coordination model: one lead, N teammates, shared task list, direct messaging.
- Minimize coordination overhead so that simple tasks remain simple.
- Achieve full feature parity with the reference architecture (Claude Code Agent Teams).

### 1.2 Non-Goals

- IDE / VS Code extension integration (out of scope for v1).
- Cloud-hosted orchestration — all coordination is local.
- Nested teams (teammates cannot spawn their own teams).

---

## 2. Core Concepts

| Concept | Description |
|---------|-------------|
| **Team Lead** | The primary Copilot CLI session that creates the team, spawns teammates, assigns tasks, and synthesizes results. There is exactly one lead per team. |
| **Teammate** | An independent Copilot CLI instance spawned by the lead. Each teammate has its own context window and can communicate with the lead and other teammates. |
| **Task List** | A shared, persistent list of work items with states and dependencies. All team members can read it; teammates claim and complete tasks. |
| **Mailbox** | A messaging system that enables direct, point-to-point and broadcast communication between all team members. |
| **Team Config** | Local configuration file describing team membership (names, agent IDs, types). Stored at a well-known path so any member can discover the team. |

### 2.1 Single-Writer Coordination Invariant

The Team Lead is the **only process allowed to write or mutate any shared coordination file**, including:

- task list
- sprint state
- messages
- file-claims
- permission audit log

Teammates MUST NOT directly write to shared coordination files.

Teammates submit **requests** to the Team Lead, and the Lead performs all mutations atomically under lock.

All shared coordination files MUST follow append-only semantics unless explicitly stated otherwise.

---

## 3. Functional Requirements

### 3.1 Team Lifecycle

#### 3.1.1 Team Creation

| ID | Requirement |
|----|-------------|
| TL-1 | The user MUST be able to create a team by describing the task and desired team structure in natural language to the lead. |
| TL-2 | The lead MUST be able to propose team creation autonomously when it determines a task would benefit from parallel work. The user MUST confirm before the team is created. |
| TL-3 | On creation, the system MUST generate a unique team name and a unique `teamId` (UUID). The team config is persisted under the `teamId` directory. |
| TL-4 | The team config MUST contain a `members` array with each teammate's name, agent ID, and agent type. |
| TL-5 | Team config MUST be stored at `~/.copilot/teams/{team-id}/config.json`, where `{team-id}` is a UUID assigned at creation time. |

#### 3.1.2 Team Cleanup

| ID | Requirement |
|----|-------------|
| TL-6 | The user MUST be able to instruct the lead to clean up the team. |
| TL-7 | Cleanup MUST fail with a clear error if any teammates are still running. Teammates must be shut down first. |
| TL-8 | Cleanup MUST remove only the team config file (`config.json`), making the team no longer discoverable. All artifact files (backlog, messages, sprint state, reports, etc.) MUST be preserved in the team directory for future audit. |

#### 3.1.3 Constraints

| ID | Requirement |
|----|-------------|
| TL-9 | Only one team MAY be active per lead session at a time. |
| TL-10 | The lead is fixed for the lifetime of the team — leadership cannot be transferred. |
| TL-11 | Teammates MUST NOT spawn their own teams or teammates (no nesting). |

---

### 3.2 Teammate Management

#### 3.2.1 Spawning

| ID | Requirement |
|----|-------------|
| TM-1 | The lead MUST be able to spawn one or more teammates based on the user's instructions. |
| TM-2 | The user MUST be able to specify the number of teammates to spawn. |
| TM-3 | The user MUST be able to specify the model for each teammate (e.g., "Use GPT-4o for each teammate"). |
| TM-4 | Each spawned teammate MUST load the same project context as a regular Copilot CLI session (e.g., project conventions, MCP servers, skills/tools). |
| TM-5 | Each teammate MUST receive a spawn prompt from the lead that includes task-specific context. The lead's full conversation history MUST NOT carry over. |
| TM-6 | The lead's terminal MUST list all active teammates and their current status/task. |

#### 3.2.2 Permissions & Approval Flow

Teammates operate under a **least-privilege model**. They start with minimum permissions and must request approval from the Team Lead for every privileged operation. The lead acts as a gatekeeper, reviewing each request individually.

| ID | Requirement |
|----|-------------|
| TM-7 | Teammates MUST start with **minimum permissions** at spawn time — no inherited elevated permissions from the lead. |
| TM-8 | The Team Lead MUST NOT approve permissions higher than those the lead itself possesses. |
| TM-9 | When a teammate needs to perform a privileged operation (e.g., file write, shell command, external API call), it MUST send a **permission request** to the Team Lead before executing. |
| TM-10 | The Team Lead MUST review each permission request and make a deliberate decision to **allow** or **disallow** the operation. |
| TM-11 | Permission grants MUST be **single-use**. A grant authorizes exactly one execution of the requested operation. The teammate MUST request approval again for every subsequent execution of the same operation, even if identical. |
| TM-12 | The Team Lead MUST NOT grant blanket or standing permissions to a teammate. Every execution requires a fresh approval. |
| TM-13 | The Team Lead MUST log every permission request and its outcome (approved/denied) to a **permission audit log** file stored at `~/.copilot/teams/{team-name}/permission-audit.log`. |
| TM-14 | Each audit log entry MUST include: timestamp, teammate name/ID, requested operation description, target resource (file path, command, etc.), and the lead's decision (approved/denied) with optional rationale. |
| TM-15 | The permission audit log MUST be append-only and MUST NOT be modified or truncated by teammates. Only the lead (and the user) may read it. |
| TM-16 | If the Team Lead is unavailable or unresponsive, the teammate MUST wait (block) until the lead responds. Teammates MUST NOT bypass the approval flow. |
| TM-17 | The user MUST be able to review the permission audit log at any time to inspect the history of approved and denied operations. |

#### 3.2.3 Shutdown

| ID | Requirement |
|----|-------------|
| TM-18 | The user MUST be able to instruct the lead to shut down a specific teammate. |
| TM-19 | The lead MUST send a shutdown request to the target teammate. |
| TM-20 | The teammate MUST be able to approve (graceful exit) or reject (with explanation) the shutdown request. |
| TM-21 | Teammates MUST finish their current in-progress operation before shutting down. |

If a teammate does not exit gracefully within a configurable timeout after shutdown is requested, the Lead MAY force terminate the subprocess.

---

### 3.3 Task Management

#### 3.3.1 Task List

| ID | Requirement |
|----|-------------|
| TS-1 | The system MUST maintain a shared, persistent task list per team. |
| TS-2 | Task list MUST be stored at `~/.copilot/teams/{team-name}/backlog.md`. |
| TS-3 | All team members (lead and teammates) MUST be able to read the task list. |
| TS-4 | Only the lead MUST be able to create, update, and delete tasks. Task management is done via communication from teammates to the Team Lead. |

#### 3.3.2 Task States

| ID | Requirement |
|----|-------------|
| TS-5 | Each task MUST have one of three states: `pending`, `in_progress`, `completed`. |
| TS-6 | Tasks MAY have dependencies on other tasks. |
| TS-7 | A `pending` task with unresolved dependencies MUST NOT be claimable until all dependencies are `completed`. |
| TS-8 | When a task's dependencies become completed, unblocking MUST occur via the Team Lead. The Lead guarantees atomic task state transitions. |

#### 3.3.3 Task Assignment & Claiming

| ID | Requirement |
|----|-------------|
| TS-9 | The lead MUST be able to explicitly assign a task to a specific teammate. |
| TS-10 | Teammates request task claims via the Lead. The Lead performs the atomic claim operation to prevent race conditions. |
| TS-11 | Teammates MUST only work on tasks assigned to them within the current sprint. When a teammate completes all assigned tasks, it MUST remain idle until the next sprint begins. |
| TS-12 | Task claiming MUST be mediated by the Lead. Teammates request task claims via the Lead, and the Lead performs the atomic claim operation to prevent race conditions when multiple teammates attempt to claim the same task simultaneously. |

#### 3.3.4 Task Complexity Estimation

Tasks are sized by complexity, not count. Teammates collectively estimate each task using a **planning poker** process, and the lead balances assignments based on capacity.

**Complexity Sizes**

| Size | Weight | Description |
|------|--------|-------------|
| **S** (Small) | 1 | Trivial change, well-understood, minimal risk |
| **M** (Medium) | 1.33 | Moderate scope, some unknowns |
| **L** (Large) | 2 | Significant scope, multiple unknowns or cross-cutting concerns |
| **XL** (Extra Large) | 4 | High complexity, major unknowns, broad impact |

**Capacity per Teammate per Iteration**

Each teammate has a capacity of **4 weight points** per iteration (sprint). This means:

- 1 XL task, **or**
- 2 L tasks, **or**
- 3 M tasks, **or**
- 4 S tasks, **or**
- any combination that does not exceed 4 points

| ID | Requirement |
|----|-------------|
| TS-13 | Each task MUST be assigned a complexity size: **S**, **M**, **L**, or **XL**. Tasks without a size MUST NOT be assigned to a teammate. |
| TS-14 | Complexity MUST be estimated via **planning poker**: all teammates independently assess the task, and the **most frequently chosen size** (mode) is assigned. In case of a tie, the higher size MUST be used. |
| TS-15 | The lead MUST facilitate the planning poker process before an iteration begins. Teammates MUST NOT see each other's estimates until all have submitted (to avoid anchoring bias). |
| TS-16 | Each teammate MUST NOT be assigned tasks exceeding **4 weight points** per iteration (S=1, M=1.33, L=2, XL=4). |
| TS-17 | The lead MUST balance task assignments across teammates so that total weight is distributed as evenly as possible. No teammate should be significantly over- or under-loaded relative to others. |
| TS-18 | If a task is estimated as XL, the lead SHOULD consider whether it can be decomposed into smaller tasks before assigning it. |
| TS-19 | Tasks SHOULD be self-contained units that produce a clear deliverable (a function, a test file, a review). |

The Lead MUST reject any assignment that exceeds the teammate's sprint capacity (maximum 4 weight points).

#### 3.3.5 Sprint Lifecycle

Each team operates in discrete sprints (iterations).

**Sprint Definition**

A sprint:

- Begins when the Lead selects a set of tasks and initiates planning poker.
- Includes estimation, assignment, and execution.
- Ends when all tasks assigned for that sprint are completed.

**Sprint State File**

Sprint state MUST be stored at:

    ~/.copilot/teams/{team-name}/sprint.md

Each sprint MUST be recorded as an append-only section with the following structure:

    Sprint #[Number]
    Status: planning | active | closed
    StartedAt: [timestamp]
    ClosedAt: [timestamp or null]

    [Teammate] - [Task ID] - [Task Title] - [Estimate]

Sprint sections MUST NOT be modified once closed.

The Lead is the only process allowed to append to this file.

---

### 3.4 Communication

The user MUST communicate only with the Team Lead. Direct user-to-teammate control is not permitted. The Lead remains the sole authority for coordination, approvals, and state mutation.

#### 3.4.1 Messaging

| ID | Requirement |
|----|-------------|
| CM-1 | The system MUST provide a mailbox-based messaging mechanism for inter-agent communication. |
| CM-2 | Any team member MUST be able to request the Team Lead to send a message to a specific teammate. |
| CM-3 | Any team member MUST be able to request the Team Lead to broadcast a message to all teammates. |
| CM-4 | Broadcast SHOULD be used sparingly; the system SHOULD warn that costs scale with team size. |
| CM-5 | Messages MUST be delivered automatically to recipients. The lead MUST NOT need to poll for updates. |

All messages are written by the Lead. Messaging is append-only.

**Mailbox Storage**

Messages MUST be stored at:

    ~/.copilot/teams/{team-name}/messages.md

Each message entry MUST include:

- Timestamp
- Message ID (monotonic counter)
- From ID
- To ID (or BROADCAST)
- Message body

Messages MUST be append-only.

#### 3.4.2 Notifications

| ID | Requirement |
|----|-------------|
| CM-6 | When a teammate finishes and goes idle, it MUST automatically notify the lead. |
| CM-7 | The lead MUST receive teammate messages automatically (push, not poll). |

#### 3.4.3 User ↔ Teammate Visibility

| ID | Requirement |
|----|-------------|
| CM-8 | The user MUST be able to view any individual teammate's session output. All control and instructions MUST go through the Team Lead. |
| CM-9 | In in-process mode, the user MUST be able to cycle through teammates using a keyboard shortcut (e.g., Shift+Down) to view their output. |
| CM-10 | In split-pane mode, the user MUST be able to click into a teammate's pane to view their output. |

---

### 3.5 Display Modes

#### 3.5.1 In-Process Mode

| ID | Requirement |
|----|-------------|
| DM-1 | All teammates MUST run inside the lead's terminal in in-process mode. |
| DM-2 | The user MUST be able to cycle through teammates using Shift+Down. After the last teammate, it MUST wrap back to the lead. |
| DM-3 | The user MUST be able to press Enter to view a teammate's session and Escape to interrupt their current turn. |
| DM-4 | The user MUST be able to toggle the task list view (e.g., Ctrl+T). |
| DM-5 | In-process mode MUST work in any terminal with no extra setup. |

#### 3.5.2 Split-Pane Mode

| ID | Requirement |
|----|-------------|
| DM-6 | Each teammate MUST get its own terminal pane in split-pane mode. |
| DM-7 | The user MUST be able to see all teammates' output simultaneously. |
| DM-8 | Split-pane mode MUST support tmux and iTerm2 (via `it2` CLI). |
| DM-9 | The system MUST auto-detect whether to use tmux or iTerm2 based on the current terminal environment. |

#### 3.5.3 Mode Selection

| ID | Requirement |
|----|-------------|
| DM-10 | The default display mode MUST be `"auto"`: use split panes if already inside a tmux session, otherwise fall back to in-process. |
| DM-11 | The user MUST be able to override the display mode via a settings file (`teammateMode` in settings). |
| DM-12 | The user MUST be able to override the display mode per session via a CLI flag (e.g., `--teammate-mode in-process`). |

---

### 3.6 Plan Approval

| ID | Requirement |
|----|-------------|
| PA-1 | The user MUST be able to require a teammate to operate in read-only plan mode before implementing. |
| PA-2 | When a teammate finishes planning, it MUST send a plan approval request to the lead. |
| PA-3 | The lead MUST be able to approve or reject the plan. |
| PA-4 | If rejected, the lead MUST provide feedback. The teammate MUST stay in plan mode, revise, and resubmit. |
| PA-5 | Once approved, the teammate MUST exit plan mode and begin implementation. |
| PA-6 | The lead makes approval decisions autonomously. The user MUST be able to influence approval criteria via prompt (e.g., "only approve plans that include test coverage"). |

A teammate MAY submit at most three plan revisions per task. If three consecutive plans are rejected, the task MUST return to the backlog and be reconsidered during the next sprint planning. The teammate MAY remain idle for the remainder of the sprint.

---

### 3.7 Quality Gates (Hooks)

| ID | Requirement |
|----|-------------|
| QG-1 | The system MUST support hooks that run at defined lifecycle points. |
| QG-2 | A `TeammateIdle` hook MUST run when a teammate is about to go idle. Exiting with a specific code (e.g., code 2) MUST send feedback to the teammate and keep it working. |
| QG-3 | A `TaskCompleted` hook MUST run when a task is being marked as complete. Exiting with a specific code (e.g., code 2) MUST prevent completion and send feedback. |
| QG-4 | Hooks MUST be configurable via the project's hook configuration (consistent with existing Copilot CLI hook mechanisms). |

---

## 4. Non-Functional Requirements

### 4.1 Token & Cost Efficiency

| ID | Requirement |
|----|-------------|
| NF-1 | The system MUST document that token usage scales linearly with the number of active teammates (each has its own context window). |
| NF-2 | The system SHOULD warn the user about token cost implications before creating large teams. |
| NF-3 | Broadcast messages SHOULD include a cost warning since they scale with team size. |

### 4.2 Concurrency & Conflict Avoidance

| ID | Requirement |
|----|-------------|
| NF-4 | Task claiming MUST be concurrency-safe (file locking or equivalent). |
| NF-5 | The system SHOULD guide the lead to partition work so that each teammate owns a different set of files, avoiding same-file edit conflicts. |
| NF-6 | Two teammates SHOULD NOT edit the same file. The system SHOULD detect and warn about potential file conflicts. |

**File Conflict Detection (Lead-Mediated)**

File coordination MUST be stored at:

    ~/.copilot/teams/{team-name}/files.md

Each entry MUST follow:

    [Timestamp] [TeammateID] [TaskID] [FilePath] [Status: in-use | free]

Rules:

- Teammates MUST request file claims via the Lead.
- The Lead MUST deny claims if another teammate currently holds an active "in-use" lease.
- File status changes MUST be recorded as new appended entries.
- Prior entries MUST NOT be modified.

### 4.3 Resilience

| ID | Requirement |
|----|-------------|
| NF-7 | If a teammate crashes or stops on an error, the lead MUST be notified. |
| NF-8 | The user MUST be able to give a stopped teammate additional instructions or spawn a replacement. |
| NF-9 | The system SHOULD handle orphaned processes gracefully (e.g., orphaned tmux sessions after unclean shutdown). |

Each teammate MUST run as a subprocess managed by the Lead process, enabling crash detection and forced termination if required.

### 4.4 Local-Only Operation

| ID | Requirement |
|----|-------------|
| NF-10 | All team coordination (config, tasks, mailbox) MUST be stored and executed locally. No cloud orchestration layer is required. |
| NF-11 | Team config, task lists, and mailbox state MUST be stored under well-known local paths (`~/.copilot/teams/{team-name}/`). |

---

## 5. Configuration

| ID | Requirement |
|----|-------------|
| CF-1 | Copilot Teams MUST be disabled by default. |
| CF-2 | The feature MUST be enabled via an environment variable (e.g., `COPILOT_TEAMS_ENABLED=1`) or a settings file entry. |
| CF-3 | Display mode MUST be configurable via `teammateMode` in `settings.json` with values: `"auto"`, `"in-process"`, `"tmux"`. |
| CF-4 | CLI flag `--teammate-mode <mode>` MUST override the settings file for the current session. |

---

## 6. Known Limitations (v1)

These are accepted limitations for the initial release, consistent with the reference architecture:

| ID | Limitation |
|----|-----------|
| LM-1 | **No session resumption with in-process teammates.** Resume/rewind does not restore in-process teammates. After resuming, the lead may attempt to message non-existent teammates. Workaround: spawn new teammates. |
| LM-2 | **Task status can lag.** Teammates may fail to mark tasks as completed, blocking dependent tasks. Workaround: manual status update or lead nudge. |
| LM-3 | **Shutdown can be slow.** Teammates finish their current operation before shutting down. |
| LM-4 | **One team per session.** Clean up the current team before starting a new one. |
| LM-5 | **No nested teams.** Teammates cannot spawn their own teams. |
| LM-6 | **Lead is fixed.** Leadership cannot be transferred or promoted. |
| LM-7 | **Permissions are single-use only.** Every privileged operation requires a fresh approval from the lead, which may slow down teammates on repetitive tasks. This is by design for safety and auditability. |

---

## 7. Use Case Examples

These are representative scenarios the system MUST support well:

### 7.1 Parallel Code Review

> Create a team to review PR #142. Spawn three reviewers: one focused on security, one on performance, one on test coverage. Have them each review and report findings.

Each reviewer applies a different lens. The lead synthesizes findings.

### 7.2 Competing Hypothesis Debugging

> Users report the app exits after one message. Spawn 5 teammates to investigate different hypotheses. Have them talk to each other to disprove each other's theories. Update findings with the consensus.

Adversarial debate structure prevents anchoring bias.

### 7.3 New Feature — Cross-Layer Coordination

> Build a new user profile page. Spawn teammates for: frontend component, backend API, database migration, and tests. Each owns their layer.

Teammates work in parallel on independent layers, coordinating through the task list.

### 7.4 Research & Exploration

> Designing a CLI tool for tracking TODOs. Create a team: one on UX, one on architecture, one as devil's advocate.

Independent exploration with synthesis by the lead.

---

## 8. Best Practices (to encode in system behavior)

The system SHOULD embed these practices into the lead's coordination behavior:

1. **Give teammates enough context** — include task-specific details in spawn prompts; don't rely on conversation history carrying over.
2. **Right-size the team** — start with 3–5 teammates; scale up only when genuinely beneficial.
3. **Right-size the tasks** — 5–6 tasks per teammate; self-contained deliverables.
4. **Avoid file conflicts** — partition work so each teammate owns distinct files.
5. **Wait for teammates** — the lead should not start implementing tasks itself when teammates are working.
6. **Monitor and steer** — check in on progress, redirect failing approaches, synthesize as findings arrive.

---

## Appendix A: Reference

This requirements document is based on the [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) architecture, adapted for the GitHub Copilot CLI ecosystem.

---

## Appendix B: Additional Implemented Features

The following capabilities were implemented beyond the original requirements above. They are documented here for completeness.

### B.1 Batch Task Creation

| ID | Feature |
|----|---------|
| EX-1 | The MCP server provides an `add_tasks` tool for batch-creating multiple tasks in a single call, reducing round-trips when seeding a backlog. |

### B.2 Report Submission & Retrieval

| ID | Feature |
|----|---------|
| EX-2 | Teammates can submit detailed findings reports per task via `submit_report`. Reports are stored as Markdown files under `~/.copilot/teams/{team-name}/reports/`. |
| EX-3 | The Lead can retrieve individual reports (`get_report`) or a consolidated view of all reports (`get_all_reports`). |

### B.3 Auto-Orchestration

| ID | Feature |
|----|---------|
| EX-4 | The `run_team` MCP tool provides end-to-end orchestration: task creation, teammate spawning, sprint execution, automatic crash recovery (with respawn up to 3 retries), and report collection — all in a single tool call. |

### B.4 MCP Server Integration

| ID | Feature |
|----|---------|
| EX-5 | The system exposes all coordination operations as 46 MCP tools via `copilot-teams-mcp`, enabling natural-language-driven orchestration through GitHub Copilot CLI. |
| EX-6 | Most MCP tools auto-detect the active team name, reducing the need for explicit parameters. |

### B.5 Extended Plan Approval Tools

| ID | Feature |
|----|---------|
| EX-7 | The MCP server exposes `enter_plan_mode`, `submit_plan`, and `set_approval_criteria` as standalone tools, in addition to the `list_pending_plans` and `review_plan` tools from the original requirements. |

### B.6 File Claim Tools

| ID | Feature |
|----|---------|
| EX-8 | `claim_file` and `release_file` are exposed as MCP tools, allowing teammates to explicitly request and release file ownership through the Lead. |

### B.7 Permission Management Tools

| ID | Feature |
|----|---------|
| EX-9 | The MCP server provides `request_permission`, `review_permission`, `read_audit_log`, and `list_pending_permissions` as dedicated tools for the full permission lifecycle. |
