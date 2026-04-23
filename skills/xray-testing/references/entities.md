# Xray entity model — field reference

All six entities are **Jira issues** (except Test Run). They share
standard Jira fields (project, summary, description, assignee,
priority, labels, components, fixVersions) plus Xray-specific
fields.

This reference is the "what fields matter, what values are
allowed, what you can and can't change" view. Call-shape details
are in `cloud-graphql.md` / `server-rest.md`.

## Test — the test case

### Test Type

A Test has **exactly one** Test Type, set at creation and rarely
changed:

| Test Type | Content shape | Used for |
|---|---|---|
| **Manual** | Ordered list of steps (`action` / `data` / `result`) | Human / step-by-step execution — the most common shape |
| **Cucumber** | A single Gherkin scenario body | BDD-style tests, directly runnable by Cucumber / SpecFlow |
| **Generic** | Free-text `definition` field | Any other kind — programmatic tests, checklists, exploratory templates |

Additional custom Test Types (e.g. "Automated", "Exploratory") can
be defined per project — query `/rest/api/2/field` (Server) or
`getTestTypes` (Cloud GraphQL) to see what's configured.

### Steps (Manual Test)

Each step has:

| Field | Required | Notes |
|---|---|---|
| `id` | auto | Opaque string — never reassign |
| `action` | yes | What the tester does ("Click Submit") |
| `data` | no | Input data ("user+tag@x.com / s3cret") |
| `result` | yes | Expected outcome ("Dashboard loads") |
| `attachments` | no | Step-level evidence (screenshots, CSVs) |
| `customFields` | no | Project-configured fields per step |

Steps are **ordered** — the order in the array is the execution
order. Rearrange via dedicated reorder mutations / endpoints, not
by swapping array positions wholesale (preserves history).

### Scenario (Cucumber Test)

A single Gherkin block:

```gherkin
Scenario: Plus-sign email login
  Given I am on the login page
  When I submit user+tag@example.com / s3cret
  Then I see the dashboard within 2 seconds
```

Variants:
- **Scenario** (default) — one concrete path
- **Scenario Outline** — parameterized; includes an `Examples:` table
- **Background** — applied via Preconditions (see below)

Xray stores the Cucumber body in a `gherkin` field (Cloud) or the
`Cucumber Test Content` custom field (Server).

### Definition (Generic Test)

Free text / code / pseudo-code. Stored in `unstructured` (Cloud) /
`Generic Test Definition` custom field (Server). No enforced shape.

### Links

A Test links to:

