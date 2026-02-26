# Copilot Teams

A command-line tool for coordinating multiple GitHub Copilot CLI instances. One session acts as the **Team Lead**, orchestrating work across independently running **Teammate** processes.

All coordination happens locally via the file system — no cloud services, no network layer.

```
         ┌──────────┐
         │   USER   │  (communicates only with Lead)
         └────┬─────┘
              │
         ┌────▼─────┐
         │   LEAD   │  orchestrator · single writer · gatekeeper
         └──┬──┬──┬─┘
            │  │  │
     ┌──────┘  │  └──────┐
     ▼         ▼         ▼
 ┌────────┐┌────────┐┌────────┐
 │  TM-1  ││  TM-2  ││  TM-3  │  independent CLI processes
 └────────┘└────────┘└────────┘
     │         │         │
     └─────────┼─────────┘
               ▼
    ~/.copilot/teams/{team}/
```

## Installation

```bash
npm install
npm run build
npm link          # makes 'copilot-teams' and 'copilot-teams-mcp' available globally
```

## Usage: MCP Server (Recommended)

The easiest way to use copilot-teams is through GitHub Copilot CLI's MCP integration. Instead of memorizing commands, just talk naturally — Copilot calls the right tools for you.

### Setup

Add the MCP server to your Copilot CLI config:

**Option A — Repo-level** (`.copilot/mcp-config.json` in your project):

```json
{
  "mcpServers": {
    "copilot-teams": {
      "type": "stdio",
      "command": "copilot-teams-mcp"
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
      "command": "copilot-teams-mcp"
    }
  }
}
```

> If you haven't run `npm link`, use the full path:
> `"command": "node", "args": ["/path/to/copilot-teams/dist/mcp-server.js"]`

### Natural Language Examples

Once configured, just talk to GitHub Copilot CLI:

```
You: "Create a team for this project"
→ Copilot calls create_team

You: "Add three tasks: auth module, API routes, and tests"
→ Copilot calls add_task × 3

You: "Spin up two coders — one for auth, one for API"
→ Copilot calls spawn_teammate × 2

You: "Start sprint 1 with all pending tasks"
→ Copilot calls start_sprint

You: "What's the team status?"
→ Copilot calls team_status

You: "Shut everyone down and clean up"
→ Copilot calls shutdown_teammate × N, then cleanup_team
```

### Available MCP Tools (26)

| Tool | Description |
|------|-------------|
| `create_team` | Create a new team (you become the Lead) |
| `list_teams` | List all teams |
| `show_team` | Show team details and members |
| `cleanup_team` | Remove a team and its data |
| `spawn_teammate` | Spawn a new AI teammate process |
| `list_teammates` | List teammates and their status |
| `shutdown_teammate` | Graceful teammate shutdown |
| `force_stop_teammate` | Force-stop unresponsive teammate |
| `add_task` | Add a task to the backlog |
| `list_tasks` | List tasks (optionally filter by status) |
| `update_task` | Update task status/title/complexity |
| `assign_task` | Assign a task to a teammate |
| `delete_task` | Remove a task |
| `start_sprint` | Start a new sprint with selected tasks |
| `activate_sprint` | Activate sprint with task assignments |
| `close_sprint` | Close sprint, return unfinished tasks |
| `show_sprint` | Show current or specific sprint |
| `list_sprints` | List all sprints |
| `send_message` | Send message to a specific teammate |
| `broadcast_message` | Broadcast to all teammates |
| `read_messages` | Read messages (all or filtered) |
| `team_status` | Full dashboard: team, tasks, sprint, files |
| `list_pending_plans` | Plans awaiting your approval |
| `review_plan` | Approve or reject a teammate's plan |
| `list_file_claims` | Active file ownership claims |
| `detect_file_conflicts` | Check for file conflicts |

Most tools auto-detect the team name — no need to specify `team_name` if only one team exists.

## Usage: Direct CLI

You can also use copilot-teams directly from the command line:

### Quick Start

### 1. Create a team

```bash
copilot-teams team create --session-id my-session
```
```
✓ Team created: swift-falcon-a3b2
  Lead session: my-session
  Created at:   2026-02-26T15:00:00.000Z
```

### 2. Add tasks

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

### 3. Spawn teammates

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

### 4. Run a sprint

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

### 5. Send messages

```bash
copilot-teams msg send tm-1 "Focus on TASK-1 first"
copilot-teams msg broadcast "Sprint review in 5 minutes"
copilot-teams msg list
```

### 6. Check status

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

### 7. Complete the workflow

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

## Full Command Reference

### `copilot-teams team`

| Command | Description |
|---------|-------------|
| `team create` | Create a new team (you become the Lead) |
| `team show` | Show team configuration and members |
| `team cleanup` | Remove team directory (all teammates must be stopped) |

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

## Global Options

These work with any command:

| Option | Description |
|--------|-------------|
| `--team-name <name>` | Target a specific team (default: auto-detect active team) |
| `--session-id <id>` | Your session ID (default: auto-generated) |
| `--help` | Show help for any command |

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

## Data Storage

All state lives under `~/.copilot/teams/{team-name}/`:

```
config.json          Team configuration
backlog.md           Task list
sprint.md            Sprint lifecycle
messages.md          Mailbox (append-only)
files.md             File claims (append-only)
plans.json           Plan approvals
hooks.json           Hook configuration
permission-audit.log Audit trail (append-only)
```

## Configuration

Enable teams (in priority order):

1. CLI flag: `--teams-enabled`
2. Env var: `COPILOT_TEAMS_ENABLED=true`
3. Settings: `~/.copilot/settings.json` → `{ "teams": { "enabled": true } }`

## Running Tests

```bash
npm test        # 288 tests
npm run build   # compile TypeScript
```

## License

MIT
