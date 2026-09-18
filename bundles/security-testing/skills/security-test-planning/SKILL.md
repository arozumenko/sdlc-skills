---
name: security-test-planning
description: "Use when turning a threat model's candidate cases or your own drafts into passive security test cases in manual-qa format, admitting them by lint against the allowed-operation grammar, and handing off a verified suite; provides cases.mjs."
license: MIT
metadata:
  authors:
    - "Daniel Sallai <Daniel_Sallai@epam.com>"
  version: "1.0.0"
---

# Security test planning

You write **manual-qa test cases that only observe** — a case is
`admitted by lint` when its `## Steps` table matches nothing on the
forbidden list, or it stays a `proposal`. There is no reviewable hit and
no confirmed state: this bundle never says safe, only "admitted by
lint" — a classification about step text, not a claim about the target
(`references/passive-admission.md`).

## Where a candidate lives

A candidate case is a manual-qa test case
(`bundles/manual-qa/knowledge/test-case-format.md`) at
`.agents/security-testing/cases/TC-NNN_<slug>.md` — directly under
`cases/`, no per-case subdirectory. The file name must match
`TC-NNN_<slug>.md` and its frontmatter `id:` must be that same `TC-NNN`.
Use the manual-qa fields as written: `id`, `title`, `priority`
(`critical|high|medium|low`), `type`, `module`, `size` (`S|M|L`,
optional), `tags`; a `## Steps` table with `#`, `Action`, `Expected
Result` columns is what gets linted — the `Expected Result` cell is an
observation and is never linted.

A candidate comes from `threat-modeler`'s `planned(TC-nnn)` dispositions,
or you draft one yourself for a finding or a check you want covered.

## The admission grammar, in short

Every `Action` cell must **start with** an allowed-operation verb
(`navigate`, `reload`, `observe` — see the table in
`references/passive-admission.md`) after leading Markdown emphasis is
stripped. Anything else is an `unknown-operation` hit. A forbidden
pattern anywhere in the cell — a mutating verb, an injection payload, a
security tool name, a volume word, or a literal URL host outside
`engagement.md` `targets.browser` — is its own hit
(`references/passive-admission.md` has the full rule table). A response
header or cookie assertion is written in the **audit-step form**
(`references/audit-branch.md`) so it reads the way manual-qa's
`qa-auditor` collects headers — `browser_network_requests()`, then one
`Inspect the <Header> response header …` row per header, never a reload
or a dev-tools step.

## `cases.mjs admit <case.md>`

- The candidate must live under `.agents/security-testing/cases/`, be
  named `TC-NNN_<slug>.md`, and its frontmatter `id:` must be `TC-NNN`.
- No hits ⇒ the redacted text is copied into
  `tasks/security-<slug>-admitted/` and the case is **admitted by lint**:
  `ADMITTED <suite>/<file>`.
- Any hit ⇒ the redacted text is copied to `<st>/proposals/` instead:
  `PROPOSAL <st>/proposals/<file> hits=<n>`, then one `HIT <rule> step
  <n>: <action>` per hit. Rewrite the step and admit again — there is no
  review path here that turns a hit into an admission.

## `cases.mjs verify-suite`

Every `TC-*.md` in the suite directory must be exactly what `admit`
wrote (its current sha256 matches `.admitted.json`). All match ⇒ `SUITE
ok=<n>`, then the manual-qa hand-off prompt (`Run as the active agent
(claude --agent test-run-lead): "Run the suite at
tasks/security-<slug>-admitted/ against base_url=<url>."`) and the
test-automation prompt (`TA-PROMPT cases=[...] slug=<slug>
base=<oid7>`). Any mismatch ⇒ one `UNADMITTED: <path>` per offender,
exit 4, no prompts — a file placed by hand or a stale copy has to be
admitted (or removed) before either hand-off goes out.

## Commands

`node scripts/cases.mjs --help`:

```
usage: cases <command> [options]

commands:
  admit
  verify-suite
```

All: `USAGE(<sub>: <why>)` (2) · `ENGAGEMENT-*` (2) · `CORRUPT
<suite>/.admitted.json` (5).

## References

`references/passive-admission.md` — the allowed-operation grammar, the
forbidden-pattern table, the classification, the `case_sha256` identity.
`references/audit-branch.md` — the audit-step form for header/cookie
checks, the mapping to manual-qa's `qa-auditor` expectations, and what
`sign-off`'s `UNADMITTED:` listing compares against.
