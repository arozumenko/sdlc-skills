# Manual QA Team

A standalone agentic manual-QA team for web and mobile apps. Cases are authored as structured Markdown and run live — web via Playwright MCP, mobile via Appium
MCP (local native) or the Mobitru device farm (cloud real devices) — no test code is generated, making this distinct from a Playwright automation engineer.

## Install

```bash
npx github:arozumenko/sdlc-skills init --factory manual-qa
```

Installs the 7 agents below into `.claude/agents/`, seeds QA reference docs
into `.agents/manual-qa/knowledge/`, and splices the team conventions into
`AGENTS.md` / `CLAUDE.md`.

## Quick start

The team runs in **three phases**. Unlike the other factories there is no
`scout`: `app-profiler` onboards the app, then `test-run-lead` orchestrates
the rest — it authors and sizes cases when needed, runs them, and reports.

**Install (once)** — `npx github:arozumenko/sdlc-skills init --factory manual-qa`.
Installs the 7 agents into `.claude/agents/`, seeds reference docs into
`.agents/manual-qa/knowledge/`, wires the context hooks, and splices
`instructions.md` into `AGENTS.md`.

**Phase 1 — Inception (`app-profiler`, once per app).** _"Use the
app-profiler agent to onboard this app."_ It **interviews you** (base URL,
what the app does, auth + test credentials, the 3–5 key flows, user roles,
external-service flows), then explores the running app live via Playwright
MCP and writes `.agents/manual-qa/app_profile.md` (URLs, auth, key pages,
reliable selectors, fragile areas). **Why it's first:** there's no scout
here — `app-profiler` is the onboarding agent, and every other manual-qa agent
reads this profile before acting.

**Phase 2 — Usage (`test-run-lead` orchestrates).** Launch `test-run-lead` as
the **active agent** with a suite path and `base_url` — it's the single
orchestrator for a run. It assembles the suite first, dispatching sub-agents
*when needed*:
- **`test-author`** — when the suite has no cases yet and you've given
  descriptions/flows to work from, it writes `tasks/<suite>/TC-NNN_<slug>.md`
  (URLs as `{{base_url}}/path`).
- **`test-sizer`** — when cases lack a `size:`, it scores them S/M/L for
  agent-execution cost and writes it into their frontmatter.

Then it runs the suite: one `test-runner` per case (each runs live via
Playwright MCP and must capture a confirming snapshot to record PASS),
followed by `test-reporter` writing `reports/RUN-YYYY-MM-DD-NNN.md`. You talk
only to the lead — don't invoke `test-sizer` / `test-author` / `test-runner` /
`test-reporter` by hand during a led run (you can still run sizer/author
standalone for authoring outside a run). **The logic:** every agent reads
`app_profile.md` for selectors and auth, so cases and runs stay grounded in
the real app.

