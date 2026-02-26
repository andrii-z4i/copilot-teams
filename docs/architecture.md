# Copilot Teams — Architecture

This document describes the system architecture for Copilot Teams, a local coordination layer that enables multiple Copilot CLI instances to work together on complex tasks.

---

## 1. System Overview

Copilot Teams follows a **hub-and-spoke** architecture with a single Team Lead orchestrating N independent Teammate processes. All coordination happens locally via the file system — no cloud services, no network layer.

```
┌─────────────────────────────────────────────────────┐
│                    USER (Terminal)                  │
│                                                     │
│   Communicates only with Team Lead                  │
│   Views teammate output (read-only)                 │
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────▼────────┐
              │   TEAM LEAD     │
              │  (Copilot CLI)  │
              │                 │
              │  • Orchestrator │
              │  • Single writer│
              │  • Gatekeeper   │
              └──┬────┬────┬──-─┘
                 │    │    │
        ┌────────┘    │    └────────┐
        ▼             ▼             ▼
  ┌───────────┐ ┌───────────┐ ┌───────────┐
  │ Teammate A│ │ Teammate B│ │ Teammate C│
  │ (CLI proc)│ │ (CLI proc)│ │ (CLI proc)│
  │           │ │           │ │           │
  │ Own ctx   │ │ Own ctx   │ │ Own ctx   │
  │ Own model │ │ Own model │ │ Own model │
  └───────────┘ └───────────┘ └───────────┘
        │             │             │
        └─────────────┼─────────────┘
                      ▼
        ┌─────────────────────────┐
        │   SHARED FILE SYSTEM    │
        │  ~/.copilot/teams/{id}/ │
        │                         │
        │  config.json            │
        │  backlog.md             │
        │  sprint.md              │
        │  messages.md            │
        │  files.md               │
        │  permission-audit.log   │
        └─────────────────────────┘
```

**Key invariant:** The Team Lead is the **only process that writes** to shared coordination files. Teammates read shared files and submit requests to the Lead, who performs all mutations atomically under lock.

---

## 2. Component Architecture

```
src/
  config/        # Feature flag, settings loading, CLI flag parsing
  team/          # Team lifecycle (create, cleanup, config persistence)
  teammate/      # Process spawning, shutdown, status tracking
  tasks/         # Backlog, states, assignment, complexity estimation
  comms/         # Mailbox messaging, file-watcher push delivery
  permissions/   # Least-privilege model, audit log, approval flow
  display/       # In-process & split-pane (tmux/iTerm2) modes
  hooks/         # Quality gates (TeammateIdle, TaskCompleted)
  plan/          # Plan-then-implement approval workflow
  sprint/        # Sprint lifecycle, planning poker
  utils/         # File locking, atomic writes, path resolution
  types.ts       # Shared interfaces (TeamConfig, Task, Message, etc.)
  constants.ts   # Well-known paths, states, complexity weights
```

### 2.1 Component Dependency Graph

```
                    config
                      │
                    utils (paths, locks, atomic writes)
                   ╱  │  ╲
                 ╱    │    ╲
              team   comms   tasks
               │      │    ╱  │
               │      │  ╱    │
             teammate─┘╱   sprint
            ╱    │         │
          ╱      │       planning-poker
   permissions  plan
        │
   display ← hooks
```

---

## 3. Data Model

### 3.1 Team Config (`config.json`)

```jsonc
{
  "teamName": "swift-falcon-a3b2",
  "leadSessionId": "session-uuid",
  "createdAt": "2026-02-26T10:00:00Z",
  "members": [
    {
      "name": "security-reviewer",
      "agentId": "agent-uuid-1",
      "agentType": "reviewer",
      "status": "active",     // spawning | active | idle | stopped | crashed
      "pid": 12345,
      "model": "claude-sonnet-4"
    }
  ]
}
```

### 3.2 Task (`backlog.md`)

Each task is a Markdown section with YAML frontmatter:

```markdown
## TASK-001: Implement user auth endpoint

- **Status:** pending | in_progress | completed
- **Assignee:** teammate-name (or unassigned)
- **Complexity:** S | M | L | XL
- **Dependencies:** TASK-000
- **Created:** 2026-02-26T10:00:00Z

Description of the task...
```

**State machine:**

```
pending ──► in_progress ──► completed
   │
   └── (blocked if deps incomplete)
```

