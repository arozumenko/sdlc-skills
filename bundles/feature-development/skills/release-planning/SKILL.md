---
name: release-planning
description: Use when preparing a release or hotfix, changing deployment scope, defining release gates, or recording production authorization and chat-approved exceptions.
---

# Release planning

Produce an executable plan and durable record for the actual artifact and target.
This skill owns the shared release authority and evidence contract used by
pre-production-checks, progressive-delivery, release-recovery and infrastructure-monitoring.

## Plan

1. Read existing release policy, workflow, deployment configuration and open
   incidents. Identify service, source commit, immutable artifact digest/version,
   configuration revision and exact target account, region, cluster/namespace or
   non-Kubernetes equivalent. Inspect installed tool versions. Load
   [platform guidance](references/platforms.md) only for the detected stack.
2. Use the project's release-record location or `docs/releases/<release-id>/`.
   Start from [the record template](templates/release-record.md). Reference
   restricted logs securely; keep secrets and production personal data out of Git.
3. Map dependency order, migration compatibility, capacity and blast radius with
   developers and Tech Lead. Select rolling, canary, blue/green or another existing
   strategy. State why it fits the workload, traffic and available routing.
4. Define stages, observation windows, minimum sample counts, fresh metric queries,
   thresholds, abort conditions, smoke tests and ongoing monitoring owner. Low
   traffic needs an explicit alternative, not invented statistical confidence.
5. Specify the known-good artifact, recovery mechanism, compatibility evidence,
   expected recovery time, data-loss implications and authorization. Coordinate
   application, configuration, infrastructure and data changes; a container rollback
   does not reverse a migration. Route unresolved architecture to Tech Lead.
6. Record environment execution authority, pipeline concurrency mechanism, and
   continuation owner. Hand the plan to pre-production-checks. Planning does not
   deploy; emergency changes retain explicit checks or recorded exceptions.

## Authorization and chat overrides

Use existing policy and prior session approvals. Where authority is absent,
finish preparation and ask for the specific production action. Read-only
investigation and reversible local preparation need no extra release approval.

A missing, stale, failed or inconclusive required gate holds promotion by default.
Explain the concrete risk and options. **Explicit written human approval in chat
can waive that gate**; no separate approval system or repeated confirmation is
required. “Yes” accepts a clearly scoped exception just presented. A generic
“ship it” without a disclosed gap is not automatically an informed waiver.

Record the named approving human (never invent identity). If the host cannot
supply identity, ask for the approver's name in chat and record it as
self-declared. Record timestamp/message reference, exact approval,
release/artifact/configuration/target, waived gates, disclosed risks, allowed
actions and any time/stage limits.
Carry this record across skills and resumed sessions. Proceed without asking
again while approval covers the action; re-open only for materially different
risks or changed scope. Keep gate status **waived**, never passed.
A destructive action always needs a specific human confirmation for the current
situation, even when a runbook preauthorizes it.

Distinguish gate waiver from deployment/remediation authority; the same chat
message can grant both. Approval cannot bypass credentials, enforced access
controls or technical impossibility.
When the record cannot be written to the repo, carry it in chat marked
"persistence pending", keep it visibly unfinished, and write it to the repo at
the first opportunity. A release cannot be closed while the record is still
pending persistence. Do not erase approval or require the human to repeat it
solely because the record store is unavailable.

## Record checkpoints

Create append-only checkpoints on a dedicated release-record branch, committed
and pushed, recording approvals, run/lock state and the next observation owner.
Handoffs cite the branch and exact commit so a resumed session can continue
before merge. Tech Lead reviews and PM merges through the normal gate.
An unmerged checkpoint never counts as completion.

## Completion

Return record path, artifact/target, strategy, gate and recovery readiness,
authority/exception references, unresolved decisions and next owner. Keep merged,
deployed, verified healthy and closed with accepted risk distinct.
Closed with accepted risk requires a named human's explicit waiver of the
remaining observation. Never report it as verified healthy. The record must list
the evidence gaps and the follow-up owner.
