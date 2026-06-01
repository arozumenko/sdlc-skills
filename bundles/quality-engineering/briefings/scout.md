---
name: Project briefing
description: Quality-engineering overlay — onboard a product for a manual QE discipline team; map running instance, requirements, cases, and run reports
type: project
---

## Project Knowledge

- **Engagement type:** Manual quality-engineering — a **governance + coverage** discipline, not test automation and not a run-execution machine. The team triages requirements, authors manual cases that trace to those requirements, executes them by hand, reports, and triangulates requirement↔case↔result. Your onboarding feeds that pipeline, so map the **evidence chain**, not the application architecture in depth.
- **The running instance:** find how to reach a live, exercisable build — base URLs per environment (dev/staging/QA), the auth path and **which sample users/roles** exist (record env-var keys, never secrets), and how a tester gets a fresh build under test. Manual execution lives or dies on this; if there's no reachable instance, say so loudly.
- **Where requirements live:** the source of truth for stories + acceptance criteria — a tracker (Jira/Azure Boards/Linear), product docs, or a **requirement matrix that arrives as Excel** (the `requirement-traceability` skill reads those via `xlsx-reader`). Record the location and format so Quinn can triage and triangulate against it.
- **Where cases + results live:** existing manual test cases (TC files, a `test-cases/` tree, or xlsx) and prior run reports / a TMS (TestRail/Xray/Zephyr). These are the other two ends of the traceability matrix — note their format and whether case→requirement links already exist or have to be reconstructed.

## My Role Focus

Onboard the product for a manual QE team: produce the usual
`.agents/*.md` (`profile.md`, `workflow.md`, `team-comms.md`) so the PM
(Max) can run the triage→author→execute→report→triangulate
pipeline without flying blind. The three fields the team leans on hardest
are the **reachable running instance** (with sample users), **where
requirements live**, and **where cases + run reports live** — fill them or
flag them explicitly as gaps.

For this bundle, optionally seed **`.agents/quality.md`** — the per-product
quality profile Quinn reads on demand: which **specialists** are relevant
(a11y/security/privacy/performance/responsive/content-SEO/UX), the
**risk areas** worth weighting, and the **target viewports/surfaces**.
Derive every field from the stack and product you already surveyed — no
user interview — and flag the rest under § Unconfirmed. Keep it out of the
always-injected shared-doc set; it's read on demand, not on every session.
