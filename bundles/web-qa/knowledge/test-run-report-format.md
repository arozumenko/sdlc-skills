# Test Run Report Format Specification

## File Location & Naming

```
reports/
  RUN-YYYY-MM-DD-NNN.md     ← main report
  screenshots/
    TC-001_YYYY-MM-DD.png
    TC-002_YYYY-MM-DD.png
    ...
```

Run ID format: `RUN-2026-05-18-001`. Sequence number resets per day.

---

## Full Report Template

```markdown
---
run_id: RUN-2026-05-18-001
suite: smoke-tests
environment: https://app.example.com
date: 2026-05-18
---

# Test Run Report: Smoke Tests — 2026-05-18

**Environment:** https://app.example.com  
**Duration:** 2m 43s  
**Executed by:** QA Agent (claude-sonnet-4-6)

## Summary

| Metric       | Count | %      |
|--------------|-------|--------|
| Total        | 10    | 100%   |
| ✅ Passed    | 8     | 80.0%  |
| ❌ Failed    | 2     | 20.0%  |
| ⏸ Blocked   | 0     | 0.0%   |

## Results

| ID      | Title                              | Status   | Steps | Duration |
|---------|------------------------------------|----------|-------|----------|
| TC-001  | Login with valid credentials       | ✅ PASS  | 5/5   | 14s      |
| TC-002  | Login with invalid password        | ❌ FAIL  | 3/5   | 8s       |
| TC-003  | Forgot password — email flow       | ✅ PASS  | 7/7   | 21s      |
| TC-004  | Session expires after 30min idle   | ⏸ BLOCKED | 0/4 | —       |

## Failed Tests

### ❌ TC-002: Login with invalid password
- **Steps completed:** 3 of 5  
- **Failed at step:** 4  
- **Failure reason:** Expected `.error-alert` element not found after 5s; page remained on `/login` without any visible error
- **Screenshot:** `reports/screenshots/TC-002_2026-05-18.png`

## Blocked Tests

### ⏸ TC-004: Session expires after 30min idle
- **Reason:** Test environment session timeout is configured to 5 minutes — precondition could not be met

## Defects Found

- [ ] **TC-002-DEF** — Error message not shown on invalid login attempt — `High`

## Notes

> Executed autonomously by QA Agent. Review screenshots for any false positives.  
> All screenshots saved to `reports/screenshots/`.
```

---

## Section Reference

| Section | Required | Description |
|---------|----------|-------------|
| YAML frontmatter | Yes | Machine-readable metadata for future indexing |
| Summary table | Yes | Aggregate metrics — the first thing a stakeholder reads |
| Results table | Yes | One row per test case, sorted by TC ID |
| Failed Tests | If failures exist | Detailed breakdown per failure with screenshot path |
| Blocked Tests | If blocked exist | Short explanation per blocked test |
| Defects Found | If failures exist | Checklist-style; one item per unique failure to investigate |
| Notes | Yes | Brief caveat about autonomous execution |

---

## Status Definitions

| Status | Icon | Meaning |
|--------|------|---------|
| `PASS` | ✅ | All steps executed, all expected results verified |
| `FAIL` | ❌ | At least one step produced unexpected result |
| `BLOCKED` | ⏸ | Could not execute — precondition unmet or executor crashed |

---

## Defect Severity Assignment

When a test fails, the reporter assigns severity based on test case priority:

| Test priority | Defect severity |
|---------------|----------------|
| `critical` | High |
| `high` | High |
| `medium` | Medium |
| `low` | Low |

---

## Executor Result JSON Schema

Each executor agent outputs one JSON block. The reporter consumes an array of these.

```json
{
  "tc_id": "TC-001",
  "title": "Login with valid credentials",
  "result": "PASS",
  "steps_total": 5,
  "steps_completed": 5,
  "failure_step": null,
  "failure_reason": null,
  "screenshot": "reports/screenshots/TC-001_2026-05-18.png",
  "duration_seconds": 14,
  "notes": ""
}
```
