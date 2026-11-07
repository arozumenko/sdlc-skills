# Operational signals and actionable alerts

Use the project's telemetry backend. [OpenTelemetry](https://opentelemetry.io/docs/what-is-opentelemetry/)
provides instrumentation/collection conventions for metrics, logs and traces;
it does not replace an operational backend, alert routing or an on-call owner.

## Release health

Correlate release version, environment, service and observation interval. Compare
candidate and control plus absolute service objectives. Inspect request errors,
latency distributions, throughput and critical user flows alongside saturation,
queues and dependency behavior. Fleet-wide averages can hide a broken canary.

Define sample minima and observation windows before evaluating. Distinguish
zero errors with real requests from no requests, missing series, stale data or
query failures. Validate that a query isolates the candidate and uses the intended
time range. Test alert behavior for empty results and telemetry outages.

## SLOs and escalation

Where SLOs exist, use the project's error-budget policy and actionable burn-rate
alerts. Multiwindow approaches balance detection speed and noise; thresholds
depend on the service, not a universal template. See
[Google SRE alerting on SLOs](https://sre.google/workbook/alerting-on-slos/).

Every actionable alert needs severity, service/environment, owner, evidence,
runbook and recovery criteria. Capacity warnings can become planned work; user
impact may require incident response. Confirm routing with an authorized test;
configuration syntax alone does not prove notifications arrive. Avoid creating
live test pages without permission. Redact credentials and sensitive payloads.

## Infrastructure investigation

Inspect CPU/memory/storage and network saturation, resource limits, autoscaling,
node health, pod readiness, restarts, OOM kills, pending workloads, failed jobs,
certificates, quotas and cloud health events as applicable. Correlate rather
than treating high CPU as sufficient evidence for an automatic restart.

Provider references:
- [AKS monitoring](https://learn.microsoft.com/en-us/azure/aks/monitor-aks)
- [EKS reliability](https://docs.aws.amazon.com/eks/latest/best-practices/reliability.html)
- [Cloud Deploy canary analysis and strategies](https://docs.cloud.google.com/deploy/docs/deployment-strategies/canary)

An agent health report is a bounded observation. External monitoring continues
afterward; agent dispatch, paging authorization and named human ownership are
separate project configuration. Sources researched 2026-11-06; verify current
provider capabilities when operating.
