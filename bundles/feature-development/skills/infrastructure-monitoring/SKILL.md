---
name: infrastructure-monitoring
description: Use when reviewing infrastructure health, investigating alerts or operational degradation, configuring dashboards and alerts, or handing off post-release monitoring.
---

# Infrastructure monitoring

Investigate when invoked; external telemetry and alerting systems provide
continuous detection. Scheduled or alert-triggered agent dispatch is separate
project configuration. This is runtime monitoring, not `delivery-monitor`'s
development throughput tracking.

## Assess

1. Read the service/environment inventory, monitoring ownership and authorized
   incident runbooks. Determine whether this is a release observation, unrelated
   incident, maintenance task or monitoring implementation. For release-linked
   work or operational exceptions, load `release-planning` for its authority,
   chat-waiver and record contract. Standalone users should install it alongside
   this skill.
2. Inspect existing dashboards, metric/log/trace queries, SLOs and alert routing.
   Load [monitoring guidance](references/observability.md) for signal selection
   and the relevant provider documentation. Distinguish telemetry failure from
   workload health; stale, absent or insufficient samples are unknown.
3. Correlate user-visible failures and latency with deployment events, dependency
   health, capacity, saturation and platform events. For Kubernetes, inspect pod
   readiness/restarts, OOMs, pending scheduling, node health, quotas and storage;
   adapt to the actual non-Kubernetes runtime when applicable. Record timestamps,
   affected services, hypotheses, evidence and confidence without leaking secrets.
4. Investigate read-only by default. Apply remediation only within an authorized
   runbook or explicit scoped chat approval; an unrelated CPU alert does not
   authorize resizing, restarts or network changes. Use `release-recovery` for
   release rollback/roll-forward. Escalate other actions with concrete options.

## Improve and hand off

For assigned dashboard/alert/IaC changes, use existing tools, review the diff,
validate configuration and test alert firing, missing-data behavior, routing and
recovery in an authorized test environment. Separate config validation from actual
notification delivery. Live paging tests need the project's authorization.
Use normal Tech Lead review and PM merge ownership; major platform redesign is
an architectural task. Link alerts to an owner and actionable runbook.

Return target, observation interval, queries/evidence, health verdict, impact,
actions/authorization and follow-up owner. Never extrapolate one snapshot into
ongoing monitoring. Record who owns subsequent observations and when; if no owner
exists, surface the gap. Report uncertainty and provide the chat-override path
for policy gates without treating an exception as a healthy measurement.
