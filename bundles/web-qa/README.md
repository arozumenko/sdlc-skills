# Web QA Team

A standalone agentic manual-QA team for web apps. Cases are authored as
structured Markdown and run live via Playwright MCP — no test code is
generated, making this distinct from a Playwright automation engineer.

## Install

```bash
npx github:arozumenko/sdlc-skills init --bundle web-qa
```

Installs the 5 agents below into `.claude/agents/`, seeds QA reference docs
into `.agents/web-qa/knowledge/`, and splices the team conventions into
`AGENTS.md` / `CLAUDE.md`.

## Roster

| Role | Invoke | Does |
|---|---|---|
| `setup` | setup | Onboards the app — explores the UI, maps flows, writes `.agents/web-qa/app_profile.md` |
| `tc-writer` | tcw | Takes a feature or flow description and authors formatted test cases under `tasks/<suite>/` |
| `orchestrator` | orch | Discovers the suite to run, dispatches `executor` sub-runs via the Agent tool, triggers `reporter` |
| `executor` | executor | Runs one test case live via Playwright MCP and emits a structured JSON result |
| `reporter` | reporter | Collects executor results and writes the run report to `reports/` |

## How this team works

Run the agents in order: **setup → tc-writer → orchestrator → executor →
reporter**. `orchestrator` owns the run loop and must be invoked as the
**active agent** (it dispatches `executor` sub-runs via the Agent tool).

Test cases live in `tasks/<suite>/TC-NNN_<slug>.md`; run reports land in
`reports/RUN-YYYY-MM-DD-NNN.md` with screenshots in `reports/screenshots/`.
Reference docs (format guide, templates, report format) are seeded to
`.agents/web-qa/knowledge/` at install time.

All test-case URLs use `{{base_url}}` — the orchestrator or executor
substitutes the real base URL at run time, keeping cases environment-agnostic
across dev, staging, and prod.

## What this bundle adds

- **Agents** — the 5 local roles above (installed into `.claude/agents/`).
- **Instructions** — [`instructions.md`](instructions.md) → spliced into `AGENTS.md` / `CLAUDE.md`.
- **Seeded knowledge** — [`knowledge/`](knowledge/) → `.agents/web-qa/knowledge/` (test-case format guide, template, report format).
- **Skills it pulls** — `playwright-testing`, `playwright-best-practices`, `verification-before-completion`, `systematic-debugging`, `xlsx-reader` (declared in the relevant agent frontmatter).
- **Briefings** — _(none)_.
- **Hooks** — _(none)_.

See [`bundle.json`](bundle.json) for the exact manifest and the top-level
[`../SPEC.md`](../SPEC.md) for how bundles are defined and installed.
