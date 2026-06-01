---
name: quality-onboarding
description: Use when onboarding a standalone quality-architect to an unfamiliar product with no scout or team — interview, ingest the codebase/docs/specs, and synthesize a product quality profile into .agents/quality.md.
license: Apache-2.0
compatibility: Requires project root write access. Browser smoke step needs Chrome/Chromium + Node 22 via the browser-verify skill. No external dependencies.
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

# Quality Onboarding — the solo self-onboarding path

This skill is the **standalone self-onboarding path** for the `quality-architect`
agent (Quinn) when it is installed **outside a team bundle** — a solo install
with **no `scout`** present. Its single job is to produce the per-product quality
profile at `.agents/quality.md` that Quinn reads on demand before every audit.

**Relationship to `seeding-a-project`.** In a team bundle, scout owns onboarding:
its `seeding-a-project` Step 6.6 QA pass *autonomously derives* `.agents/quality.md`
from the codebase it already surveyed (no interview). This skill is the **solo
counterpart** — it produces the **same artifact, in the same schema**, when there
is no scout to derive it. Where scout is autonomous, this path is interactive: it
interviews the operator, ingests the sources they point at, then synthesizes. If
scout has already written `.agents/quality.md`, **you don't need this skill** —
read that file and audit. Run this only when `.agents/quality.md` is absent and no
scout will create it.

