# claudequeue

[![CI](https://github.com/csabika98/claudequeue/actions/workflows/ci.yml/badge.svg)](https://github.com/csabika98/claudequeue/actions/workflows/ci.yml)

Queue tasks for Claude Code to run autonomously — overnight, unattended, across multiple projects.

Add tasks, hit Start, go to sleep. Claude works through the queue, handles rate limits automatically, and logs everything.

---

## Install

```bash
npm install -g claudequeue
```

> **Requirements:** Node 18+, [Claude Code](https://claude.ai/code) installed and on PATH.

---

## Setup (once)

```bash
claudequeue setup
```

This registers the MCP server with Claude Code so it can report task progress. Restart Claude Code after running this.

---

## Add your first project

```bash
claudequeue add /path/to/your/project
```

Windows paths work too:

```bash
claudequeue add "C:\Users\you\projects\myapp"
```

---

## Open the dashboard

```bash
claudequeue start
```

Then open **http://localhost:3141** in your browser — or just type `/queue` inside any Claude Code session and it opens automatically.

---

## Add tasks

In the dashboard, click **+ Add Task** and fill in:

- **Title** — what to build
- **Description** — details and requirements
- **Acceptance criteria** — how Claude knows it's done

Or drag and drop a `.md` file onto the task list to import it as a task.

You can also edit `queue.md` directly in your project root.

### queue.md format

```markdown
## [PENDING] Build login page
Create a login form with email and password fields.
Acceptance: Form validates input and submits to /api/auth/login.

## [DONE] Setup project ✓
> Completed: 2024-01-15 02:34 — Created Vite scaffold with TypeScript
```

Status tags: `PENDING` → `ACTIVE` → `DONE` or `BLOCKED`

---

## Run

Hit **▶ Start** in the dashboard. Claude works through all pending tasks across all your registered projects, then stops.

- Rate limits are detected automatically — Claude waits for the reset time and resumes
- Each task's full terminal output is available via the **Log** button
- A `session-summary.md` is written to your project when the queue empties

---

## /queue slash command

Inside any Claude Code session:

```
/queue                          → open dashboard + show status
/queue done Fixed the auth bug  → mark current task complete
/queue blocked Missing API key  → mark current task blocked
/queue current                  → show active task details
```

---

## MCP tools (used by Claude automatically)

When running autonomously, Claude has access to:

| Tool | What it does |
|------|-------------|
| `mark_task_done(summary)` | Marks active task as DONE |
| `write_blocked(reason)` | Marks active task as BLOCKED |
| `log_decision(decision, reason)` | Logs a decision to queue.md |
| `get_current_task()` | Returns active task details |
| `get_project_context()` | Returns full queue status |

---

## Development

```bash
npm install
npm test          # vitest, run once
npm run test:watch
npm run coverage
npm run typecheck # tsc against src and tests
npm run build
```

CI runs typecheck, tests and the build on Node 20 and 22 for every push and
pull request.

The suite covers the pure-logic core: `queue.md` parsing and task lookup,
status transitions and decision logging, and rate-limit detection with
reset-time parsing under fake timers. The runner, scheduler and dashboard
server are not covered yet — they spawn processes and bind ports, so they
need an integration harness rather than unit tests.

---

## Design notes

[`PLAN.md`](PLAN.md) is the original build plan: the core architecture,
the milestone breakdown from config manager through MCP server to dashboard,
and the session rules the agent follows while working a queue. It is worth
reading before changing how tasks move between states.

---

## Troubleshoot

```bash
claudequeue doctor
```

Checks that Claude Code is on PATH, config exists, and MCP is registered.
