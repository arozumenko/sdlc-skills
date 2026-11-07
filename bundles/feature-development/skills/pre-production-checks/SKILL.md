---
name: pre-production-checks
description: Use when assessing release readiness, validating staging or pre-production, checking deployment prerequisites, or deciding whether promotion can begin.
---

# Pre-production checks

**Prerequisite:** load `release-planning` for its authority, chat-waiver and
record contract. The `release-engineer` role installs it with this skill.
For a standalone install, include
`--skills release-planning,pre-production-checks`; if unavailable, explain the
missing prerequisite rather than inventing a conflicting approval policy.

## Verify the candidate

1. Read the release record and existing approvals. Match the source commit,
   immutable artifact, config revision and exact target to the actual pipeline.
   Verify that QA and CI evidence cover this candidate; a different build is not
   interchangeable. Check required provenance/signature and vulnerability evidence
   against project policy; exceptions remain visible.
2. Inspect environment readiness: permissions without exposing credentials,
   dependencies, certificates, quotas/capacity, open incidents, drift and current
   deployment. For Kubernetes, check nodes, probes, resources, scheduling and
   disruption constraints. Validate Helm rendering/linting and manifests with
   version-matched tools; a dry run alone does not prove runtime readiness.
3. Run the agreed staging/smoke checks against representative configuration and
   dependencies. Record environment differences and test-data limitations. Route
   functional failures to QA/developers; consume their evidence rather than
   silently replacing their acceptance criteria.
4. Verify migration order, old/new compatibility and the recovery procedure's
   evidence, including any required restore rehearsal. Check the known-good
   artifact is available. Unsupported reversal needs a credible roll-forward or
   coordinated restore plan with explicit data-loss authorization.
5. Verify release-labelled health queries, baseline, sample minima, windows,
   alert routing and named monitoring owner. Identify the rollout lock and
   active runs. Missing/stale/no-data telemetry is **inconclusive**, not healthy.

## Verdict

Record each required gate as passed, failed, inconclusive or waived, with
artifact/target, observation time, evidence link, threshold and actual result.
Use N/A only with a reason showing the gate does not apply.

- **Ready:** required gates pass and execution authority exists.
- **Ready with accepted exceptions:** every unmet gate has a scoped chat/policy
  waiver and execution is authorized. Preserve the waived evidence and proceed
  without another confirmation.
- **Blocked:** a known failed prerequisite or absent authority remains unresolved.
- **Inconclusive:** evidence cannot establish readiness; hold promotion unless
  explicitly waived under release-planning.

Give the human concrete options for each unresolved item. Handoff to
`progressive-delivery` carries the record, evidence freshness and approval scope.
An impossible operation stays blocked even if its risk is accepted.
