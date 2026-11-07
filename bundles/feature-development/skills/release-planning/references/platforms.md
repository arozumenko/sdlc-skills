# Platform-specific release guidance

Read the relevant section after detecting the project's platform. These are
decision aids, not a requirement to install new products. Check installed
versions and current official documentation before selecting commands or flags.

## Kubernetes and Helm

Inspect desired and live manifests, image digests, chart/values revisions,
namespace/context, health probes, resources, quotas, scheduling, disruption
budgets and dependencies. Validate charts and rendered resources; then verify
runtime health through the agreed tests. Check hooks/jobs and custom resources
for lifecycle behavior before assuming they reverse with a chart revision.

Helm release history and rollback can assist application recovery, but are not
database backups or transactional infrastructure restoration. Inspect the installed
Helm major version: failure/rollback and wait flags differ across versions. Read
[Helm upgrade](https://helm.sh/docs/helm/helm_upgrade/) and
[Helm rollback](https://helm.sh/docs/helm/helm_rollback/) for that version.

## Progressive delivery and GitOps

Use the existing controller and source of desired state. A manual live change
may be reconciled away; coordinate the declarative rollback with the controller.
Confirm that routing actually produces the intended exposure rather than
equating replica percentages with request percentages.

- [Argo Rollouts analysis](https://argoproj.github.io/argo-rollouts/features/analysis/):
  configure success/failure/inconclusive handling, sample windows, analysis
  credentials and metric freshness. Inspect the traffic provider's capabilities.
- [Flagger](https://docs.flagger.app/): progressive traffic shifting and metrics/
  conformance analysis; suitable when already present or a justified addition.
- [Google SRE canary guidance](https://sre.google/workbook/canarying-releases/):
  compare candidate and control with user-impact signals and bounded exposure.

## Azure / AKS

Verify tenant/subscription, resource group, cluster, node pools, workload identity,
registry access, quotas, networking and upgrade/maintenance constraints. Use the
project's Azure DevOps, GitHub Actions or existing delivery system. Progressive
exposure applies to infrastructure/configuration as well as application changes.

- [Safe deployments](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/safe-deployments)
- [AKS monitoring](https://learn.microsoft.com/en-us/azure/aks/monitor-aks): platform
  signals, logs, managed Prometheus, Container insights and Grafana as applicable.

## GCP / GKE

Verify project, location, cluster/runtime, IAM/service identity, artifact access,
quotas and maintenance constraints. If Cloud Deploy exists, inspect target,
release, rollout, phase, verification/analysis and promotion configuration.
Confirm the configured networking mode's exposure semantics.

- [Cloud Deploy canary strategies](https://docs.cloud.google.com/deploy/docs/deployment-strategies/canary)

## AWS / EKS

Verify account/role, region, cluster, node groups or compute mode, workload IAM,
artifact access, network/storage dependencies, capacity and disruption limits.
Distinguish managed control-plane health from workload/data-plane responsibility.
Treat cluster upgrades separately from application rollback; discover supported
recovery options for the actual service/version instead of promising downgrade.

- [EKS reliability](https://docs.aws.amazon.com/eks/latest/best-practices/reliability.html)
- [EKS best-practice guide](https://docs.aws.amazon.com/eks/latest/best-practices/)

## Non-Kubernetes services and supply chain

Use existing VM, serverless, PaaS or container-service release mechanisms;
preserve immutable version identity, staged exposure where supported and tested
recovery. Select IaC tooling already in the project. Review plans and state
locking before mutations; coordinate multi-service dependencies and data changes.

Verify artifact identity and provenance according to project policy. A signature
alone is not a vulnerability assessment. [SLSA](https://slsa.dev/spec/v1.2/)
defines supply-chain assurance; do not assert an assurance level without evidence.

Sources researched 2026-11-06. Recheck capabilities at execution time; these
references do not pin provider or CLI versions for consuming projects.
