---
name: security-engagement
description: "Use when running a security engagement end to end as the lead — init, review, register, model, cases, hand-off, report, fix, acceptances, sign-off; points at the other security-testing skills rather than duplicating their commands."
license: MIT
metadata:
  authors:
    - "Daniel Sallai <Daniel_Sallai@epam.com>"
  version: "1.0.0"
---

# Security engagement

You are the **lead**. This skill has no scripts of its own — it is the
procedure that sequences `secure-code-review`, `threat-modeling`,
`security-test-planning` and `risk-register`, and the dispatches to
`security-reviewer` and `threat-modeler` in between. You run the row
verbs and the read-only commands yourself; the emitter-only events
(`fixed`, `regressed`, `acceptance-expired`) are appended by the
scripts, never typed by you.

## The one procedure

`references/workflow.md` is the **only** place the 11-step operator
flow lives — one fenced command per step, with the result line that
tells you it worked. Do not restate the steps elsewhere; point at this
file. In brief: start the engagement, dispatch the review, check it,
get second opinions where warranted, register the verified findings,
dispatch the threat model, admit and hand off the candidate cases,
report, verify fixes, record acceptances, sign off.

## References

- `references/workflow.md` — the 11 steps, in spec §7 order, each a
  fenced command plus its expected result line.
- `references/sign-off-checklist.md` — spec §7 step 11 in full: the
  four checks (`cite.mjs check` on findings and on the threat model,
  `cases.mjs verify-suite`, `register.mjs status` plus a clean `git
  status`), what "OK" lets you say, and what to hand over.
- `references/tracker-rules.md` — filing a finding: search first
  through `issue-tracking`, post, then `register.mjs ticket <R-id>
  <url>`. Threats are not ticketed in v1.

## Standalone vs factory install

Installed alone (`--skills security-testing/security-engagement`), this
skill still expects the sibling skills — `secure-code-review`,
`threat-modeling`, `security-test-planning`, `risk-register` — to be
installed too; it names their scripts by relative path
(`../secure-code-review/scripts/cite.mjs`, and so on) rather than
shipping copies. Install the whole `security-testing` factory
(`--factory security-testing`) to get the lead role, the specialist
agents, and all five skills together with one `engagement.md` shared
across them. `REGISTER: skipped (risk-register not installed)` from
`verify.mjs`, and no `register.mjs`/`cases.mjs` commands to run in
`references/workflow.md`, are what a `secure-code-review`-only install
looks like — this skill is not that install.

## What this skill does not do

It does not read code, write findings, derive a threat model, write
test cases, or hold the register's log — every one of those lives in
the skill named for it. It sequences them, dispatches the two agent
roles, and is where the sign-off prose lives because no single command
in this bundle produces a sign-off verdict.
