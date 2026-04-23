# Xray Server / Data Center — REST API

Xray Server / DC exposes its API under the Jira instance — no
separate service. Base:

```
https://<your-jira>/rest/raven/2.0/   (v2 — preferred)
https://<your-jira>/rest/raven/1.0/   (v1 — legacy endpoints)
```

## 1. Authentication

Two options, same as Jira Server / DC itself:

- **Personal Access Token (PAT)** — bearer token, preferred:
  ```
  Authorization: Bearer <PAT>
  ```
- **Basic auth** — username + password / API token:
  ```
  Authorization: Basic <base64(user:pass)>
  ```

Store in env (`JIRA_TOKEN` or `JIRA_USER` + `JIRA_TOKEN`).

Xray Server uses Jira's permission model — the token needs the
"Browse Projects" + Xray-app permissions on the target project.

## 2. Endpoint map (v2 unless noted)

### Test

```
GET  /rest/raven/2.0/api/test/<key>                → Test details
GET  /rest/raven/2.0/api/test/<key>/step           → Steps (Manual)
POST /rest/raven/2.0/api/test/<key>/step           → Add a step
PUT  /rest/raven/2.0/api/test/<key>/step/<id>      → Update step
DELETE /rest/raven/2.0/api/test/<key>/step/<id>    → Delete step
GET  /rest/raven/2.0/api/test/<key>/preconditions  → Linked preconditions
GET  /rest/raven/2.0/api/test/<key>/testsets       → Test Sets containing this Test
GET  /rest/raven/2.0/api/test/<key>/testplans      → Test Plans containing this Test
GET  /rest/raven/2.0/api/test/<key>/testexecutions → Test Executions containing this Test
```

Creating a Test is a two-step operation:

```
1. POST /rest/api/2/issue                          (standard Jira — creates the Test issue)
   body: { fields: { project, summary, issuetype: { name: "Test" },
                     "customfield_<TestType>": { "value": "Manual" } } }
2. POST /rest/raven/2.0/api/test/<new-key>/step    (for each step)
   body: { step: "<action>", data: "<data>", result: "<expected>" }
```

The Test Type custom-field ID (`customfield_XXXXX`) is
project-dependent — fetch it once:

```
GET /rest/api/2/field
→ find { "name": "Test Type", "id": "customfield_10200", ... }
```

Cache the field ID per session.

### Precondition

```
GET  /rest/raven/2.0/api/precondition/<key>
GET  /rest/raven/2.0/api/precondition/<key>/test   → Tests using this Precondition
POST /rest/raven/2.0/api/test/<testKey>/preconditions
     body: { "add": ["<preKey1>", "<preKey2>"] }
```

Create: same two-step pattern (Jira issue with `issuetype=Precondition` +
type/body populated via Xray endpoints).

### Test Set

```
GET  /rest/raven/2.0/api/testset/<key>
GET  /rest/raven/2.0/api/testset/<key>/test        → Tests in the Test Set
POST /rest/raven/2.0/api/testset/<key>/test
     body: { "add": ["PROJ-T42", "PROJ-T43"] }
POST /rest/raven/2.0/api/testset/<key>/test
     body: { "remove": ["PROJ-T42"] }
```

Create the Test Set as a Jira issue (`issuetype=Test Set`), then
add Tests with the endpoint above.

### Test Plan

```
GET  /rest/raven/2.0/api/testplan/<key>
GET  /rest/raven/2.0/api/testplan/<key>/test
POST /rest/raven/2.0/api/testplan/<key>/test
     body: { "add": ["PROJ-T42"] }
```

### Test Execution

```
GET  /rest/raven/2.0/api/testexec/<key>
GET  /rest/raven/2.0/api/testexec/<key>/test       → List of Test Runs in this Execution
POST /rest/raven/2.0/api/testexec/<key>/test
     body: { "add": ["PROJ-T42"] }                 → Add tests to execute
```

Response from `/testexec/<key>/test` returns per-row:

```json
[
  { "id":        123,
    "status":    "TODO",
    "testKey":   "PROJ-T42",
    "rank":      1,
    "testRunId": "abcd-1234..." }
]
```

Note two IDs: the numeric `id` and the opaque `testRunId`. The
Test Run endpoints use one or the other depending on version —
check both in your responses.

### Test Run

```
GET  /rest/raven/2.0/api/testrun/<id>              → Full Test Run
PUT  /rest/raven/2.0/api/testrun/<id>              → Update status / comment / defects
     body: {
       "status":   "PASSED",
       "comment":  "Verified on 2026-04-22 staging",
       "defects":  ["PROJ-123"],
       "executedBy": "<username>"
     }
POST /rest/raven/2.0/api/testrun/<id>/attachment   → Attach evidence (multipart)
```

Evidence upload is multipart:

```
POST /rest/raven/2.0/api/testrun/<id>/attachment
Content-Type: multipart/form-data
  field 'file' → the binary
```

### Steps of a Test Run (Manual steps)

