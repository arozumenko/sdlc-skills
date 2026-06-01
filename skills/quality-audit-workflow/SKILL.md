---
name: quality-audit-workflow
description: Use when running or orchestrating a multi-dimension product quality audit — mode dispatch, p0–p3 finding schema, evidence rules, specialist routing, persona review, and report/issue output.
license: Apache-2.0
compatibility: Requires Chrome/Chromium + Node 22+ via the browser-verify skill (CDP).
allowed-tools: Bash(node:*) Bash(bash:*)
metadata:
  authors:
    - Artem Rozumenko <artem_rozumenko@epam.com>
    - Alexander Bychinskiy <alexander_bychinskiy@epam.com>
  version: "0.1.0"
---

## Quality Audit Workflow — the orchestration craft

This skill is the methodology the `quality-architect` agent preloads. It is **agent-orchestrated, not user-invokable**: a human asks the quality-architect for an audit; the architect dispatches the audit through the workflow below, loading domain specialists on demand and folding their findings into one ranked report. ICs (the specialist audits) own their domain checks; this skill owns mode dispatch, the finding schema, evidence discipline, specialist routing, dedup, and report/issue output.

It folds what used to be three separate agent-reference files into one place: the **mode dispatch** table, **Step 0** context loading, the **p0–p3 finding schema**, **evidence requirements**, the **dedup → report** flow, plus the **exploratory** and **verify-fix** loops. Routing tables, the persona-review method, and report templates live in this skill's `references/`.

**Core philosophy:** evidence-based only. Every finding points at something you can show — a screenshot, an axe-core violation ID, a network trace, a console line, a cookie. If you can't prove it, lower the confidence; never fabricate. A clean page gets a clean bill of health, not invented bugs.

## Mode Dispatch

Route the user's request to the right workflow:

| Mode | Trigger | Workflow |
|------|---------|----------|
| **Bug Audit** | "audit", "find bugs", "QA check", "check for issues" | Collect data → specialist passes → dedup → report |
| **Reproduce** | "reproduce", "confirm this bug", "can you repro" | Intake → setup → attempt → evidence → confirm |
| **Exploratory Testing** | "explore", "test the flow", "try the feature" | Charter → interact → observe → document |
| **Test Generation** | "write tests", "create test cases", "generate tests" | Analyze page → generate suites → report |
| **Verify Fix** | "verify fix", "is this fixed", "re-test" | Re-run reproduction steps → confirm resolved |
| **Persona Review** | "user feedback", "persona analysis", "what would users think" | Generate personas → evaluate → score → report |
| **Research** | "research", "learn about", "what are the mechanics of" | Plan → search → extract → synthesize → save |

- For **Reproduce** and **Verify Fix**, read the [`reproducing-issues`](skills/reproducing-issues/SKILL.md) skill.
- For **Research**, read the [`deep-research`](skills/deep-research/SKILL.md) skill.
- For **Test Generation**, read the [`test-generation`](skills/test-generation/SKILL.md) skill.
- For **Persona Review**, read [`references/persona-review.md`](references/persona-review.md).

If the request doesn't clearly match one mode, default to **Bug Audit**.

## Step 0: Load Context

Before any workflow, load the project's product knowledge. This repo's seeding writes lean shared docs under `.agents/`; read them instead of any single monolithic context file:

1. Read `.agents/profile.md` **§ Project systems** (base URL, environments, issue tracker, key flows, risk areas).
2. Read `.agents/testing.md` (frameworks, run commands, what's already covered).
3. Read the role's injected memory at `.agents/memory/<your-agent>/project_briefing.md` (accumulated product gotchas, prior-audit notes).
4. If a per-product quality profile exists, read `.agents/quality.md` (seeding writes it when a product needs one; it carries specialist relevance and risk-area weighting). It is **optional** — proceed without it if absent.

If none of these exist, work from what the user provides (URL, screenshot, code snippet) and suggest the operator run seeding for better results on future audits. Note any missing context in the report footer rather than guessing.

## Browser data via the browser-verify skill

All page data collection runs through this repo's [`browser-verify`](skills/browser-verify/SKILL.md) skill (Chrome over CDP, zero external deps). **Read `skills/browser-verify/SKILL.md` first** — it defines the script paths and the exact command names. Resolve the scripts from the install location and start Chrome once per session:

```bash
SCRIPTS=".claude/skills/browser-verify/scripts"
bash "$SCRIPTS/chrome-launcher.sh" start --headless
```

The Step-0 collection block per page (real `cdp.mjs` commands — do not invent names):

```bash
node "$SCRIPTS/cdp.mjs" navigate "<url>"
node "$SCRIPTS/cdp.mjs" screenshot --output /tmp/audit-<page>.png
node "$SCRIPTS/cdp.mjs" inject-axe          # axe-core WCAG audit → violations
node "$SCRIPTS/cdp.mjs" get-performance      # timing, resource sizes, LCP/CLS
node "$SCRIPTS/cdp.mjs" get-meta             # meta, OG, Twitter, structured data
node "$SCRIPTS/cdp.mjs" get-storage          # localStorage + sessionStorage
node "$SCRIPTS/cdp.mjs" get-cookies          # all cookies
node "$SCRIPTS/cdp.mjs" get-console          # console messages
node "$SCRIPTS/cdp.mjs" get-network --status error   # failed requests
```

Read each screenshot with the Read tool to get the visual view. For device-specific checks use `emulate <device>` (`mobile`, `iphone`, `ipad`, `tablet`, `android`, `desktop`, `laptop`); for computed-style proof use `get-styles <sel>`. Stop Chrome when the session ends:

```bash
bash "$SCRIPTS/chrome-launcher.sh" stop
```

**All evidence is ephemeral.** Write screenshots and dumps to `/tmp` (e.g. `/tmp/audit-home.png`, `/tmp/audit-pricing-step2.png`) — never a project-root `reports/` or `tests/` directory. The audit is a content layer over the consumer's tree; it does not litter their repo with artifacts.

**Fallback — no browser tools.** If browser-verify can't run (Chrome missing, Node too old) and no audit MCP is available, ask the user to upload a screenshot and note the missing data in the report. Don't fabricate around the gap.

## Specialist Routing

The check-type → skill routing table is in [`references/specialists.md`](references/specialists.md). Load specialists **on demand** — only the ones the page/request needs. Each is a self-contained `*-audit` skill with its own domain references.

**Always run (web pages):** [`security-audit`](skills/security-audit/SKILL.md), [`privacy-audit`](skills/privacy-audit/SKILL.md), [`accessibility-audit`](skills/accessibility-audit/SKILL.md), [`content-seo-audit`](skills/content-seo-audit/SKILL.md), [`performance-audit`](skills/performance-audit/SKILL.md).

**Conditional activation** (detect from the collected page data):

| Signal | Activate |
|---|---|
| Form elements (`<form>`, `<input>`, `<select>`) | [`ux-audit`](skills/ux-audit/SKILL.md) (forms checks) |
| UI components visible in screenshot | `ux-audit` (UI/UX checks) |
| Mobile viewport or misconfigured `<meta name="viewport">` | [`responsive-audit`](skills/responsive-audit/SKILL.md) |
| Page matches a known type (pricing, checkout, signup, …) | `ux-audit` (page-type checks) |
| EU-facing content, cookie banners, GDPR references | `privacy-audit` (GDPR checks) |
| Auth forms, admin panels, sensitive data handling | `security-audit` (OWASP checks) |
| Complex ARIA, screen-reader-critical flows | `accessibility-audit` (deep WCAG) |
| AI/chatbot elements on page | `ux-audit` (GenAI checks) |
| Error states visible | `ux-audit` (error-message checks) |

**Code snippets:** `security-audit`, `performance-audit` (JavaScript), `accessibility-audit` (HTML/JSX), `ux-audit` (HTML/CSS).

**User-scoped requests:** if the user asked for specific checks ("find security issues", "check accessibility"), run only those specialists.

## Bug Audit Workflow

### Step 1 — Collect

Start browser-verify and run the Step-0 collection block (above) for each page. Keep Chrome running for the whole session: on multi-page audits, collect **all** page data first, then run all specialist passes — this avoids re-navigating during analysis (remember `navigate` resets the console/network buffers per page). Try an audit MCP's `scan_page(url)` first if one is configured (see [`references/mcp-servers.md`](references/mcp-servers.md)).

### Step 2 — Run Specialist Passes

For each applicable specialist (see Routing above), read that specialist's `*-audit` SKILL.md and run its methodology against the data already collected in Step 1. Run extra browser-verify commands only when a specialist needs data not yet gathered (privacy tracker enumeration, device emulation). Each specialist emits findings in the **finding schema** below.

### Step 3 — Deduplicate and Rank

- Merge findings describing the same underlying issue (keep the higher priority/confidence).
- Sort by priority descending, then confidence descending.
- Cross-page: the same issue on N pages is **one** finding with the affected pages listed — not N findings (e.g. a missing security header).

### Step 4 — Report

Read [`references/report-templates.md`](references/report-templates.md) for the HTML report templates and the p0–p3 priority/badge mapping. Fill the placeholders (`{TARGET}`, `{DATE}`, `{SPECIALIST_COUNT}`, `{ANALYSIS_TYPE}`, `{TOTAL}`, `{P0_COUNT}`…`{P3_COUNT}`). The rendered report is an audit artifact — write it to `/tmp` (e.g. `/tmp/audit-<site>-<YYYY-MM-DD>.html`), not the consumer's tree.

### Step 5 — Present Summary

```
## Quality Audit — {target}
{total} issues found across {specialist_count} specialist checks.

### {icon} {Specialty} — {count} issues
**[p0 9/10]** {title}
Impact: {reasoning}
Fix: {suggested_fix}
```

### Step 6 — Next Steps

Offer relevant follow-up:

- **Generate test cases** — "Want me to generate test cases covering these findings?" ([`test-generation`](skills/test-generation/SKILL.md)).
- **File issues** — "Want me to push p0/p1 findings as tracker issues?" (via [`issue-tracking`](skills/issue-tracking/SKILL.md) / [`atlassian-content`](skills/atlassian-content/SKILL.md) — tracker-aware, reads `.agents/profile.md` § Issue tracker).
- **Sync to OneTest** — "Want me to create/sync test executions in OneTest?" (requires the test-management MCP — see § OneTest run sync below).
- **Explore deeper** — "Want me to explore [highest-risk area] in more detail?"

### Step 7 — Stop Browser

```bash
bash "$SCRIPTS/chrome-launcher.sh" stop
```

## Finding Schema

Every specialist produces findings in this exact shape:

```json
{
  "title": "Short descriptive title",
  "types": ["Category1", "Category2"],
  "priority": "p1",
  "confidence": 8,
  "reasoning": "Why this is a problem and the user impact",
  "suggested_fix": "Plain-English fix description",
  "fix_prompt": "Ready-to-paste prompt to fix this",
  "specialist_icon": "♿",
  "specialist_specialty": "Accessibility & WCAG"
}
```

**Priority.** `p0` = critical (blocks UX, security risk, data loss); `p1` = high (degrades experience, affects many); `p2` = medium (noticeable, workaround exists); `p3` = low (minor polish, edge case).

**Confidence (1–10).** 8–10 = definite (direct proof: screenshot, axe ID, network trace); 5–7 = likely (strong indirect indicators); 1–4 = possible (educated guess, direct evidence unavailable).

## Evidence Requirements

**Every finding must have backing proof. No exceptions.**

| Evidence type | Required for |
|---|---|
| Screenshot (in `/tmp`) | Visual issues, layout bugs, UI problems |
| Console output | JS errors, warnings, CSP violations |
| Network trace | Failed requests, slow responses, CORS errors |
| axe-core violation ID | Accessibility findings |
| Cookie/storage data | Privacy findings |
| Element selector | Any DOM-related finding |

**The evidence-discipline rule (preserved verbatim in spirit):** if you can't prove it, lower confidence to 1–4 ("possible") and note the missing evidence. Never fabricate evidence. Never report something you can't point to. Confidence 8–10 *requires* direct proof; 5–7 requires at least indirect indicators; 1–4 is reserved for educated guesses where direct evidence isn't available.

## Exploratory Testing

Session-based testing — learn the system, design tests, and execute them simultaneously.

**Charter:** *Explore [area] with [technique] to discover [risks].*

1. **Load context** — Step 0 (`.agents/profile.md`, `.agents/testing.md`, role briefing, `.agents/quality.md` if present) for known risks and flows.
2. **Define charter** — area, risk hypothesis, time-box (default 30 min).
3. **Start browser, navigate, screenshot to `/tmp`** (e.g. `/tmp/explore-start.png`).
4. **Observe and interact** — screenshot before/after every interaction, check `get-console` after each action, monitor `get-network --status error` for failures.
5. **Apply techniques:**
   - **Boundary** — empty, single char, 10000 chars, XSS payloads, SQL injection.
   - **State transitions** — back/forward, refresh mid-flow, deep links without auth.
   - **Error guessing** — double-click submit, rapid actions, expired tokens.
   - **User scenarios** — new user, power user, accessibility user, mobile user.
   - **Interruption** — lose network mid-submit, close tab mid-flow, timeout sessions.
6. **Document findings** — steps, actual, expected, evidence (`/tmp` paths), severity.
7. **Debrief** — bugs found, solid areas, new charters, residual risks.
8. **Stop browser.**

If a page surfaces multiple potential issues, trigger a full specialist audit on it.

## Verify Fix

Re-run the original reproduction steps against the fixed build and confirm resolution. Drive this through the [`reproducing-issues`](skills/reproducing-issues/SKILL.md) skill — it owns the intake → setup → attempt → evidence → confirm loop. Capture fresh evidence to `/tmp`; a fix is "verified" only when the previously-failing observable now passes *and you can show it*. If the original repro no longer applies (flow changed), say so and re-scope rather than declaring a pass on a stale path.

## OneTest run sync (optional)

Gated on the **test-management MCP** being present in the host config (see [`references/mcp-servers.md`](references/mcp-servers.md) — the `test-management` server). If it isn't configured, skip this section silently; the audit is complete without it.

When present, audit findings and generated executions can be synced to OneTest. Map verdicts to OneTest execution status as follows:

| Internal status | OneTest status |
|---|---|
| `passed` | `passed` |
| `failed` | `failed` |
| `blocked` | `blocked` |
| `skipped` | `skipped` |
| `not_run` | `not-executed` |
| `in_progress` | *(drop — do not sync)* |

> TODO: the full test-management tool list (create suite, attach evidence, link finding → case) is not enumerated here yet. Discover the available `mcp__test-management__*` tools at runtime and follow their schemas; keep the status mapping above authoritative.

## Anti-patterns

- **Fabricating a finding to look thorough.** A clean page gets a clean bill of health. Lower confidence, don't invent.
- **Reporting without evidence.** No screenshot / axe ID / trace → it's confidence ≤4 with the gap noted, or it isn't reported.
- **Writing artifacts into the consumer's repo.** Evidence and reports go to `/tmp`, never a project-root `reports/` or `tests/` dir.
- **Inventing browser commands.** Use only the `cdp.mjs` command names documented in `browser-verify` — read that SKILL.md first.
- **Running every specialist on every page.** Route per the signals table; load specialists on demand.
- **Duplicating cross-page findings.** One underlying issue = one finding with affected pages listed.
- **Hardcoding a TMS or MCP.** OneTest sync is gated on the MCP actually being present; degrade gracefully when it isn't.

## References

- [`references/specialists.md`](references/specialists.md) — check-type → `*-audit` skill routing table, page-type checks, default checks by input type.
- [`references/persona-review.md`](references/persona-review.md) — the persona-review method (quick lens + full 6-persona review, per-persona schema).
- [`references/report-templates.md`](references/report-templates.md) — HTML report templates (bug audit, persona feedback, test cases) + p0–p3 priority mapping.
- [`references/mcp-servers.md`](references/mcp-servers.md) — optional audit MCP catalog, config snippets, per-host file mapping.
- [`skills/browser-verify/SKILL.md`](skills/browser-verify/SKILL.md) — CDP command reference for all data collection.
