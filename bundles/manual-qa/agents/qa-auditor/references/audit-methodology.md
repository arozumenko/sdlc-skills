# Audit Methodology

The full workflow for a `qa-auditor` specialist web audit: evidence collection,
specialist selection, the shared finding schema, dedupe, the report template,
and the codify handoff. `AGENT.md` has the summary; this file has the detail.

---

## Step 0: Load Context

Before collecting anything, check for product knowledge:

1. Read `.agents/manual-qa/app_profile.md` if it exists — base_url, credentials,
   selectors, key flows, fragile areas.
2. Read `.agents/manual-qa/project-context.md` if it exists — architecture,
   environments, risk areas, specialist relevance.
3. If neither exists, work from what the caller gave you (at minimum, a target
   URL). Note in the report that no app profile was available.

---

## Step 1: Collect Evidence (Step-0 collection recipe)

All evidence comes from the Playwright MCP `browser_*` tools (the
`playwright-testing` skill) — **not** `browser_evaluate`, which is not part of
this factory's Playwright MCP tool set. Everything below works from the
accessibility snapshot, screenshots, console messages, and network requests
only. Where a check would normally read page-injected data (meta tags,
cookies, localStorage/sessionStorage, Core Web Vitals timing, axe-core rule
IDs), that data is **not available** here — say so explicitly in the finding
and cap confidence at 1–4 ("possible") unless the accessibility snapshot or
network response headers independently confirm it.

For each target page, run this sequence:

1. **`browser_navigate(url)`** — go to the page.
2. **`browser_snapshot()`** — accessibility tree: roles, names, refs, form
   structure, landmark structure. This is the primary data source for
   accessibility, content, and much of UX/security analysis.
3. **`browser_take_screenshot(type:"png", filename:"reports/screenshots/audit-{page}-{YYYY-MM-DD}.png")`**
   — visual evidence for layout, UX, responsive, and content findings.
4. **`browser_console_messages(level:"error")`** — JS errors and warnings;
   feeds performance and security findings (CSP violations, uncaught
   exceptions).
5. **`browser_network_requests()`** — request/response list; feeds security
   (response headers, mixed content), performance (failed/slow requests,
   4xx/5xx), and privacy (third-party tracker domains) findings.

### Multi-page audits

**Navigating resets the console and network buffers.** Collect all target
pages first — run the full 5-step sequence per page, in order, before running
any specialist analysis pass:

```
navigate(page1) → snapshot → screenshot → console_messages → network_requests
navigate(page2) → snapshot → screenshot → console_messages → network_requests
navigate(page3) → snapshot → screenshot → console_messages → network_requests
...
# only after all pages are collected: run specialist passes over the full set
```

If you analyze while still navigating, you lose page1's console/network data
the moment you `browser_navigate` to page2 — collect first, analyze after.

### No browser tools available

If the Playwright MCP is unavailable, ask the user for a screenshot and note
the missing evidence sources (console, network, accessibility tree) in the
report footer — every specialist's confidence drops accordingly.

---

## Step 2: Select Specialists

Read `skills-on-demand` in `AGENT.md` for the full list. Load only the
specialist SKILL.md files that apply — each is self-contained with its own
domain references (e.g. `owasp-checklist.md`, `wcag-checklist.md`).

### Always run (every web page audit)

| Specialist skill | Domain |
|---|---|
| `security-audit` | Security & OWASP 🔒 |
| `privacy-audit` | Privacy, cookies, GDPR 🍪 |
| `accessibility-audit` | Accessibility & WCAG ♿ |
| `content-seo-audit` | Content & SEO ✍️ |
| `performance-audit` | Performance, networking, console, JS 📡 |

### Conditional activation (detect from the collected snapshot/screenshot)

| Signal | Activate |
|---|---|
| Form elements (`<form>`, text inputs, selects) visible in the snapshot | `ux-audit` (forms checks) |
| UI components (nav, cards, modals, CTAs) visible in the screenshot | `ux-audit` (UI/UX checks) |
| Page matches a known type (pricing, checkout, signup, landing, etc.) | `ux-audit` (page-type checks — see its `page-types.md`) |
| Mobile viewport requested, or layout looks non-responsive at default width | `responsive-audit` |
| Error states visible in the snapshot/screenshot | `ux-audit` (error-message checks) |

### User-scoped requests