No backward transitions. Lead mediates all state changes atomically.

### 3.3 Messages (`messages.md`)

Append-only log. Each entry:

```
[2026-02-26T10:05:00Z] [MSG-042] [lead] [security-reviewer] Review auth module for SQL injection risks
[2026-02-26T10:06:00Z] [MSG-043] [lead] [BROADCAST] Sprint 1 is now active
```

### 3.4 Sprint State (`sprint.md`)

```
Sprint #1
Status: active
StartedAt: 2026-02-26T10:00:00Z
ClosedAt: null

security-reviewer - TASK-001 - Auth endpoint review - M
perf-analyst      - TASK-002 - Profile N+1 queries - L
```

Closed sprint sections are immutable. New sprints are appended.

### 3.5 File Claims (`files.md`)

```
[2026-02-26T10:10:00Z] [security-reviewer] [TASK-001] [src/auth/login.ts] [in-use]
[2026-02-26T10:30:00Z] [security-reviewer] [TASK-001] [src/auth/login.ts] [free]
```

Append-only. Lead denies claims if another teammate holds an active `in-use` lease.

### 3.6 Permission Audit Log (`permission-audit.log`)

```jsonl
{"timestamp":"2026-02-26T10:12:00Z","teammate":"security-reviewer","operation":"file_write","target":"src/auth/login.ts","decision":"approved","rationale":"Within assigned task scope"}
{"timestamp":"2026-02-26T10:13:00Z","teammate":"security-reviewer","operation":"shell_command","target":"rm -rf /","decision":"denied","rationale":"Dangerous command"}
```

Append-only JSONL. Only Lead writes; user and Lead can read.

---

## 4. Coordination Protocol

### 4.1 Single-Writer Invariant

The Lead is the **sole writer** to all shared coordination files. This eliminates race conditions without complex distributed locking:

| File | Lead | Teammates |
|------|------|-----------|
| `config.json` | Read/Write | Read |
| `backlog.md` | Read/Write | Read |
| `sprint.md` | Read/Write (append) | Read |
| `messages.md` | Read/Write (append) | Read |
| `files.md` | Read/Write (append) | Read |
| `permission-audit.log` | Read/Write (append) | No access |

Teammates submit **requests** via IPC to the Lead. The Lead validates, acquires a file lock, performs the mutation, and releases the lock. This is the fundamental coordination pattern for every operation.

### 4.2 Request-Response Flow

```
Teammate                    Lead                     File System
   │                          │                          │
   │── request(claim TASK-3) ─►│                          │
   │                          │── acquireLock() ──────────►│
   │                          │── validate(unblocked?) ──►│
   │                          │── write(backlog.md) ──────►│
   │                          │── releaseLock() ──────────►│
   │◄── response(ok) ─────────│                          │
   │                          │                          │
```

### 4.3 File Locking Strategy

Advisory file locks (via `proper-lockfile` or equivalent) protect against concurrent Lead operations:

- Lock acquired before any shared file mutation
- Lock scope: per-file (not global)
- Stale lock detection with configurable timeout
- Atomic write via temp-file-then-rename pattern

---

## 5. Process Architecture

### 5.1 Teammate Lifecycle

```
            spawn
Lead ──────────────► Teammate Process
                     (child process)
                          │
                     ┌────▼────┐
                     │ spawning │
                     └────┬────┘
                          │ context loaded
                     ┌────▼────┐
                     │  active  │◄──── working on task
                     └────┬────┘
                          │ all tasks done
                     ┌────▼────┐
                     │  idle    │──── TeammateIdle hook
                     └────┬────┘
                          │ shutdown request
                     ┌────▼────┐
                     │ stopped  │
                     └─────────┘
```

Each teammate is a **child process** of the Lead, enabling:
- Crash detection via process exit events
- Forced termination on timeout
- PID tracking for orphan cleanup

### 5.2 Spawn Prompt (Context Injection)

When the Lead spawns a teammate, it constructs a **spawn prompt** — this is the primary mechanism for configuring teammate behavior:

```
┌─────────────────────────────────────────┐
│              SPAWN PROMPT               │
│                                         │
│  • Role description & behavioral rules  │
│  • Task-specific context                │
│  • Team membership info                 │
│  • Communication protocol instructions  │
│  • File ownership boundaries            │
│  • Permission model reminders           │
│                                         │
│  ✗ NO lead conversation history         │
│  ✓ Same project context (cwd, tools)    │
│  ✓ Optional model override              │
└─────────────────────────────────────────┘
```

