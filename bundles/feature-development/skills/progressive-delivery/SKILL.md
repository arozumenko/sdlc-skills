---
name: progressive-delivery
description: Use when deploying an approved release, evaluating staged promotion, pausing a rollout, or resuming interrupted deployment execution.
---

# Progressive delivery

**Prerequisite:** load `release-planning` for its authority, chat-waiver and
record contract. Standalone installs need both skills. Use
`pre-production-checks` for readiness and `release-recovery` on a recovery branch;
install those skills too if those branches are required and unavailable.

## Execute and observe

1. Reconcile the record with actual artifact, configuration, target, active
   pipeline/controller run and migration ledger. On resumption inspect whether
   prior steps finished, failed, remain active or partially applied. Resolve
   unknown outcomes before retrying; prove idempotency before replaying a step.
2. Enforce **one active rollout per service/environment** using the existing
   pipeline concurrency group, controller or atomic lock. A read-only check is
   not a lock. If no mechanism exists, establish serialization before execution.
   Resume the owning run rather than starting a competitor; coordinate an
   explicit cancellation/takeover rather than clearing an uncertain lock.
   Known execution state and serialization are execution preconditions, not
   health-evidence gates. Offer a concrete coordinated takeover or supported
   retry, using existing authority when it covers the action and seeking approval
   only for new scope; a gate waiver alone does not establish exclusive ownership
   or make an unknown migration safe to replay.
3. Confirm readiness, evidence freshness and authority for the next action,
   including recorded exceptions. Execute the project's pipeline or declarative
   controller path. Avoid out-of-band changes that GitOps would reconcile away.
   Persist run ID, stage, actual result and recovery target as execution proceeds.
4. At every stage evaluate the planned user-impact metrics, dependency health,
   resource pressure and smoke checks against baseline and absolute thresholds.
   Use release-specific samples and actual observation duration. Replica counts
   do not necessarily represent traffic percentages. Recheck relevant approvals
   against current scope; do not request them again when already sufficient.
5. Promote after the required window and samples pass, or under an explicit
   exception covering those gates. Missing/stale telemetry holds advancement as
   inconclusive unless explicitly waived under the same contract. A breached gate
   pauses/aborts the rollout within authority and invokes authorized recovery;
   lacking recovery authority, hold and present the specific action for approval.
   Record results honestly, including any waiver.

## Record checkpoints

Create append-only checkpoints on a dedicated release-record branch, committed
and pushed, recording approvals, run/lock state and the next observation owner.
Handoffs cite the branch and exact commit so a resumed session can continue
before merge. Tech Lead reviews and PM merges through the normal gate.
An unmerged checkpoint never counts as completion.
When the record cannot be written to the repo, carry it in chat marked
"persistence pending", keep it visibly unfinished, and write it to the repo at
the first opportunity. A release cannot be closed while the record is still
pending persistence.

## Finish or hand off

At full exposure, complete the agreed observation window and identify the
monitoring owner before declaring **verified healthy**. Record deployed
artifact/config, health evidence, recovery availability, residual risks and
follow-up ownership.
Closed with accepted risk requires a named human's explicit waiver of the
remaining observation. Never report it as verified healthy. The record must list
the evidence gaps and the follow-up owner.

If observation exceeds the session, report **deployed; verification pending**,
run/controller status, lock owner, completed steps, pending checks, next check
time and continuation owner. Use bounded waits with host-supported completion;
do not claim ongoing surveillance or hold an agent session open indefinitely.
Release the rollout lock only when no conflicting execution remains; if release
policy holds it through observation, transfer ownership explicitly in the handoff.