If the caller asked for specific checks ("find security issues", "check
accessibility"), run only those specialists — skip the always-run default.

---

## Step 3: Run Specialist Passes

For each selected specialist, read its `SKILL.md` and follow its methodology
against the evidence already collected in Step 1. Only run additional
`browser_*` calls if a specialist needs data not already gathered (e.g.
`responsive-audit` resizing the viewport and re-collecting a screenshot).

Each specialist produces findings in the schema below.

---

## Finding Schema

Every specialist produces findings in this format:

```json
{
  "title": "Short descriptive title",
  "types": ["Category1", "Category2"],
  "priority": "p1",
  "confidence": 8,
  "reasoning": "Why this is a problem and user impact",
  "suggested_fix": "Plain English fix description",
  "fix_prompt": "Ready-to-paste prompt to fix this",
  "specialist_icon": "♿",
  "specialist_specialty": "Accessibility & WCAG"
}
```

**Priority:** `p0` = critical (blocks UX, security risk, data loss), `p1` =
high (degrades experience, affects many users), `p2` = medium (noticeable,
workaround exists), `p3` = low (minor polish, edge case).

**Confidence:** `8-10` definite (evidence proves it), `5-7` likely (strong
indicators), `1-4` possible (needs verification, or a limitation like the
missing `browser_evaluate` data applies).

**Evidence rule:** confidence 8–10 requires direct proof (screenshot excerpt,
snapshot node, network trace/response header). Confidence 5–7 requires at
least indirect indicators. Confidence 1–4 is for educated guesses where direct
evidence isn't available through this toolset — never fabricate evidence, and
never report something you can't point to.

Per-specialist priority overrides (from each skill's Output section):
security defaults p0–p1 unless informational; privacy tracking-before-consent
is p0–p1; performance 4xx/5xx and console errors are p1; content-seo SEO
issues are p0–p1 while content-quality issues are p2–p3 unless in a critical
CTA.

---

## Step 4: Deduplicate and Rank

- Merge findings describing the same underlying issue; keep the higher
  priority and richer evidence when merging.
- **One finding per issue across pages** — the same missing security header
  or the same WCAG violation appearing on 3 pages is one finding, with an
  `affected_pages` note, not three.
- Sort by priority descending (p0 → p3), then by confidence descending.

---

## Step 5: Write the Report

Save to `reports/audit-{target}-{YYYY-MM-DD}.md`, grouped by specialist,
matching the factory's report tone (plain evidence-backed Markdown, as used by
`test-reporter`):

```markdown
---
target: {target}
date: {YYYY-MM-DD}
pages_audited: [{url1}, {url2}, ...]
specialists_run: [security, privacy, accessibility, content-seo, performance, ...]
---

# Web Audit Report: {target} — {date}

**Pages audited:** {N}
**Specialists run:** {N}
**Findings:** {total} ({p0_count} p0, {p1_count} p1, {p2_count} p2, {p3_count} p3)

## Summary

| Priority | Count |
|----------|-------|
| 🔴 P0    | N     |
| 🟠 P1    | N     |
| 🟡 P2    | N     |
| ⚪ P3    | N     |

## Findings by Specialist

### 🔒 Security & OWASP — {count} findings

#### [P0, confidence 9] {title}
**Affected pages:** {url(s)}
**Reasoning:** {why this is a problem and user impact}
**Evidence:** {screenshot path / snapshot node / network trace}
**Suggested fix:** {plain-English fix}
**Fix prompt:** `{fix_prompt}`

_(repeat per finding, per specialist section, in priority/confidence order)_

### 🍪 Privacy — {count} findings
...

### ♿ Accessibility & WCAG — {count} findings
...

### ✍️ Content & SEO — {count} findings
...

### 📡 Performance — {count} findings
...

### 🎨 UI/UX — {count} findings
_(only if `ux-audit` ran)_

### 📱 Responsive — {count} findings
_(only if `responsive-audit` ran)_

## Limitations

_(Note any missing evidence: no `browser_evaluate` — meta tags, cookies,
storage, Core Web Vitals, and axe rule IDs were not directly inspectable, so
related findings are capped at confidence 1-4 unless independently confirmed
via the snapshot or network headers. Note skipped specialists and why.)_

## Notes

> Executed autonomously by qa-auditor. Review screenshots for false positives.
> Screenshots in `reports/screenshots/`.
```

---

## Codify Handoff

After the report is written, the notable findings — **priority p0 or p1,
confidence ≥ 5** — get codified into regression test cases via `test-author`.

**Who dispatches `test-author` depends on how `qa-auditor` was invoked:**

- **Self-dispatch (the default)** — `qa-auditor` itself dispatches
  `test-author` via the Agent tool after writing the report, per `AGENT.md`'s
  "Codify handoff (standalone path)" section. This covers a user running
  `qa-auditor` directly with no suite context, **and** a request that names a
  suite/target and asks to codify into it — naming a suite is not, by itself,
  a reason to skip self-dispatch.
- **Lead-routed (the one exception)** — `qa-auditor` returns the report path
  and the list of notable findings in its final message and **does not**
  dispatch `test-author` itself, only when the invocation prompt *explicitly
  asks it to return the notable findings* for the caller to codify — the
  concrete signal `test-run-lead`'s audit branch uses is language like
  "return the notable findings" / "reporting back into suite {suite_path}".
  `test-run-lead` then collects that list and performs the dispatch once,
  after its own result-collection step, so the same findings aren't codified
  twice.

The signal to check is **not** whether a `run_id` / suite was named — it's
whether the prompt explicitly asked for findings to be *returned* rather than
*codified*. Without that explicit return-and-let-me-codify instruction,
self-dispatch — including when a suite path is present. When in doubt,
self-dispatch: silently skipping a requested codify is the failure mode to
avoid, not an extra dispatch.

If no finding meets the p0/p1 + confidence ≥5 bar, skip the dispatch entirely
and say so in the summary — don't invent a codify step where none applies.