> **This is the code-vs-prompt boundary** — see §9 for details.

---

## 6. Permission Model

Teammates operate under **least privilege**. Every privileged operation requires a fresh, single-use approval from the Lead.

```
Teammate                    Lead
   │                          │
   │── permissionRequest ────►│
   │   (file_write,           │── validate(lead has perm?)
   │    src/auth/login.ts)    │── decide(approve/deny)
   │                          │── log(audit-log)
   │◄── response(approved) ───│
   │                          │
   │── execute operation ─────│
   │                          │
   │── permissionRequest ────►│  (same op, must re-request)
   │   (file_write,           │
   │    src/auth/login.ts)    │
   ...
```

**Key properties:**
- Single-use grants only — no standing permissions
- Lead cannot grant permissions it doesn't have
- Teammates block until Lead responds
- Every request/response is logged to the audit trail

---

## 7. Sprint & Planning Poker

### 7.1 Sprint Lifecycle

```
         Lead selects tasks
              │
         ┌────▼─────┐
         │ planning  │◄─── planning poker (estimation)
         └────┬──────┘
              │ estimates resolved, tasks assigned
         ┌────▼─────┐
         │  active   │◄─── teammates execute assigned tasks
         └────┬──────┘
              │ all sprint tasks completed
         ┌────▼─────┐
         │  closed   │◄─── unfinished tasks return to backlog
         └──────────┘
```

### 7.2 Capacity Model

| Size | Weight | Example |
|------|--------|---------|
| S | 1 | Trivial fix, well-understood |
| M | 1.33 | Moderate scope, some unknowns |
| L | 2 | Significant scope, cross-cutting |
| XL | 4 | High complexity, major unknowns |

**Capacity per teammate per sprint:** 4 weight points.

Planning poker: all teammates estimate independently → mode wins → ties go to higher size.

---

## 8. Display Architecture

```
resolveDisplayMode(config, cliFlags)
         │
    ┌────┴────┐
    ▼         ▼
 in-process  split-pane
    │         ├── tmux  (detected via $TMUX)
    │         └── iTerm2 (detected via it2 CLI)
    │
    ├── Shift+Down: cycle teammates
    ├── Enter: view session
    ├── Escape: interrupt turn
    └── Ctrl+T: toggle task list
```

**Mode resolution priority:**
1. CLI flag `--teammate-mode` (highest)
2. Settings file `teammateMode`
3. Auto-detect: tmux if inside tmux, else in-process

---

## 9. Code vs. Prompt Injection — The Hybrid Model

A critical architectural decision: **not everything needs to be code**. Copilot Teams uses a two-layer approach.

### Layer 1: Infrastructure (Code)

These MUST be implemented as TypeScript/Node.js modules — they are the coordination substrate:

| Concern | Why code |
|---------|----------|
| File system storage & locking | Correctness requires atomic ops |
| Process spawning & lifecycle | OS-level process management |
| Single-writer coordination | Concurrency safety invariant |
| Display modes (tmux, in-process) | Terminal API integration |
| Permission enforcement & audit log | Security-critical, must be deterministic |
| Hook execution | Shell process management |
| Sprint state machine | State transitions must be validated |

### Layer 2: Behavioral Rules (Prompt Injection)

These can and **should** be injected as prompts when teammates are spawned or when the Lead is initialized:

| Concern | How to inject |
|---------|---------------|
| **Teammate role/persona** | Spawn prompt: "You are a security reviewer. Focus on auth vulnerabilities, injection risks, and access control." |
| **Approval criteria** | Lead system prompt: "Only approve plans that include test coverage for edge cases." (PA-6) |
| **Task-specific context** | Spawn prompt: includes task description, relevant files, acceptance criteria (TM-5) |
| **Communication etiquette** | Spawn prompt: "Use the messaging system to report findings. Be concise. Tag messages with severity." |
| **File ownership boundaries** | Spawn prompt: "You own `src/auth/`. Do not modify files outside your scope." |
| **Best practices** | Lead system prompt: encode §8 best practices (right-size teams, avoid conflicts, wait for teammates) |
| **Review lens** | Spawn prompt: "Review from a performance perspective. Focus on N+1 queries, memory leaks, O(n²) loops." |
| **Plan mode behavior** | Spawn prompt: "You are in plan mode. Explore the codebase and produce a plan. Do NOT modify any files." |
| **Debate/adversarial roles** | Spawn prompt: "You are the devil's advocate. Challenge every assumption. Propose counterexamples." |

