<!--
Tech-lead: paste this fenced ```json delivery-plan block into your decomposition
document, next to the task templates from § 3 "Create Technical Tasks". Fill in:

  - campaign_id / run_id       — lowercase, ^[a-z0-9][a-z0-9-]*$; the registered run id is
                                  "<campaign_id>/<run_id>" (e.g. "sec/run-1") — that's what
                                  every --plan flag takes from here on.
  - factory                    — feature-development | test-automation | manual-qa
  - observation_start          — the first instant evidence for this run should be trusted
  - source_epoch.integration_ref — the branch `backfill --git` is allowed to read
  - campaign.ref / missions[].ref / tasks[].ref — must stay unique within this plan
  - tasks[].type / novel / area — classify every task: type feature|bugfix|refactor|test|
                                  infra|docs; novel true when the team has not worked in
                                  that area before; area = module/directory (optional).
                                  role + type + novel pick the calibration cell the estimate
                                  comes from; area is recorded, not yet used for cells.
  - task "estimate"            — LEAVE IT OUT. plan register fills the calibrated USD range
                                  and effort class from measured history. Check CALIBRATED:
                                  every task needs a cell of 5+ samples (no-cell=0).
                                  If calibration is missing or has no matching cell, report
                                  the gap; do not insert an hours estimate, which prevents
                                  the calibrated fill. Keep human effort in the board's
                                  tokenomics.effort_days, outside this block.
  - mission / campaign "estimate" — hours ranges you propose, as above. Developers never estimate.
  - tasks[].story/class/role/branch — mirror the task template's Story/Complexity/
                                  Assigned-to/branch fields; role must be an installed
                                  agent name (see references/factory-roles.json)

Register it with:
  node .claude/skills/delivery-monitor/scripts/delivery.mjs plan register \
    --from <this decomposition file> --id <plan-slug>-v1

This example has two missions (G1, G2) and three tasks (TASK-001, TASK-002 in G1;
TASK-003 in G2) — trim or extend the missions[]/tasks[] arrays to match your own plan.
-->

```json delivery-plan
{
  "campaign_id": "<campaign-id>",
  "run_id": "run-1",
  "version": 1,
  "factory": "feature-development",
  "observation_start": "2026-01-01T00:00:00Z",
  "source_epoch": {"from": "2026-01-01T00:00:00Z", "until": null, "integration_ref": "main"},
  "campaign": {
    "ref": "<campaign-id>",
    "estimate": {"unit": "h", "low": 20, "high": 40, "tier": "ROM", "proposed_by": "tech-lead", "proposed_at": "2026-01-01T00:00:00Z", "accepted_by": null, "accepted_at": null}
  },
  "mission_kind": "group",
  "missions": [
    {
      "ref": "G1",
      "sequence": 1,
      "estimate": {"unit": "h", "low": 8, "high": 14, "tier": "budgetary", "proposed_by": "tech-lead", "proposed_at": "2026-01-01T00:00:00Z", "accepted_by": null, "accepted_at": null},
      "tasks": [
        {
          "ref": "TASK-001",
          "story": "US-001",
          "class": "S",
          "role": "js-dev",
          "type": "feature",
          "novel": false,
          "branch": "task/task-001"
        },
        {
          "ref": "TASK-002",
          "story": "US-001",
          "class": "M",
          "role": "python-dev",
          "type": "bugfix",
          "novel": false,
          "branch": "task/task-002"
        }
      ]
    },
    {
      "ref": "G2",
      "sequence": 2,
      "estimate": {"unit": "h", "low": 4, "high": 8, "tier": "budgetary", "proposed_by": "tech-lead", "proposed_at": "2026-01-01T00:00:00Z", "accepted_by": null, "accepted_at": null},
      "tasks": [
        {
          "ref": "TASK-003",
          "story": "US-002",
          "class": "M",
          "role": "qa-engineer",
          "branch": "task/task-003"
        }
      ]
    }
  ]
}
```
