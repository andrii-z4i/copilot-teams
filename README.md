# Copilot Teams — MCP Server

An **MCP (Model Context Protocol) server** that gives [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) the ability to coordinate multiple AI teammates working in parallel. Just talk to Copilot — it calls the right tools for you.

```
┌─────────────┐      ┌─────────────────┐      ┌──────────────────────┐
│  You (CLI)  │ ───► │  GitHub Copilot  │ ───► │  copilot-teams MCP   │
│  gh copilot │      │  (understands    │      │  (46 tools: teams,   │
│             │      │   your intent)   │      │   tasks, sprints…)   │
└─────────────┘      └─────────────────┘      └──────────────────────┘
```

**No commands to memorize.** Describe what you want in natural language and Copilot handles the rest.

---

## Quick Start

### 1. Install

```bash
npm install
npm run build
npm link          # makes 'copilot-teams-mcp' available globally
```

### 2. Connect to GitHub Copilot CLI

Add the MCP server to `.copilot/mcp-config.json` (in your project root or `~/.copilot/`):

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

> **Tip:** If you haven't run `npm link`, use the full path instead:
> `"command": "node", "args": ["/path/to/copilot-teams/dist/mcp-server.js"]`

### 3. Start talking

```
You: "Create a team for this project"
→ Copilot calls create_team

You: "Add three tasks: auth module, API routes, and tests"
→ Copilot calls add_tasks

You: "Spin up two coders — one for auth, one for API"
→ Copilot calls spawn_teammate × 2

You: "Start sprint 1 with all pending tasks"
→ Copilot calls start_sprint

You: "What's the team status?"
→ Copilot calls team_status

You: "Shut everyone down and clean up"
→ Copilot calls shutdown_teammate × N, then cleanup_team
```

That's it. Copilot picks the right MCP tools automatically.

---

## What Can It Do?

The MCP server exposes **46 tools** organized into these categories:

| Category | Tools | What you can say |
|----------|-------|------------------|
| **Team** | `create_team` `list_teams` `show_team` `cleanup_team` | *"Create a team"*, *"Show me the team"* |
| **Teammates** | `spawn_teammate` `list_teammates` `shutdown_teammate` `force_stop_teammate` | *"Spin up 3 coders"*, *"Shut down tm-1"* |
| **Tasks** | `add_task` `add_tasks` `list_tasks` `update_task` `assign_task` `delete_task` | *"Add a task for auth"*, *"What tasks are pending?"* |
| **Sprints** | `start_sprint` `activate_sprint` `close_sprint` `show_sprint` `list_sprints` | *"Start sprint 1"*, *"Close the sprint"* |
| **Messages** | `send_message` `broadcast_message` `read_messages` | *"Tell tm-1 to focus on auth"* |
| **Status** | `team_status` | *"What's the team status?"* |
| **Plans** | `enter_plan_mode` `submit_plan` `list_pending_plans` `review_plan` `set_approval_criteria` | *"Require plans before coding"* |
| **Files** | `claim_file` `release_file` `list_file_claims` `detect_file_conflicts` | *"Check for file conflicts"* |
| **Reports** | `submit_report` `get_report` `get_all_reports` | *"Show me all findings"* |
| **Orchestration** | `run_team` | *"Run the whole project end to end"* |
| **Estimation** | `start_planning_poker` `submit_estimate` `resolve_estimates` `balance_assignments` | *"Estimate task complexity"* |
| **Permissions** | `request_permission` `review_permission` `read_audit_log` `list_pending_permissions` | *"Show the audit log"* |
| **Hooks** | `list_hooks` `save_hooks` | *"Run tests when a task completes"* |

> Most tools auto-detect the active team — no need to specify a team name.

---

## Example Workflows

### Parallel code review

> *"Create a team to review PR #142. Spawn three reviewers — security, performance, and test coverage. Have them report findings."*

### Competing-hypothesis debugging

> *"Users report the app exits after one message. Spawn 5 teammates to investigate different hypotheses. Have them challenge each other."*

### Multi-layer feature build

> *"Build a user profile page. Spawn teammates for frontend, backend API, database migration, and tests."*

### One-shot orchestration

> *"Run a team: create tasks for auth, API, and tests, then spawn coders, run the sprint, and collect reports."*

Copilot calls `run_team` — a single tool that handles the full lifecycle.

---

## How It Works

```
         ┌──────────┐
         │   USER   │  (talks to Copilot in natural language)
         └────┬─────┘
              │
         ┌────▼─────┐
         │   LEAD   │  orchestrator · single writer · gatekeeper
         └──┬──┬──┬─┘
            │  │  │
     ┌──────┘  │  └──────┐
     ▼         ▼         ▼
 ┌────────┐┌────────┐┌────────┐
 │  TM-1  ││  TM-2  ││  TM-3  │  independent Copilot CLI processes
 └────────┘└────────┘└────────┘
     │         │         │
     └─────────┼─────────┘
               ▼
    ~/.copilot/teams/{team}/    (local file-based coordination)
```

- **One Lead, N Teammates** — you talk to the Lead, it orchestrates everything.
- **File-system coordination** — all state stored locally, no cloud services.
- **Single-writer invariant** — only the Lead writes shared files, eliminating race conditions.
- **Least-privilege permissions** — teammates request approval for every privileged operation.

---

## Further Documentation

| Document | Description |
|----------|-------------|
| [CLI Reference](docs/cli-reference.md) | Direct CLI commands, full MCP tool list, data storage, and configuration |
| [Architecture](docs/architecture.md) | System design, data model, coordination protocol |
| [Requirements](docs/requirements.md) | Functional and non-functional requirements |

---

## Running Tests

```bash
npm test        # run tests
npm run build   # compile TypeScript
```

## License

MIT