- **Preconditions** — shared setup, many-to-many
- **Test Sets** — grouping, many-to-many
- **Test Plans** — planning containers, many-to-many
- **Requirement** — Stories / Bugs / Epics covered by the Test
  (Xray's coverage link, NOT the standard Jira "links" field)
- **Test Executions** — automatic, as the Test gets run

## Precondition — shared setup steps

A Precondition is a Jira issue of type `Precondition` holding
setup steps that multiple Tests share ("A logged-in admin user
exists with `seed_admin` fixture"). It is **not** a Test —
it's not executed on its own, it doesn't appear in Test
Executions as a separate row. It contributes steps to each Test
that references it.

Type variants parallel Manual / Cucumber / Generic Tests —
usually **Manual** with a step list, occasionally **Cucumber**
(for a `Background:` block).

Link from a Test → Precondition via the Test's
`preconditions` field. Link is many-to-many.

## Test Set — pure organizational grouping

A Jira issue of type `Test Set` that holds a list of Tests.
Analogous to a tag or folder. No execution semantics — a Test Set
does not track latest status or roll up results.

Use for:
- Smoke / regression / onboarding suites
- Feature-scoped groupings ("checkout flow", "admin panel")
- Temporary investigation buckets

A Test can belong to any number of Test Sets.

## Test Plan — planning container with rolled-up status

A Jira issue of type `Test Plan` that holds a list of Tests **and
rolls up their latest run status** across all Test Executions
linked to the Plan.

Typical usage: one Test Plan per release or sprint
("Release 2.7 QA sign-off"). The plan shows, for each Test, the
latest PASSED / FAILED / etc. across every Test Execution
associated with it.

Key differences vs Test Set:

| Trait | Test Set | Test Plan |
|---|---|---|
| Purpose | Grouping | Execution rollup |
| Status aggregation | No | Yes |
| Test Executions link here | No | Yes |
| Typical lifetime | Persistent | Per release / sprint |

A Test Execution can be linked to a Test Plan at creation or
later; all its Test Runs then contribute to the Plan's rollup.

## Test Execution — one run event

A Jira issue of type `Test Execution` representing a specific
run: "Regression run 2026-04-22 / staging" or "Nightly CI 1087".

Contains a **Test Run per Test** in its scope. Test Runs are
**not** separate Jira issues — they live inside the Test
Execution.

Common fields:

| Field | Notes |
|---|---|
| `summary` | Name of the run |
| `testEnvironments` | e.g. `["staging"]` — used for filtering and rollups |
| `fixVersion`, `revision` | Optional — release / commit identifiers |
| `testPlan` | Optional — linked Test Plan for rollup |
| `testRuns` | Auto-populated as Tests are added |

## Test Run — status + evidence for one Test inside one Execution

The running record. **Not a Jira issue.** Identified by a run ID
(opaque) or numeric id (Server REST).

Fields:

| Field | Notes |
|---|---|
| `id` | Opaque / numeric identifier |
| `test` | Reference to the Test issue |
| `status` | PASSED / FAILED / EXECUTING / TODO / ABORTED / BLOCKED (project-configurable) |
| `startedOn`, `finishedOn` | Timestamps |
| `executedBy` | accountId (Cloud) / username (Server) |
| `comment` | Free text — rationale, link to CI build, etc. |
| `defects` | Linked Bug issues |
| `evidence` | Attached files (screenshots, logs) |
| `steps` | Per-step result list for Manual Tests |

A Test Run is created automatically when a Test is added to a
Test Execution, and updated repeatedly — not deleted. Re-running
the Test against the same Execution updates the same Run; a new
Execution creates a new Run.

## Coverage model

Xray's "coverage" answers: *which requirements have tests, and
what's their latest status?*

Coverage is **derived**, not stored:

1. A Test is linked to a requirement (Story / Bug / Epic / custom)
   via Xray's requirement link.
2. Each Test Run on that Test contributes a latest status.
3. Reports aggregate latest status per requirement.

Implications:

- Linking a Test via the **standard Jira `links` field** does NOT
  count as coverage — it's a free-text relation. Use Xray's
  `addTestsToRequirement` (Cloud) / `/api/test/<key>/requirement`
  (Server) instead.
- "No test coverage" = the requirement has no Test links.
- "Tests passing coverage" = all linked Tests have a final-status
  Test Run of PASSED within the configured scope (Test Plan / Test
  Environment / Version).

## Status catalogue

Xray ships six default statuses; projects can extend or replace:

| Status | `final` | Typical meaning |
|---|---|---|
| `TODO` | no | Scheduled but not yet run |
| `EXECUTING` | no | Currently running |
| `PASSED` | yes | Ran and met expectations |
| `FAILED` | yes | Ran and missed expectations |
| `ABORTED` | yes | Run was interrupted |
| `BLOCKED` | no | Can't run (env / data / dependency) |

Don't hard-code. Always query:

```
# Server
GET /rest/raven/2.0/api/settings/teststatuses

# Cloud
query { getStatuses { name final color description } }
```

## Common field-shape confusions

- **Test Type vs `issuetype`** — the Jira issue type is
  `"Test"` (or `"Precondition"` etc.); the `Test Type` is the
  Xray custom field that distinguishes Manual / Cucumber /
  Generic. Both must be set at creation or Xray can't render the
  Test.
- **Test Run vs Test Execution** — the Test Run is a ROW inside a
  Test Execution. Editing statuses and evidence targets the Test
  Run, not the Execution.
- **Precondition vs Test** — a Precondition looks like a Test
  (same step shape) but is never executed standalone. Don't use a
  Precondition as a test.
- **Test Set vs Test Plan** — Test Sets group, Test Plans plan +
  roll up. Pick Plan when you care about "what's the status of X
  across runs", Set when you just want a named list.
- **Coverage via Jira `links` field** — does not count. Use Xray's
  requirement-coverage endpoint.
- **Changing Test Type post-creation** — possible but lossy
  (Manual → Cucumber drops steps; Cucumber → Manual drops the
  gherkin). Avoid; create a new Test instead when the kind
  changes.