```
GET  /rest/raven/2.0/api/testrun/<id>/step
PUT  /rest/raven/2.0/api/testrun/<id>/step/<stepId>
     body: { "status": "PASSED", "comment": "…",
             "actualResult": "…", "defects": [...] }
```

### Statuses

```
GET /rest/raven/2.0/api/settings/teststatuses
→ [ { "id": 1, "name": "TODO", "final": false, ... },
    { "id": 2, "name": "EXECUTING", ... },
    { "id": 3, "name": "PASSED", "final": true, ... },
    { "id": 4, "name": "FAILED", "final": true, ... },
    { "id": 5, "name": "ABORTED", ... },
    { "id": 6, "name": "BLOCKED", ... } ]
```

Like Cloud, these are project-configurable. Always fetch before
posting status values.

## 3. Results import (brief — full details in results-import.md)

The import endpoints accept multipart bodies or raw JSON depending
on the format:

```
POST /rest/raven/2.0/import/execution/junit                (multipart)
POST /rest/raven/2.0/import/execution/junit/multipart      (multi-file)
POST /rest/raven/2.0/import/execution/testng               (multipart)
POST /rest/raven/2.0/import/execution/cucumber             (JSON body)
POST /rest/raven/2.0/import/execution                      (Xray JSON body)
POST /rest/raven/2.0/import/execution/robot                (if Robot plugin present)
```

Common query params:

- `projectKey=PROJ` — where to create the Test Execution
- `testExecKey=PROJ-TE7` — append results to an existing Execution
- `testPlanKey=PROJ-P7` — tie the Execution to a Test Plan
- `fixVersion=1.4.0`, `revision=abc123`, `testEnvironments=staging`

## 4. Worked example — end-to-end

**Goal:** "Create a Manual Test for PROJ, add it to Test Set
PROJ-TS10, create a Test Execution, and mark it PASSED."

```
# 1. Resolve Test Type custom-field ID
GET /rest/api/2/field | jq '.[] | select(.name == "Test Type")'
→ customfield_10200

# 2. Create the Test issue
POST /rest/api/2/issue
{
  "fields": {
    "project":     { "key": "PROJ" },
    "summary":     "Login with plus-sign email",
    "issuetype":   { "name": "Test" },
    "customfield_10200": { "value": "Manual" }
  }
}
→ { "key": "PROJ-T42", ... }

# 3. Add steps
POST /rest/raven/2.0/api/test/PROJ-T42/step
{ "step": "Open login page", "data": "", "result": "Form visible" }
POST /rest/raven/2.0/api/test/PROJ-T42/step
{ "step": "Submit user+tag@x.com", "data": "", "result": "Dashboard" }

# 4. Add to Test Set
POST /rest/raven/2.0/api/testset/PROJ-TS10/test
{ "add": ["PROJ-T42"] }

# 5. Create the Test Execution (Jira issue)
POST /rest/api/2/issue
{ "fields": { "project": { "key": "PROJ" },
              "summary": "Smoke 2026-04-22",
              "issuetype": { "name": "Test Execution" } } }
→ { "key": "PROJ-TE7", ... }

# 6. Add the Test to the Execution
POST /rest/raven/2.0/api/testexec/PROJ-TE7/test
{ "add": ["PROJ-T42"] }

# 7. Fetch the Test Run id
GET /rest/raven/2.0/api/testexec/PROJ-TE7/test
→ [ { "id": 123, "status": "TODO", "testKey": "PROJ-T42", ... } ]

# 8. Mark PASSED
PUT /rest/raven/2.0/api/testrun/123
{ "status": "PASSED",
  "comment": "Verified 2026-04-22 / staging" }

# 9. Re-fetch to confirm
GET /rest/raven/2.0/api/testrun/123
→ status: PASSED ✓
```

## 5. Error responses

- **401 / 403** → token missing / lacks Xray permissions on the
  project.
- **400 with "Cannot find Test"** → wrong project key or the issue
  isn't a Test (created with the wrong issue type or missing Test
  Type custom field).
- **"Invalid status"** → status value not in this project's
  `/settings/teststatuses` set.
- **Empty response on 200 after a successful attach** — some Jira
  reverse proxies buffer 1xx/2xx responses with body; follow with
  a GET to confirm.

## 6. Cloud ↔ Server parity notes

The entity model is identical; only the call shape differs.
Translation table for the most common operations:

| Operation | Cloud (GraphQL) | Server (REST) |
|---|---|---|
| Get Test | `getTest(issueId)` | `GET /api/test/<key>` |
| Create Manual Test | `createTest` mutation | `POST /rest/api/2/issue` + `/api/test/<key>/step` |
| Add Test → Test Set | `addTestsToTestSet` | `POST /api/testset/<key>/test { add: […] }` |
| Create Test Execution | `createTestExecution` | `POST /rest/api/2/issue` + `/api/testexec/<key>/test` |
| Mark Test Run | `updateTestRunStatus(id, status)` | `PUT /api/testrun/<id> { status }` |
| Import JUnit | `POST /import/execution/junit` | `POST /import/execution/junit` |

Keep your code behind a thin adapter — switching between Cloud
and Server is plausible mid-project, and the call shapes are the
only thing that changes.