### How It Works in Practice

When the user says:

> "Create a team to review PR #142. Spawn three reviewers: one focused on security, one on performance, one on test coverage."

The Lead:

1. **Code path:** Creates team config, spawns 3 child processes, sets up shared files, initializes sprint
2. **Prompt path:** Constructs three different spawn prompts:
   - `"You are a security reviewer. Analyze PR #142 for vulnerabilities..."`
   - `"You are a performance analyst. Profile PR #142 for bottlenecks..."`
   - `"You are a test coverage auditor. Verify PR #142 has adequate tests..."`

Each teammate receives the behavioral prompt as its initial context — no code changes needed to define new roles.

### Prompt Template Architecture

```
┌─────────────────────────────────────────────┐
│              SPAWN PROMPT TEMPLATE           │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ Base Layer (always included)        │    │
│  │ • Team membership & protocol        │    │
│  │ • Permission model rules            │    │
│  │ • Communication instructions        │    │
│  │ • Idle/completion reporting          │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ Role Layer (per-teammate)           │    │
│  │ • Persona & expertise focus         │    │
│  │ • Behavioral guidelines             │    │
│  │ • Quality criteria                  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ Task Layer (per-assignment)         │    │
│  │ • Task description & acceptance     │    │
│  │ • File ownership scope              │    │
│  │ • Relevant context / references     │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ User Layer (optional overrides)     │    │
│  │ • Custom instructions from user     │    │
│  │ • Approval criteria (PA-6)          │    │
│  │ • Project-specific conventions      │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

This layered prompt template means:
- **Adding a new teammate role** = writing a new prompt, not new code
- **Changing approval criteria** = updating the Lead's prompt, not redeploying
- **Task-specific behavior** = composing prompt layers at spawn time

---

## 10. Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js | Aligns with Copilot CLI ecosystem |
| Language | TypeScript | Type safety for complex coordination logic |
| Process management | `child_process` | Native Node.js, no external deps |
| File locking | `proper-lockfile` | Battle-tested advisory locks |
| File watching | `fs.watch` / `chokidar` | Push-based message delivery |
| Terminal UI | Raw `process.stdin` | No external deps for in-process mode |
| Split panes | `tmux` CLI / `it2` CLI | Native terminal multiplexer integration |
| Testing | Vitest or Jest | Standard TS test runners |

---

## 11. Security Considerations

1. **No secrets in shared files** — coordination files contain task metadata, not credentials
2. **Least-privilege by default** — teammates start with zero permissions
3. **Audit trail** — every privileged operation is logged with full context
4. **No network exposure** — all coordination is local file system
5. **Process isolation** — each teammate is a separate OS process
6. **Single-use permissions** — prevents permission accumulation attacks

---

## 12. Known Limitations (v1)

| Limitation | Impact | Mitigation |
|-----------|--------|------------|
| No session resumption for in-process teammates | Lost teammates on resume | Spawn new teammates |
| Task status can lag | Dependent tasks blocked | Manual override by Lead |
| One team per session | Can't run parallel teams | Clean up before creating new |
| No nested teams | Teammates can't delegate | Decompose tasks instead |
| Fixed leadership | No failover | User restarts if Lead crashes |
| Single-use permissions slow repetitive ops | Teammate throughput | By design for safety |
| Append-only files grow unbounded | Disk usage over long sessions | Team cleanup removes all files |

---

## Appendix: Requirement Traceability

| Architecture Section | Requirement IDs |
|---------------------|----------------|
| §3 Data Model | NF-10, NF-11, TL-5, TS-2 |
| §4 Coordination Protocol | NF-4, §2.1 Single-Writer Invariant |
| §5 Process Architecture | TM-1–TM-6, NF-7–NF-9 |
| §6 Permission Model | TM-7–TM-17 |
| §7 Sprint & Planning Poker | TS-5–TS-19, §3.3.5 |
| §8 Display Architecture | DM-1–DM-12, CM-8–CM-10 |
| §9 Code vs. Prompt | TM-5, PA-6, §8 Best Practices |
| §10 Technology Stack | CF-1–CF-4 |
