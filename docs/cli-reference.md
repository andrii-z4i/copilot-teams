# Copilot Teams — CLI Reference

This document covers the direct CLI usage of `copilot-teams` and the full list of MCP tools exposed by `copilot-teams-mcp`. For a quick-start guide focused on MCP usage, see the [README](../README.md).

---

## Installation

```bash
npm install
npm run build
npm link          # makes 'copilot-teams' and 'copilot-teams-mcp' available globally
```

---

## MCP Server Setup

Add the MCP server to your Copilot CLI config:

**Option A — Repo-level** (`.copilot/mcp-config.json` in your project):

```json
{
  "mcpServers": {
    "copilot-teams": {
      "type": "stdio",
      "command": "copilot-teams-mcp",
      "args": []
    }
  }
}
```

**Option B — User-level** (`~/.copilot/mcp-config.json`):

```json
{
  "mcpServers": {
    "copilot-teams": {
      "type": "stdio",
      "command": "copilot-teams-mcp",
      "args": []
    }
  }
}
```

> If you haven't run `npm link`, use the full path:
> `"command": "node", "args": ["/path/to/copilot-teams/dist/mcp-server.js"]`

---

## Available MCP Tools (46)

### Team Lifecycle

| Tool | Description |
|------|-------------|
| `create_team` | Create a new team (you become the Lead) |
| `list_teams` | List all teams |
| `show_team` | Show team details and members |
| `cleanup_team` | Remove the team config (preserves artifact files for audit) |

### Teammate Management

| Tool | Description |
|------|-------------|
| `spawn_teammate` | Spawn a new AI teammate process |
| `list_teammates` | List teammates and their status |
| `shutdown_teammate` | Graceful teammate shutdown |
| `force_stop_teammate` | Force-stop unresponsive teammate |

### Task Management

| Tool | Description |
|------|-------------|
| `add_task` | Add a single task to the backlog |
| `add_tasks` | Batch-create multiple tasks at once |
| `list_tasks` | List tasks (optionally filter by status) |
| `update_task` | Update task status/title/complexity |
| `assign_task` | Assign a task to a teammate |
| `delete_task` | Remove a task |

### Sprint Management

| Tool | Description |
|------|-------------|
| `start_sprint` | Start a new sprint with selected tasks |
| `activate_sprint` | Activate sprint with task assignments |
| `close_sprint` | Close sprint, return unfinished tasks |
| `show_sprint` | Show current or specific sprint |
| `list_sprints` | List all sprints |

### Communication

| Tool | Description |
|------|-------------|
| `send_message` | Send message to a specific teammate |
| `broadcast_message` | Broadcast to all teammates |
| `read_messages` | Read messages (all or filtered) |

### Status & Monitoring

| Tool | Description |
|------|-------------|
| `team_status` | Full dashboard: team, tasks, sprint, files |

### Plan Approval

| Tool | Description |
|------|-------------|
| `enter_plan_mode` | Put teammate into read-only exploration mode |
| `submit_plan` | Teammate submits implementation plan for review |
| `list_pending_plans` | Plans awaiting your approval |
| `review_plan` | Approve or reject a teammate's plan |
| `set_approval_criteria` | Define evaluation criteria for plan reviews |

### File Claims

| Tool | Description |
|------|-------------|
| `claim_file` | Claim ownership of a file before editing |
| `release_file` | Release a file lease |
| `list_file_claims` | Active file ownership claims |
| `detect_file_conflicts` | Check for file conflicts |

### Reports

| Tool | Description |
|------|-------------|
| `submit_report` | Teammate submits detailed findings for a task |
| `get_report` | Retrieve a specific teammate's report |
| `get_all_reports` | Get all reports in a consolidated view |

### Auto-Orchestration

| Tool | Description |
|------|-------------|
| `run_team` | End-to-end workflow: create tasks, spawn teammates, run sprint, collect reports |

### Planning Poker