This is NOT a quick scan — it's a structured ingestion pipeline that funnels
everything into one file. The output schema is fixed by
[`seeding-a-project`'s `.agents/quality.md` template](../seeding-a-project/references/templates.md#agentsqualitymd-template);
match it exactly so Quinn and a later scout pass read the same shape.

---

## Phase 1: Interview — Learn About the Product

Start by asking the operator about their product. Don't assume — ask. Adapt the
questions to what they've already told you; skip what you can read yourself.

### 1.1 Product overview

> **What is this product?** What does it do, who are the real users?

> **What are the key user flows?** (e.g. signup → onboarding → core action → billing)

> **What environments exist?** (local dev URL, staging, production)

> **What are the known pain points or fragile areas?** What breaks, what churns?

### 1.2 Documentation sources

Ask where product knowledge lives. For each source, get the URL/path and what it
contains.

> **Where can I learn about this product?** Point me at any of these:
>
> - Product docs / wiki (Confluence, Notion, GitBook, README)
> - API documentation (Swagger/OpenAPI, Postman collections)
> - Design specs (Figma, design-system docs)
> - Architecture docs (diagrams, ADRs, system design)
> - Runbooks / playbooks (how to deploy, how to debug)
> - User stories / requirements (Jira, Linear, GitHub issues)
> - Related repositories (backend, frontend, infra, shared libs)
> - Existing test plans or QA docs

Record every source. You'll ingest them in Phase 3.

### 1.3 Quality posture (drives the Specialist-Relevance table)

> **What quality dimensions matter most here, and why?**
>
> - Is the UI public-facing? Accessibility / legal obligations (WCAG, ADA)?
> - Does it handle PII or payments? (security + privacy weight)
> - Mobile / tablet traffic? Responsive breakpoints in the CSS?
> - Marketing/SSR pages (content-seo) vs. an internal app behind auth?
> - Multi-step flows where UX friction bites (checkout, onboarding)?
> - Known accepted deviations an audit should NOT keep re-flagging (waivers)?

### 1.4 Test infrastructure & process

> **How do you test today, and how does QA fit your workflow?**
>
> - Frameworks, where tests live, how they run, CI pipeline
> - Test accounts, seed data, fixtures
> - Where bugs are tracked, any QA sign-off gate before release

---

## Phase 2: Pre-flight — Set Up Access Before Learning

Based on the Phase 1 answers, recommend the access the operator should configure
**before** ingestion. Don't proceed until they confirm they're ready (or say skip).

### 2.1 Map answers to tooling

| Operator mentioned | They need | How to set up |
|---|---|---|
| Confluence / Jira / Atlassian | Atlassian MCP or API token | `claude mcp add atlassian`, or provide a token |
| Notion pages | Notion MCP | `claude mcp add notion` + integration token |
| GitHub repos / issues | `gh` CLI authenticated | `gh auth login` |
| GitLab repos / issues | `glab` CLI or GitLab MCP | `glab auth login` |
| Linear issues | Linear MCP | API key in `.env` |
| Figma designs | Figma MCP, or note URLs for reference | `claude mcp add figma` |
| Swagger / OpenAPI | Nothing extra — read files/URLs directly | — |
| Postman collections | Postman MCP, or export as JSON | Export from Postman |
| Staging / prod URLs | VPN or access credentials | Operator handles |

For **which optional MCPs sharpen which audit dimension** once Quinn is running
(accessibility-scanner, snyk, sentry, browserstack, postman, test-management),
point the operator at
[`quality-audit-workflow/references/mcp-servers.md`](../quality-audit-workflow/references/mcp-servers.md).
Those are **optional accelerators**, never hard dependencies — the audit (and this
onboarding) run fully on `browser-verify` (CDP) with zero external MCPs. Don't
recommend product-specific servers the project hasn't asked for.

### 2.2 Check what's already available

```bash
# Browser automation for the smoke step (Phase 6) — via browser-verify
which google-chrome || which chromium || ls "/Applications/Google Chrome.app" 2>/dev/null
node --version   # need 22+

# Source access
gh auth token 2>/dev/null
cat .mcp.json 2>/dev/null         # what MCP servers are already registered
which glab 2>/dev/null

# Has scout already produced the artifact this skill writes?
cat .agents/quality.md 2>/dev/null && echo "EXISTS — read it instead of re-onboarding"
```

If `.agents/quality.md` already exists, stop and read it — onboarding is done. Only
proceed when it's absent.

### 2.3 Present a tailored checklist, then wait

Present a short checklist scoped to what the operator told you (required: Chrome +
Node 22; recommended: the source CLIs/MCPs they actually need; optional: staging
access, audit MCPs). Then **wait** — they may need to install CLIs, run auth, or
get tokens. If they say "skip" or "go ahead", proceed with what's available and
note what couldn't be ingested due to missing access.

---

## Phase 3: Ingest — Read Everything

For each source access was confirmed for, ingest and extract what matters **for a
quality profile** — risk surfaces, user flows, data handling, target platforms.

### 3.1 Local codebase

```bash
# Project structure + manifests (stack → drives the Specialist-Relevance ratings)
find . -maxdepth 3 -type f -name "*.md" | head -30
ls package.json pyproject.toml Cargo.toml go.mod pom.xml docker-compose.yml 2>/dev/null
head -80 package.json 2>/dev/null
head -80 pyproject.toml 2>/dev/null

# UI framework, responsive breakpoints, accessibility signals
grep -rl "aria-\|role=" --include="*.tsx" --include="*.jsx" --include="*.vue" --include="*.html" . 2>/dev/null | head
grep -rl "@media\|breakpoint\|min-width" --include="*.css" --include="*.scss" . 2>/dev/null | head

# Auth + data handling (security + privacy weight)
grep -rl "jwt\|localStorage\|sessionStorage\|cookie\|oauth" --include="*.ts" --include="*.js" --include="*.py" . 2>/dev/null | head
grep -rl "password\|email\|ssn\|payment\|stripe\|gdpr\|consent" --include="*.ts" --include="*.py" --include="*.sql" . 2>/dev/null | head

# API routes + models
grep -rl "app.get\|app.post\|@app.route\|router\." --include="*.py" --include="*.ts" --include="*.js" . 2>/dev/null | head
grep -rl "class.*Model\|CREATE TABLE\|schema\." --include="*.py" --include="*.ts" --include="*.sql" . 2>/dev/null | head

# Existing tests + env config + project context
ls pytest.ini conftest.py jest.config.* vitest.config.* playwright.config.* 2>/dev/null
ls .env.example docker-compose.yml Dockerfile 2>/dev/null
cat CLAUDE.md AGENTS.md 2>/dev/null
git log --oneline -20 2>/dev/null   # recent churn → fragile-area candidates
```

### 3.2 Related repositories

```bash
git clone --depth 1 {REPO_URL} /tmp/quality-ingest-{name} 2>/dev/null
ls /tmp/quality-ingest-{name}/
cat /tmp/quality-ingest-{name}/README.md 2>/dev/null
# scan for API specs, schemas, docs, then:
rm -rf /tmp/quality-ingest-{name}
```

### 3.3 Web documentation

For URLs the operator provided (Confluence, Notion, wikis, docs sites), use
`WebFetch` (or the relevant MCP) and extract product features, user flows,
architecture, and quality-relevant requirements (a11y/legal, data handling,
supported platforms).

### 3.4 API specifications

```bash
cat openapi.yaml 2>/dev/null || cat swagger.json 2>/dev/null
curl -s {SPEC_URL} | head -200
```

Extract endpoints, methods, auth requirements — these inform the risk weighting,
not a separate endpoint catalog (the `.agents/quality.md` schema has no endpoint
table; fold this into QA Priorities and architecture).

### 3.5 Design specs

If Figma / design docs are provided, note the URL and record supported viewports,
component library, and responsive breakpoints — these feed the
Target-Environments-&-Viewports section.

---

## Phase 4: Synthesize — Write `.agents/quality.md`

Funnel everything into **`.agents/quality.md`** — Quinn's per-product quality
profile. **Match the
[`seeding-a-project` template](../seeding-a-project/references/templates.md#agentsqualitymd-template)
exactly**; that file is the schema's source of truth and a later scout pass writes
the same shape. Treat the sections as themes — fill what the evidence supports and
flag the rest under `## Unconfirmed`. Don't invent. Each Specialist-Relevance row
needs an **evidence-based** *why* citing what in the stack drives the rating.

```markdown
# Quality Profile

> Onboarded on {YYYY-MM-DD} via quality-onboarding (solo, no scout). Per-product
> QA profile — specialist relevance, risk weighting, target surfaces, and standing
> waivers. Read on demand by the quality-architect before audits. Update when the
> stack, surfaces, or user base shift.

## Product Overview
{What the product does, who the real users are, key value proposition.}

## Architecture
- Frontend / Backend / Database / Auth / Infrastructure / API style — the stack
  facts that drive the ratings below (e.g. JWT in localStorage → security weight).

## Specialist Relevance

One row per specialist. `high | med | low` with an evidence-based *why* — cite what
in the stack drives the rating. `low` specialists are de-prioritized (not banned).

| Specialist    | Relevance | Why |
|---------------|-----------|-----|
| accessibility | high/med/low | e.g. public-facing UI, no `aria-*` usage detected |
| security      | high/med/low | e.g. handles auth + payment routes; JWT in localStorage |
| privacy       | high/med/low | e.g. stores PII in `users` table, no consent flow found |
| performance   | high/med/low | e.g. heavy client bundle, no code-splitting; image-heavy |
| responsive    | high/med/low | e.g. responsive breakpoints in CSS, mobile traffic likely |
| content-seo   | high/med/low | e.g. marketing pages present; meta tags sparse |
| ux            | high/med/low | e.g. multi-step flows (checkout, onboarding) |
| seo           | high/med/low | e.g. SSR/SSG marketing site vs. internal app |

## QA Priorities

Top risk areas for this product, highest first, each with *why*.

1. {highest-risk area} — {why: fragile flow / recent churn / untested surface}
2. {second} — {why}
3. {third} — {why}

## Key User Flows
1. **{Flow name}** — {entry point, brief steps, why it's critical to quality}
2. ...

## Known Risk Areas
- {area} — {why it's risky: complexity, recent change, no coverage}

## Target Environments & Viewports

| Environment | URL | Notes |
|-------------|-----|-------|
| Local       | http://localhost:{port} | {how to start} |
| Staging     | {url} | {access notes} |
| Production  | {url} | read-only — do not mutate |

- **Viewports:** {e.g. mobile 375×667, tablet 768×1024, desktop 1440×900 — derived
  from CSS breakpoints / supported devices}
- **Browsers:** {supported set, if the project states one}

## Standing Waivers

Known, accepted deviations an audit should **not** re-flag. Name scope, reason, and
(if known) a revisit trigger / expiry.

- {scope} — {why accepted} — {revisit when / expiry}

_None._ <!-- write this if there are no standing waivers -->

## Unconfirmed
- {anything the interview + ingest couldn't establish — Quinn confirms with the
  team before treating it as fact}
```

---

## Phase 5: Configure — Suggest, Never Modify

Print suggested `CLAUDE.md` additions for the operator to apply themselves —
**never edit `CLAUDE.md` directly**. Keep it to the QA essentials: where the
quality profile lives (`.agents/quality.md`), how to reach a running instance
(start command + dev URL), and the test/lint commands you verified. If you found a
`<!-- BUNDLE:<id> -->` block in `CLAUDE.md`/`AGENTS.md`, leave it untouched.

For specialists rated `low` in the profile, the de-prioritization is already
captured in the Specialist-Relevance table — Quinn reads it from there. Don't
duplicate it into `CLAUDE.md`.

---

## Phase 6: Verify — Smoke-Test via `browser-verify`

If the app is running, do a quick load smoke test through this repo's
[`browser-verify`](../browser-verify/SKILL.md) skill (CDP). Use its **real
commands** — resolve `$SCRIPTS` from the install location, write all evidence to
`/tmp`, **never** a project `reports/` directory.

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"

bash "$SCRIPTS/chrome-launcher.sh" start --headless
node "$SCRIPTS/cdp.mjs" navigate "{dev_url}"
node "$SCRIPTS/cdp.mjs" page-info
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/quality-onboarding-verify.png
node "$SCRIPTS/cdp.mjs" get-console        # confirm the app loads without errors
bash "$SCRIPTS/chrome-launcher.sh" stop
```

Read `/tmp/quality-onboarding-verify.png` to confirm the app renders. This is a
sanity check that the dev URL and access recorded in the profile actually work —
not an audit. The full dimensional methodology lives in `quality-audit-workflow`.

### Report what was learned

```
## Quality Onboarding Complete (solo — no scout)

Product: {name}
Stack: {frontend} + {backend}
Sources ingested: {source}: {what was learned}; ...

Wrote: .agents/quality.md
  Specialist weights: {the high ones} prioritized; {the low ones} de-prioritized
  Top QA priorities: 1) {…} 2) {…} 3) {…}
  Target environments: {local/staging}, viewports {…}
  Standing waivers: {n, or none}

