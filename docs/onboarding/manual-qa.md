# Manual QA — Onboarding

The `manual-qa` bundle drops a **standalone agentic manual-QA team** into a
repo. Cases are authored as structured Markdown and run **live** against a
running app — no test code is generated, which is what distinguishes this team
from a Playwright automation engineer. It targets **web** (Playwright MCP) and
**mobile** (Appium MCP for local native, or the Mobitru device farm for cloud
real devices).

For the pipeline picture, roster, and the `{{base_url}}` / evidence rules, read
the bundle README first — this guide assumes it and focuses on **adoption**:
[`bundles/manual-qa/README.md`](../../bundles/manual-qa/README.md).

**Pick your path:**

- [Existing suite](#existing-suite) — you already have `tasks/` cases to run.
- [Greenfield](#greenfield) — an app exists but there are no cases yet.
- [Hybrid](#hybrid--alongside-a-dev-team) — run manual QA alongside the
  feature-development team on the same app.

## The team, one picture

```
You → app-profiler (onboard the app, once) → test-run-lead (orchestrates a run)
        → test-author / test-sizer (assemble the suite, when needed)
        → test-runner (one per case, live) → test-reporter (run report)
```

| Slot | Agent | Job |
|---|---|---|
| Onboarding | `app-profiler` | Explores the running app, writes `.agents/manual-qa/app_profile.md` (URLs, auth, key flows, selectors, fragile areas) |
| Orchestrator | `test-run-lead` | The single run orchestrator — assembles the suite, runs a `test-runner` per case, triggers the report |
| Sizing | `test-sizer` | Rates cases S/M/L for agent-execution cost |
| Authoring | `test-author` | Turns flow descriptions into `tasks/<suite>/TC-NNN_<slug>.md` |
| Execution | `test-runner` | Runs one case live, returns a structured JSON result |
| Reporting | `test-reporter` | Collects results, writes `reports/RUN-YYYY-MM-DD-NNN.md` |

**There is no `scout` here** — `app-profiler` is the onboarding agent, and
`test-run-lead` is the orchestrator you launch directly. Every other agent reads
the app profile before acting.

---

## Prerequisites

```bash
node --version                       # Node 18+ (for the npx installer)
git rev-parse --is-inside-work-tree  # inside a git repo (cases + reports live in it)
```

Plus a **running app** and the MCP server for your target:

| Target | What you need |
|---|---|
| **Web / PWA / hybrid** | The app reachable at a base URL + the **Playwright MCP** server wired into your host |
| **Mobile — local native** | A simulator/emulator or attached device + the **Appium MCP** server (the `mobile-testing` skill covers setup) |
| **Mobile — cloud devices** | **Mobitru** device-farm credentials wired into the host MCP config |

Test credentials for any auth-gated flows you want covered. The bundle install
(`--bundle`) currently targets **Claude Code**; other hosts use the manual
`--agents` form. Host-specific launch syntax and flags:
[README.md](../../README.md).

---

## Existing suite

You already have `tasks/<suite>/` cases (migrated, hand-written, or from a prior
run) and just want to run them against a fresh build.

### 1. Install the bundle

```bash
cd /path/to/your-repo
npx github:arozumenko/sdlc-skills init --bundle manual-qa
```

This installs the 6 agents into `.claude/agents/`, seeds the reference docs
(case format, template, report format) into `.agents/manual-qa/knowledge/`,
wires the context hooks, and splices the team conventions into `AGENTS.md`.

For Copilot / Cursor / Windsurf, use the manual form:

```bash
npx github:arozumenko/sdlc-skills init \
  --target copilot \
  --agents app-profiler,test-run-lead,test-author,test-sizer,test-runner,test-reporter \
  --yes
```

### 2. Onboard the app with `app-profiler`

Run **once per app** (re-run after significant UI changes). Launch
`app-profiler`:

> Use the app-profiler agent to onboard this app.

It **interviews you** (base URL, what the app does, auth + test credentials, the
3–5 key flows, user roles, external-service flows), then explores the running
app live and writes `.agents/manual-qa/app_profile.md` — URLs, auth, key pages,
reliable selectors, fragile areas. For a **mobile** target, `app-profiler`
carries the `mobile-testing` skill and profiles via Appium / the device farm
instead of a browser. Full role contract:
[`app-profiler/AGENT.md`](../../bundles/manual-qa/agents/app-profiler/AGENT.md).

**Review `app_profile.md` before running.** Selectors and auth come from here;
a thin or wrong profile produces flaky runs.

### 3. Run the suite via `test-run-lead`

Launch `test-run-lead` as the **active agent** (it dispatches sub-runs via the
Agent tool) with a suite path and base URL:

> Use the test-run-lead agent. Run the suite at `tasks/<suite>` against
> `base_url = https://staging.example.com`.

It runs one `test-runner` per case (each runs live and must capture a confirming
snapshot of the **Expected Final State** to record a PASS — a PASS without a
confirming snapshot is invalid), then triggers `test-reporter` to write
`reports/RUN-YYYY-MM-DD-NNN.md`. **Talk only to the lead** during a run — don't
invoke `test-runner` / `test-sizer` / `test-author` by hand mid-run.

---

## Greenfield

The app exists but you have **no cases yet**. Same install + onboarding as
[Existing suite](#existing-suite), then let the lead assemble the suite:

1. **Install** and **onboard with `app-profiler`** (steps 1–2 above).
2. **Give `test-run-lead` flow descriptions** to work from — prose, bullets,
   user stories, or a bug report. When the suite is empty, the lead dispatches:
   - **`test-author`** — writes `tasks/<suite>/TC-NNN_<slug>.md` (URLs as
     `{{base_url}}/path`) from your descriptions.
   - **`test-sizer`** — scores each case S/M/L, flags Large ones to split, and
     writes `size:` into the frontmatter.
3. **Then it runs them** — one `test-runner` per case, followed by the report.

You can also run `test-author` / `test-sizer` **standalone** to build out a
suite outside of a run. The `tasks/` suite becomes a living regression set that
grows over time; re-run `app-profiler` after UI changes so selectors and flows
stay accurate. Case format + template:
[`knowledge/`](../../bundles/manual-qa/knowledge/).

---

## Hybrid — alongside a dev team

Manual QA runs cleanly next to the `feature-development` team on the same app:
the dev team ships features; the manual-QA team profiles the running build,
authors/maintains a regression suite, and runs it live. They share the repo but
own different artifacts — the dev team owns `src/` and the feature merge gate;
the manual-QA team owns `tasks/`, `reports/`, and `.agents/manual-qa/`.

Install both bundles into the same repo (run each `--bundle` once). There is no
orchestration coupling between them — you drive `project-manager` for delivery
and `test-run-lead` for QA runs independently. Point `app-profiler` at whatever
environment (dev / staging) the dev team's build is deployed to; `{{base_url}}`
keeps the same cases reusable across environments.

---

## Project systems — where state lives

```
tasks/<suite>/TC-NNN_<slug>.md       test cases (authored by test-author)
reports/RUN-YYYY-MM-DD-NNN.md        run reports (written by test-reporter)
reports/screenshots/                 evidence screenshots from runs
.agents/manual-qa/app_profile.md     app map written by app-profiler
.agents/manual-qa/knowledge/         seeded reference docs (format, template, report)
```

Two rules every case obeys (full detail in the bundle README and
[`instructions.md`](../../bundles/manual-qa/instructions.md)):

- **`{{base_url}}` substitution** — all case URLs are written `{{base_url}}/path`
  and resolved at run time, keeping cases environment-agnostic.
- **Evidence before PASS** — a `test-runner` must capture a final snapshot
  confirming the Expected Final State; a PASS without it is invalid.

---

## Troubleshooting

- **"Custom agent not found" on Copilot CLI** → installer wrote directories
  instead of flat `.agent.md` files. Run
  `npx github:arozumenko/sdlc-skills init fix-copilot`.
- **Runs are flaky / selectors miss** → the app profile is thin or stale. Re-run
  `app-profiler` to refresh `app_profile.md` selectors and fragile-area notes.
- **A case PASSes without evidence** → that PASS is invalid by the team's rules.
  Re-run with the instruction to capture the confirming Expected-Final-State
  snapshot before recording PASS.
- **`test-runner` invoked by hand mid-run collides with the lead** → during a led
  run, only `test-run-lead` should dispatch runners. Run sizer/author standalone
  *outside* a run if you need ad-hoc authoring.
- **Mobile session won't start** → see the `mobile-testing` skill's
  troubleshooting (Appium driver readiness, device trust, WebDriverAgent, or
  Mobitru credentials):
  [`mobile-testing/SKILL.md`](../../bundles/manual-qa/skills/mobile-testing/SKILL.md).
- **MCP auth errors** → token rotated / scope missing. Fix the MCP server config
  in the host (`~/.claude.json`, `.mcp.json`, Copilot settings), never in the
  project repo, then restart the session.

---

## Maintenance

General update / sync notes live in [MAINTENANCE.md](../../MAINTENANCE.md).
Re-run the same `init` command with `--update` to pull upstream fixes. The
durable QA assets are yours and `--update` won't touch them: the `tasks/` suite,
`reports/` history, and `.agents/manual-qa/app_profile.md`. Refinement here is
**manual and assisted** — there's no scout mining past sessions; you decide when
to re-profile the app and which cases to keep.

---

## Where things live after onboarding

```
<project-root>/
├── AGENTS.md / CLAUDE.md             # team conventions spliced under <!-- BUNDLE:manual-qa -->
├── .agents/manual-qa/
│   ├── app_profile.md                # app map (app-profiler) — yours to keep
│   └── knowledge/                    # seeded format/template/report docs
├── tasks/<suite>/TC-NNN_<slug>.md    # the living regression suite
├── reports/RUN-YYYY-MM-DD-NNN.md     # run history + screenshots/
├── src/ app/ …                       # YOUR application code (untouched)
└── .claude/agents/<role>/            # or .github/agents/<role>.agent.md per host
```

The team owns `.agents/manual-qa/`, `tasks/`, and `reports/`. Your application
code stays untouched — the manual-QA team only ever drives the running app, it
never writes into it.