| Tool | Description |
|------|-------------|
| `start_planning_poker` | Start an estimation session for tasks |
| `submit_estimate` | Teammate submits a complexity estimate |
| `resolve_estimates` | Resolve estimates (mode selection; ties → higher size) |
| `balance_assignments` | Distribute tasks by weight across teammates |

### Permission Management

| Tool | Description |
|------|-------------|
| `request_permission` | Teammate requests approval for a privileged operation |
| `review_permission` | Lead approves or denies a permission request |
| `read_audit_log` | Show all permission decisions |
| `list_pending_permissions` | List permission requests awaiting approval |

### Hooks

| Tool | Description |
|------|-------------|
| `list_hooks` | Show configured lifecycle hooks |
| `save_hooks` | Configure hooks for TeammateIdle or TaskCompleted events |

Most tools auto-detect the team name — no need to specify `team_name` if only one team exists.

---

## Direct CLI Usage

You can also use `copilot-teams` directly from the command line.

### Quick Start

#### 1. Create a team

```bash
copilot-teams team create --session-id my-session
```
```
✓ Team created: swift-falcon-a3b2
  Lead session: my-session
  Created at:   2026-02-26T15:00:00.000Z
```

#### 2. Add tasks

```bash
copilot-teams task add --id TASK-1 --title "Implement auth" --desc "JWT auth module"
copilot-teams task add --id TASK-2 --title "Add API routes" --deps TASK-1
copilot-teams task list
```
```
  [pending] TASK-1: Implement auth
  [pending] TASK-2: Add API routes (blocked)

2 tasks (1 ready)
```

#### 3. Spawn teammates

```bash
copilot-teams teammate spawn tm-1 --type coder --prompt "Implement JWT auth"
copilot-teams teammate spawn tm-2 --type coder --prompt "Build API routes"
copilot-teams teammate list
```
```
✓ Spawned tm-1 (pid: 12345)
✓ Spawned tm-2 (pid: 12346)
  tm-1 [active] (coder) pid=12345
  tm-2 [active] (coder) pid=12346
```

#### 4. Run a sprint

```bash
# Start planning
copilot-teams sprint start 1 --tasks TASK-1,TASK-2

# Activate with assignments
copilot-teams sprint activate 1 --assignments '[
  {"teammate":"tm-1","taskId":"TASK-1","taskTitle":"Implement auth","estimate":"M"},
  {"teammate":"tm-2","taskId":"TASK-2","taskTitle":"Add API routes","estimate":"L"}
]'

# Check current sprint
copilot-teams sprint show
```
```
Sprint #1 [active]
  Started: 2026-02-26T15:01:00.000Z
  Assignments:
    tm-1 → TASK-1: Implement auth [M]
    tm-2 → TASK-2: Add API routes [L]
```

#### 5. Send messages

```bash
copilot-teams msg send tm-1 "Focus on TASK-1 first"
copilot-teams msg broadcast "Sprint review in 5 minutes"
copilot-teams msg list
```

#### 6. Check status

```bash
copilot-teams status
```
```
╔══ Team: swift-falcon-a3b2 ══╗
  Lead: my-session
  Created: 2026-02-26T15:00:00.000Z

── Teammates (2) ──
  ● tm-1 [active] (coder)
  ● tm-2 [active] (coder)

── Tasks (2) ──
  Pending: 1  In Progress: 1  Completed: 0
  ▸ TASK-1: Implement auth → @tm-1

── Sprint ──
  Sprint #1 [active]
    tm-1 → TASK-1 [M]
    tm-2 → TASK-2 [L]
```

#### 7. Complete the workflow

```bash
# Update task status
copilot-teams task update TASK-1 --status completed

# Close sprint when done
copilot-teams sprint close 1

# Shut down teammates
copilot-teams teammate shutdown tm-1
copilot-teams teammate shutdown tm-2

# Clean up
copilot-teams team cleanup
```

---

### Worked example: permission request, review, and audit log

This walkthrough shows the complete flow when a teammate needs approval for a privileged operation.

#### 1. Teammate requests a permission

