---
name: release-recovery
description: Use when a release fails, a rollback or roll-forward is requested, deployment state is uncertain, or a recovery procedure needs preparation or verification.
---

# Release recovery

**Prerequisite:** load `release-planning` for its authority, chat-waiver and
record contract. Standalone installs need both skills. Recovery is complete
only when the service outcome is verified, not when a rollback command exits.

## Recover

1. Establish actual target, deployed artifact/config, run state, migration state
   and user impact. Preserve useful logs securely. Pause further exposure within
   rollout authority and retain single ownership of deployment execution.
2. Read the approved recovery plan and existing chat decisions. Compare current
   data/schema, configuration, external side effects and infrastructure with the
   proposed recovery version. Check availability of artifacts and, where relevant,
   backup freshness, restore evidence and expected data loss/recovery duration.
3. Choose a viable route: revert compatible application/configuration; roll forward
   with a fix; disable a feature through an existing authorized mechanism; or
   coordinate data/infrastructure restoration. Helm rollback or redeploying an
   older container does not restore data or undo external effects. Route required
   application/migration work to developers and architecture decisions to Tech Lead.
4. Execute a compatible, preauthorized non-destructive runbook without repeated
   approval. A destructive action always needs a specific human confirmation for
   the current situation, even when a runbook preauthorizes it. First present
   exact scope, consequences and recovery evidence, then obtain and record that
   confirmation from a named human under release-planning's record contract.
   For a different non-destructive action outside existing authority, present
   the same evidence and obtain scoped approval. An incompatible container
   rollback cannot be made viable by waiving a readiness check.
5. Use the existing controller/pipeline recovery path and concurrency mechanism.
   Reconcile declarative desired state so reconciliation does not undo recovery.
   Record command/run identity and results. If interrupted, inspect actual state
   before retrying; partially applied migrations require a supported resume or
   recovery procedure, not blind replay.
6. Verify user-facing flows, data integrity where applicable, service/dependency
   health and telemetry for the planned recovery window. If recovery fails, retain
   evidence, bound further attempts and escalate the concrete next option.

## Report

Record the failed release, trigger, blast radius, actual recovery version/config,
authorization, actions, health evidence, data impact, remaining risks and owners.
Distinguish **recovering**, **recovered**, **recovery failed**, and **verification
pending**. A human-approved evidence exception is accepted risk, not proof of
recovery. Notify PM through authorized team channels and route follow-up fixes.
