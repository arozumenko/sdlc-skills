# Release <release-id>

Use the project's equivalent record if one exists. Replace placeholders with
observed facts or explicit unknowns; retain approval and execution history.

## Identity and ownership

- Service; source commit; immutable artifact digest/version:
- Configuration/chart/IaC revision; dependency versions:
- Environment; account/subscription/project; region; cluster/namespace/runtime:
- Release owner; execution authority; monitoring and continuation owners:
- Pipeline/controller; run ID; concurrency mechanism and lock owner:
- Status: planned / ready / ready with accepted exceptions / blocked /
  inconclusive / rolling out / paused / deployed; verification pending /
  verified healthy / recovering / recovered / recovery failed / recovery; verification pending /
  closed with accepted risk

## Plan and readiness

- Scope; dependency/migration sequence; blast radius:
- Strategy and rationale; environment differences:
- Artifact provenance/signature/security policy evidence:
- QA/CI/staging evidence tied to candidate and environment:

| Gate | Artifact/target | Evidence and timestamp | Required threshold/window/samples | Actual result | Status (passed/failed/inconclusive/waived/N/A with reason) |
|---|---|---|---|---|---|

## Promotion and observation

| Stage/exposure | Duration and minimum samples | Metric/smoke query and baseline | Pass/abort thresholds | Authority/exception | Actual result and time |
|---|---|---|---|---|---|

- Final observation deadline; remaining checks; next observation time:
- Telemetry freshness requirements and missing-data behavior:
- Alert/runbook links and operational owner:

## Recovery

- Known-good artifact/config and availability evidence:
- Application/schema/infrastructure compatibility evidence:
- Backup/restore rehearsal evidence where required:
- Recovery route and exact pipeline/runbook actions:
- Expected recovery duration and potential data loss:
- Preauthorized triggers/actions; separate authority for destructive recovery:
- Recovery verification queries, flows and observation window:

## Approvals and exceptions (append; preserve history)

- Named human approver; identity source (host-provided or self-declared in chat):
- Timestamp/chat message reference:
- Exact written approval or policy reference:
- Release/artifact/configuration/environment covered:
- Failed/missing gate(s) and disclosed risks:
- Authorized actions; stage/time limits; revoked/superseded decisions:
- Gate status remains waived; evidence still outstanding:
- Persistence pending, if captured in chat before durable storage is available:

## Execution and handoff

| Time | Run/step | Observed state/result | Action | Authority | Evidence |
|---|---|---|---|---|---|

- Resume checkpoint: actual deployed state, migration ledger, active run/lock:
- Completed versus pending actions; supported resume/retry procedure:
- User impact and final health/recovery evidence:
- Residual risks; explicit accepted-risk closure if applicable:
- Follow-up owners; continuation owner and next check time:

Store this record in version control through the project's normal workflow.
Keep secrets and production personal data out; link to access-controlled evidence.