While working on a task, `tm-1` needs to run a shell command and calls `request_permission` (or the Lead calls it on the teammate's behalf via the MCP tool):

```bash
# MCP tool call made by tm-1 (or the Lead on its behalf):
# request_permission(
#   teammateName: "tm-1",
#   operation:    "shell_command",
#   description:  "Run database migration",
#   targetResource: "npm run db:migrate"
# )
```

The request is stored as pending and `tm-1` blocks until the Lead responds.

#### 2. Lead reviews pending requests

```bash
copilot-teams permission pending
```
```
Pending permission requests (1):
  [0] id: req-abc123
      teammate: tm-1
      operation: shell_command
      target:   npm run db:migrate
      description: Run database migration
      requested: 2026-02-27T13:00:00.000Z
```

#### 3. Lead approves (or denies) the request

```bash
# MCP tool call (or via Copilot: "Approve req-abc123 — the migration is safe"):
# review_permission(
#   requestId: "req-abc123",
#   decision:  "approved",
#   rationale: "Migration script reviewed and safe to run"
# )
```

`tm-1` unblocks immediately and executes `npm run db:migrate`.

If the Lead had denied it:
```bash
# review_permission(requestId: "req-abc123", decision: "denied",
#                   rationale: "Not within current sprint scope")
# tm-1 receives denied — must not perform the operation
```

#### 4. Verify the audit log

Every decision (approved **and** denied) is appended to `permission-audit.log`:

```bash
copilot-teams permission audit-log
```
```
Permission audit log — 1 entry
  [2026-02-27T13:00:05.123Z] tm-1  shell_command  npm run db:migrate
    decision: approved
    rationale: Migration script reviewed and safe to run
```

Directly inspect the file:
```bash
cat ~/.copilot/teams/<team-id>/permission-audit.log
```
```json
{"timestamp":"2026-02-27T13:00:05.123Z","teammate":"tm-1","operation":"shell_command","target":"npm run db:migrate","decision":"approved","rationale":"Migration script reviewed and safe to run"}
```

The file is **append-only**: every subsequent permission decision adds a new JSON line. The file is created when the team is created (even if no permissions are ever requested), and is preserved after `team cleanup` so the audit trail is never lost.

---

### `copilot-teams team`

| Command | Description |
|---------|-------------|
| `team create` | Create a new team (you become the Lead) |
| `team show` | Show team configuration and members |
| `team cleanup` | Remove team config, preserving artifact files (all teammates must be stopped) |

Options: `--team-name <name>`, `--session-id <id>`

### `copilot-teams teammate`

| Command | Description |
|---------|-------------|
| `teammate spawn <name>` | Spawn a new teammate process |
| `teammate list` | List all teammates and statuses |
| `teammate shutdown <name>` | Graceful shutdown (teammate can negotiate) |
| `teammate kill <name>` | Force-terminate unresponsive teammate |

Options: `--type <type>`, `--model <model>`, `--prompt <text>`

### `copilot-teams task`

| Command | Description |
|---------|-------------|
| `task add` | Add a new task to the backlog |
| `task list` | List all tasks with status |
| `task update <id>` | Update task status or fields |
| `task assign <id> <teammate>` | Assign a task to a teammate |
| `task claim <teammate>` | Teammate claims next available task |
| `task delete <id>` | Remove a task |

Options: `--id`, `--title`, `--desc`, `--deps <id,id,...>`, `--status`, `--assignee`

### `copilot-teams sprint`

| Command | Description |
|---------|-------------|
| `sprint start <number>` | Start a new sprint (planning phase) |
| `sprint activate <number>` | Transition sprint to active |
| `sprint close <number>` | Close sprint, unfinished tasks return to backlog |
| `sprint show` | Show current sprint |
| `sprint list` | List all sprints |

Options: `--tasks <id,id,...>`, `--assignments <json>`

### `copilot-teams msg`

| Command | Description |
|---------|-------------|
| `msg send <to> <message>` | Send a message to a teammate |
| `msg broadcast <message>` | Broadcast to all teammates |
| `msg read <recipient>` | Read messages for a recipient |
| `msg list` | List all messages |

Options: `--from <name>`, `--since <id>`

### `copilot-teams status`

Shows a dashboard with team info, teammates, tasks, sprint, file claims, and crash alerts. No subcommands.

### `copilot-teams plan`

| Command | Description |
|---------|-------------|
| `plan enter <teammate> <task-id>` | Put teammate in read-only plan mode |
| `plan submit <teammate> <task-id>` | Submit plan for Lead review |
| `plan review <request-id> <decision>` | Approve or reject a plan |
| `plan pending` | List pending plan approvals |
| `plan history <teammate> <task-id>` | Show revision history |
| `plan criteria` | Show or set approval criteria |

Options: `--plan <text>`, `--feedback <text>`, `--set <criteria>`

### `copilot-teams hook`

| Command | Description |
|---------|-------------|
| `hook list` | List configured lifecycle hooks |
| `hook add` | Add a hook (TeammateIdle or TaskCompleted) |
| `hook clear` | Remove all hooks |

Options: `--event <event>`, `--command <cmd>`, `--cwd <dir>`

Hook exit code 2 = **veto** — prevents the transition and sends stdout as feedback.

### `copilot-teams file`

| Command | Description |
|---------|-------------|
| `file claim <tm> <task> <path>` | Claim a file (denied if held by another) |
| `file release <tm> <task> <path>` | Release a file lease |
| `file list` | List active file claims |
| `file conflicts` | Detect file conflicts |
| `file suggest` | Suggest file partitioning |

Options: `--files <path,...>`, `--teammates <name,...>`

### `copilot-teams display`

| Command | Description |
|---------|-------------|
| `display show` | Show current display mode |
| `display detect` | Detect terminal environment |

Options: `--teammate-mode <mode>` (in-process, tmux, auto)

---

## Global Options

These work with any command:

| Option | Description |
|--------|-------------|
| `--team-name <name>` | Target a specific team (default: auto-detect active team) |
| `--session-id <id>` | Your session ID (default: auto-generated) |
| `--help` | Show help for any command |

---

## Configuration

Enable teams (in priority order):

1. CLI flag: `--teams-enabled`
2. Env var: `COPILOT_TEAMS_ENABLED=true`
3. Settings: `~/.copilot/settings.json` → `{ "teams": { "enabled": true } }`

---

## Data Storage

All state lives under `~/.copilot/teams/{team-id}/`, where `{team-id}` is a UUID v4 assigned at team creation:

```
config.json          Team configuration (removed on cleanup; all other files are kept)
backlog.md           Task list
sprint.md            Sprint lifecycle
messages.md          Mailbox (append-only)
files.md             File claims (append-only)
plans.json           Plan approvals
hooks.json           Hook configuration
reports/             Teammate findings (one .md per task/teammate)
permission-audit.log Audit trail (append-only)
```

The human-readable team name (e.g., `swift-falcon-a3b2`) is stored inside `config.json` and is used in CLI commands and MCP tool calls (`--team-name`). On cleanup, only `config.json` is deleted; all artifact files are preserved for future audit.

---

## Key Concepts

### Single-Writer Invariant
Only the **Team Lead** writes to shared coordination files. This eliminates write conflicts by design.

### Plan → Implement Workflow
Teammates can be required to operate in **plan mode** first — explore code and produce a plan, then submit for Lead approval. After 3 rejected revisions, the task returns to the backlog.

### Display Modes
- **In-process**: All teammates in one terminal. Shift+Down cycles, Ctrl+T toggles task list.
- **tmux**: Each teammate gets its own pane. Auto-detected via `$TMUX`.
- **iTerm2**: Split panes via `it2` CLI.

### Lifecycle Hooks
Configure shell commands that run at lifecycle events. Exit code 2 = veto (prevents transition, sends feedback).

```bash
copilot-teams hook add --event TaskCompleted --command "npm test"
```

---

## Running Tests

```bash
npm test        # run tests
npm run build   # compile TypeScript
```