Suggested: CLAUDE.md additions (see above)

Ready to audit. Quinn reads .agents/quality.md on demand; try the
quality-audit-workflow against {dev_url}.
```

---

## Re-running

When the product changes significantly (new features, architecture shifts, new
data handling, new target platforms), re-run this skill to refresh the profile:
read the existing `.agents/quality.md`, ask what changed, re-ingest the updated
sources, and **merge** the new findings into the file — don't blindly replace
hand-tuned waivers or rubric notes. If a `scout` / `seeding-a-project` install
later lands on the project, scout's autonomous Step 6.6 pass takes over this file;
at that point this solo path is no longer needed.

## References

- [`seeding-a-project/references/templates.md`](../seeding-a-project/references/templates.md#agentsqualitymd-template)
  — the `.agents/quality.md` schema this skill writes (source of truth). Scout's
  autonomous QA pass writes the same shape.
- [`browser-verify/SKILL.md`](../browser-verify/SKILL.md) — CDP commands for the
  Phase 6 smoke test.
- [`quality-audit-workflow/references/mcp-servers.md`](../quality-audit-workflow/references/mcp-servers.md)
  — which optional MCPs sharpen which audit dimension (all optional; CDP-only by
  default).
- [`quality-audit-workflow/SKILL.md`](../quality-audit-workflow/SKILL.md) — the
  audit methodology Quinn runs *after* onboarding, reading this profile on demand.