**Phase 3 — Reinforcement (assisted; you curate — there's no scout here).**
The project's knowledge lives in durable, growing artifacts that every agent
re-reads on each run: `.agents/manual-qa/app_profile.md` (**re-run
`app-profiler`** after UI changes to refresh selectors and flows), the
`tasks/` suite (a living regression set), and the `reports/` history. None
of this is automatic — you decide when to re-profile and which cases to
keep. **The payoff:** runs get more reliable as the profile sharpens and the
suite grows — the team builds a lasting QA memory of *this* app rather than a
one-off pass. There is no mining of past chat or sub-agent transcripts;
refinement comes from re-profiling the live app and curating the suite.

### How it flows

```mermaid
flowchart TD
    install(["npx … init --factory manual-qa"]) --> profiler

    subgraph p1["Phase 1 — Inception · you launch app-profiler (once per app)"]
        profiler["app-profiler — interview +<br/>explore live app"]
        profile[/"app_profile.md<br/>URLs · auth · selectors · fragile areas"/]
        profiler --> profile
    end

    subgraph p2["Phase 2 — Usage · you launch test-run-lead (orchestrator)"]
        lead["test-run-lead — active agent,<br/>orchestrates the run"]
        author["test-author — write TC-NNN files<br/>(when cases missing)"]
        sizer["test-sizer — rate S/M/L<br/>(when cases unsized)"]
        runner["test-runner — run one case<br/>live via Playwright MCP"]
        reporter["test-reporter — write run report"]
        lead -->|"when needed"| author
        lead -->|"when needed"| sizer
        lead -->|"per case"| runner
        lead -->|"at end"| reporter
    end

    profile -->|"every agent reads it"| lead

    subgraph p3["Phase 3 — Reinforcement · assisted (you curate)"]
        artifacts[(".agents/manual-qa/app_profile.md<br/>tasks/ suite · reports/ history")]
    end

    reporter -. "runs accrue" .-> artifacts
    artifacts -. "re-run app-profiler after UI changes;<br/>profile + suite ground the next run" .-> profiler
```

## Roster

| Role | Invoke | Does |
|---|---|---|
| `app-profiler` | profiler | Onboards the app — explores the UI, maps flows, writes `.agents/manual-qa/app_profile.md` |
| `test-sizer` | sizer | Rates cases S/M/L for AI-agent execution cost; sizes descriptions before authoring and scores existing TC files into their `size:` frontmatter |
| `test-author` | author | Takes a feature or flow description and authors formatted test cases under `tasks/<suite>/` |
| `test-run-lead` | lead | **Run orchestrator** — assembles the suite (dispatches `test-author` / `test-sizer` when needed), runs one `test-runner` per case, triggers `test-reporter` |
| `test-runner` | runner | Runs one test case live via Playwright MCP and emits a structured JSON result |
| `test-reporter` | reporter | Collects test-runner results and writes the run report to `reports/` |
| `qa-auditor` | auditor | Specialist web auditor — runs Step-0 Playwright evidence collection, then the applicable specialist passes (security, accessibility, privacy, performance, responsive, UX, SEO), writes a findings report, and codifies notable findings into regression cases |

## Audit mode

Alongside case-driven runs, the team supports specialist **web audits** — a
different question ("what's wrong with this page?") than a scripted test
case ("does this flow work?").

- **Lead-routed** — ask `test-run-lead` to audit, "find issues", or check
  security/accessibility/privacy/performance/responsive/UX/SEO against a
  target, and it takes the audit branch: dispatches `qa-auditor` with the
  target and scope, collects its findings back, and codifies them itself.
- **Standalone** — invoke `/agent qa-auditor` directly with a target URL for
  a one-off audit outside a run.

`qa-auditor` collects Step-0 evidence (navigate, snapshot, screenshot,
console errors, network requests) via the same Playwright MCP as
`test-runner`, then runs the applicable **specialist passes** —
`security-audit`, `accessibility-audit`, `privacy-audit`, `performance-audit`,
`responsive-audit`, `ux-audit`, `content-seo-audit` (security, accessibility,
privacy, content-seo, and performance always run; UX and responsive run
conditionally on page signals). These are declared as `skills-on-demand` on
`qa-auditor`, so they install with the agent but are only loaded into
context when their specialty is actually selected for a given audit — not
all seven on every run. Each specialist works best-effort within the
Playwright MCP toolset (there's no `browser_evaluate`; some checks — e.g.
cookie/meta-tag inspection — degrade or are noted as unavailable rather than
faked).

Findings are deduped, ranked, and written to
`reports/audit-{target}-{date}.md`. Notable findings (priority p0–p1,
confidence ≥5) are then **codified**: `qa-auditor` (standalone) or
`test-run-lead` (lead-routed) dispatches `test-author` with the findings,
which authors `TC-NNN` regression cases under `tasks/<suite>/` — ordinary
suite cases a later `test-run-lead` run can pick up via `test-runner` like
any other case.

## How this team works

Onboard once with **app-profiler**, then drive **test-run-lead** — the single
run orchestrator. It must be invoked as the **active agent**; it dispatches
`test-author` and `test-sizer` to assemble the suite when needed, then a
`test-runner` per case and `test-reporter` at the end (all via the Agent
tool). You can also run `test-sizer` / `test-author` standalone for authoring
outside a run.

Test cases live in `tasks/<suite>/TC-NNN_<slug>.md`; run reports land in
`reports/RUN-YYYY-MM-DD-NNN.md` with screenshots in `reports/screenshots/`.
Reference docs (format guide, templates, report format) are seeded to
`.agents/manual-qa/knowledge/` at install time.

All test-case URLs use `{{base_url}}` — the test-run-lead or test-runner
substitutes the real base URL at run time, keeping cases environment-agnostic
across dev, staging, and prod.

## What this factory adds

- **Agents** — the 7 local roles above (installed into `.claude/agents/`).
- **Instructions** — [`instructions.md`](instructions.md) → spliced into `AGENTS.md` / `CLAUDE.md`.
- **Seeded knowledge** — [`knowledge/`](knowledge/) → `.agents/manual-qa/knowledge/` (test-case format guide, template, report format).
- **Skills it pulls** — `playwright-testing`, `playwright-best-practices`, `verification-before-completion`, `systematic-debugging` (declared in the relevant agent frontmatter).
- **Factory-owned skills** — [`skills/playwright-testing/`](skills/playwright-testing/), [`skills/xlsx-reader/`](skills/xlsx-reader/), [`skills/mobile-testing/`](skills/mobile-testing/), plus the 7 specialist audit skills — [`skills/security-audit/`](skills/security-audit/), [`skills/accessibility-audit/`](skills/accessibility-audit/), [`skills/privacy-audit/`](skills/privacy-audit/), [`skills/performance-audit/`](skills/performance-audit/), [`skills/responsive-audit/`](skills/responsive-audit/), [`skills/ux-audit/`](skills/ux-audit/), [`skills/content-seo-audit/`](skills/content-seo-audit/) — real directories this factory physically owns (declared in `localSkills`), installed when you install the factory. The audit skills are `skills-on-demand` on `qa-auditor` (see [Audit mode](#audit-mode)) rather than standing `skills:`. The same id may exist in another factory or the top-level `skills/` catalog with different content — that's fine, there is no sync. Edit these copies directly.
- **Briefings** — _(none)_.
- **Hooks** — [`hooks/`](hooks/) → optional metrics-collection add-on
  (token/cost/timing/pass-rate per run), installed automatically alongside
  everything else. See [`hooks/README.md`](hooks/README.md) for what it does
  and [`knowledge/metrics-format.md`](knowledge/metrics-format.md) for the
  output schema.

See [`factory.json`](factory.json) for the exact manifest and the top-level
[`../SPEC.md`](../SPEC.md) for how factories are defined and installed.
