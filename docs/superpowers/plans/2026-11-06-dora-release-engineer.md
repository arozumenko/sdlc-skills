# Dora Release Engineer Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship Dora and five operational workflows in feature-development.

**Architecture:** Factory-owned agent and skills under `bundles/feature-development`.
Keep common policy in release-planning and reference it by skill name; provider
details are disclosed references. Reuse the installer with a tested shared-core
briefing fallback in `bin/lib/factory-selection.mjs`.

**Tech Stack:** Markdown, JSON manifests, Node built-in tests and installer.

**Spec:** `docs/superpowers/specs/2026-11-06-dora-release-engineer-design.md`

## Global Constraints

- Chat approvals waive specified gates without repeated confirmation.
- No live infrastructure execution; no new tool-stack requirement.
- Preserve PM merge ownership and Tech Lead architecture authority.
- Preserve existing unrelated work; changes remain reviewable on a feature branch.

## Review Focus

- Missing samples must remain inconclusive unless explicitly waived.
- Scoped chat approval must survive skill handoff and session resumption.
- Interrupted migrations and concurrent deployments must not be replayed.
- Recovery must distinguish application, data, and infrastructure compatibility.
- Standalone skill installs must surface prerequisites instead of broken file links.

### Task 1: Agent and operational workflow content

Files: agent AGENT.md/SOUL.md, five skills and their references/templates,
briefings/release-engineer.md, design document, and behavioral scenario record.

Consumes: approved scope. Produces: release-engineer and five named skill IDs.

- [x] Run baseline tabletop scenarios against existing team guidance.
- [x] Author role, policy, workflows, provider references and release-record template.
- [x] Evaluate A–K in a fresh agent context; after clause edits, recheck only
  B, J and an explicit concurrent-rollout request. Other cases were not rechecked;
  additional scenarios L and M remain unrun.

### Task 2: Factory integration and discovery

Files: factory.json, instructions.md, PM/Tech Lead/Scout agent handoffs,
README.md, factory README/FACTORY.md, onboarding docs, marketplace manifests,
bin/release-engineer.test.mjs.

Consumes: Task 1 IDs. Produces: installed core role and discoverable workflows.

- [x] Add and run failing dependency/roster integration tests.
- [x] Wire core roster, briefing, skill inventory, routing and documentation.
- [x] Regenerate catalogs and test installation into temporary directories.

### Task 3: Verification and review

Consumes: Tasks 1–2 artifacts. Produces: verified diff and recorded limitations.

- [x] Run npm test, npm run validate, and Agent Skills schema validation.
- [x] Review the full change with a fresh reviewer and address concrete findings.
- [x] Record actual results; leave changes uncommitted for user review.

## Execution notes

Implementation proceeds under the user's explicit Q21 approval. Use this
checkout on `feat/dora-release-engineer` so changes remain visible alongside
the user's existing files; do not include their untracked artifacts.

Ruling: core/dev-role factory resolution discarded generic `briefings` before
installation. Add a fallback only when no platform briefing applies, preserving
platform precedence and preventing duplicate shared briefings on mixed stacks.
Regression test failed before the fix and passed afterward.

Baseline: all 1,413 existing tests passed. Existing personas did not supply a
release protocol; baseline tabletop reasoning handled the supplied examples but
exposed missing durable contracts and PM's merged/live conflation. Do not claim
a measured behavioral pass-rate improvement from these simulations.

## Final validation

- Full `npm test`: 1,416 passed, 0 failed (208.7 seconds).
- Final focused run: 22 passed, including Dora's added five-host installer test
  and factory-selection coverage. The full suite started before that last
  installer test was added; its final version was verified in the focused run.
- `npm run validate`: passed factory, generated marketplace, all 30 external
  registry entries and duplicated-asset checks.
- All five new skills passed `skills-ref validate` against Agent Skills schema.
- `git diff --check`: passed. Fresh reviewer found no blocking defect.
- Behavioral evidence and limitations: `docs/testing/dora-release-engineer-scenarios.md`.
- No infrastructure operations, external messages, commits or pushes performed.

The repository ignores docs/superpowers; these two approved design/plan files
were explicitly marked intent-to-add so they remain part of the reviewable diff.
