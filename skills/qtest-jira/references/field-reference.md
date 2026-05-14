# EPAM TM Plugin — Field Reference

Deployment: **Jira Server / Data Center** (REST API v2,
Bearer-token auth).

All field types verified against live TM-plugin installations.
**Custom-field numeric IDs (`customfield_NNNNN`) shown here are
the common defaults** — in practice the numbers depend on the
order plugins were installed in your Jira. Before relying on
the table below, run the first-contact discovery step from
SKILL.md § 0 ("First contact with a new instance") to capture
the IDs your instance actually uses, then cache them per
project. The JQL aliases (`"test run id"`, `Folder`,
`"Test Status"`, `"Test Type"`) are stable across installations
and remain safe regardless of the numeric IDs.

---

## TM Plugin core fields

| Field ID | JQL short | Name | API type | Read as |
|---|---|---|---|---|
| `customfield_23100` | `cf[23100]` | Test run id | string | `.customfield_23100` |
| `customfield_23101` | `cf[23101]` | Folder id | string | `.customfield_23101` |
| `customfield_24000` | `cf[24000]` | Test run (name) | string | `.customfield_24000` |
| `customfield_24001` | `cf[24001]` | Folder path | string | `.customfield_24001` |
| `customfield_31500` | `cf[31500]` | Test Type | **object** | `.customfield_31500.value` |
| `customfield_31501` | `cf[31501]` | Test Status | **string** | `.customfield_31501` |
| `customfield_23102` | `cf[23102]` | Origin Test Case | string | `.customfield_23102` |
| `customfield_29300` | `cf[29300]` | Test requirement | TM: requirement | linked keys |

## Test content fields

| Field ID | Name | Notes |
|---|---|---|
| `customfield_19206` | Test steps / Preconditions | Free text, multi-step |
| `customfield_19207` | Expected result | Free text, per-step |
| `customfield_15816` | Test Case Estimate | Original estimate |

## Metadata fields

| Field ID | Name |
|---|---|
| `customfield_33334` | Participants (multi-user) |
| `customfield_31100` | Last Comment (scripted) |
| `customfield_34834` | User Story |
| `customfield_33100` | Exposure |

---

## Test Status values (`cf[31501]`)

Plain string — compare with `=` in JQL and read directly:

| Value | Meaning |
|---|---|
| `Passed` | Executed and passed |
| `Failed` | Executed and failed |
| `In Progress` | Started, not complete |
| `Not Run` | Not yet executed |
| `Untested` | Awaiting execution (also seen as default) |
| `Out of Scope` | Excluded from this run |
| `Blocked` | Cannot run — dependency |
| `Skipped` | Intentionally skipped |

> ⚠️ This is **separate from the Jira workflow `status`** field.
> A test issue can be `Open` (Jira workflow) and `Passed` (TM
> Status) simultaneously. Always state which one you mean.

## Test Type values (`cf[31500]`)

Object `{ self, value, id, disabled }` — use `.value`:

| value | typical id |
|---|---|
| `Manual` | `40600` |
| `Automated` | (varies — check your instance) |

The numeric `id` differs between installations; filter on
`.value` (the human-readable label) in code, and use the label
in JQL (`"Test Type" = "Automated"`).

---

## Folder mechanics

- `cf[23101]` = **leaf folder ID only** (direct parent of the
  test, no ancestor chain). To query a subtree, you must
  enumerate every descendant folder first and `OR` them in JQL.
- `cf[24001]` = **full slash-delimited path** as a string
  (`"Smoke/Regression"`, `"E2E/Checkout/Happy Path"`).
- When `cf[23101] == cf[23100]`: the test is at **root level**;
  `cf[24001]` value equals the project key (e.g. `"<PROJECT>"`).
- Intermediate folders that contain no direct tests **don't
  surface their own `cf[23101]` value** — only folders that
  hold at least one test do. To get the full hierarchy
  (including empty folders), use the TM Plugin folder list API
  (`GET /rest/tm/1.0/folder/list`) instead of sweeping JQL.
- Folder names may contain spaces, brackets, hyphens, and
  slashes — **always quote in JQL**.

---

## Discovering the actual custom-field IDs in your instance

Use the first-contact recipe in SKILL.md § 0
("First contact with a new instance"). The short version:

```
GET /rest/api/2/field
```

Returns an array of every field. Filter by the TM-plugin
stable names — `"Test run id"`, `"Folder"`, `"Test Status"`,
`"Test Type"` — and read the `id` of each match. Cache the
resulting mapping per project (see SKILL.md § 0 for the YAML
shape) so subsequent sessions skip the discovery roundtrip.
