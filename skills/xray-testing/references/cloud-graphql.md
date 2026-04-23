# Xray Cloud — GraphQL API v2

Xray Cloud exposes its primary API at
**`https://xray.cloud.getxray.app/api/v2/graphql`**. A small set
of REST endpoints exist for auth and results import; everything
else is GraphQL.

## 1. Authentication

Xray Cloud uses a short-lived **JWT** obtained from client
credentials.

```
POST https://xray.cloud.getxray.app/api/v2/authenticate
Content-Type: application/json

{
  "client_id":     "<XRAY_CLIENT_ID>",
  "client_secret": "<XRAY_CLIENT_SECRET>"
}
```

The response body **is** the JWT string (plain text in quotes).
Use it as a bearer token:

```
Authorization: Bearer <JWT>
```

Tokens are valid for ~24h. Cache per session; re-auth on 401.

Client credentials come from Jira → Apps → Xray → API Keys.
Store in env (`XRAY_CLIENT_ID`, `XRAY_CLIENT_SECRET`) — never in
the repo.

## 2. Everything uses `issueId`, not `issueKey` — usually

Xray's GraphQL schema keys entities by **internal Jira issueId**
(numeric string). You'll usually have a Jira key (`PROJ-T42`);
resolve to issueId via the Jira REST API:

```
GET /rest/api/3/issue/PROJ-T42?fields=summary
→ { "id": "123456", "key": "PROJ-T42", ... }
```

Cache `key → issueId` per session.

Many queries accept a `jql` string as an alternative to
`issueIds`; for ad-hoc filters, JQL is often simpler:

```graphql
query { getTests(jql: "project = PROJ AND issuetype = Test AND labels = smoke",
                limit: 100) {
  total results { issueId jira(fields: ["key","summary"]) } } }
```

## 3. Core queries

### Get a single Test (with steps)

```graphql
query GetTest($issueId: String!) {
  getTest(issueId: $issueId) {
    issueId
    projectId
    testType { name kind }
    jira(fields: ["key", "summary", "status"])
    steps {
      id
      action
      data
      result
      attachments { id filename }
    }
    preconditions(limit: 50) {
      total
      results { issueId jira(fields: ["key", "summary"]) }
    }
  }
}
```

`testType.kind` is `"Manual"` / `"Cucumber"` / `"Generic"`.

- Manual → `steps` list is authoritative.
- Cucumber → `gherkin` field holds the scenario body (query it
  separately: `... on Test { gherkin }` — depending on schema
  version).
- Generic → `unstructured` field holds the free-text definition.

### Get a Test Execution with its Test Runs

```graphql
query GetTestExecution($issueId: String!) {
  getTestExecution(issueId: $issueId) {
    issueId
    jira(fields: ["key", "summary"])
    testRuns(limit: 100) {
      total
      results {
        id
        status { name color }
        test { issueId jira(fields: ["key"]) }
        startedOn
        finishedOn
        executedBy
        comment
        defects { issueId jira(fields: ["key"]) }
      }
    }
  }
}
```

The `results[].id` is the **Test Run ID** — the handle you use
to update status, attach evidence, or comment.

### Get allowed statuses

```graphql
query { getStatuses { name description color final } }
```

Always query this before posting a Test Run status — the
default set (`PASSED`, `FAILED`, `EXECUTING`, `TODO`,
`ABORTED`, `BLOCKED`) may be extended or replaced per project.

### Get coverage for a requirement

```graphql
query GetCoverage($issueId: String!) {
  getCoverableIssue(issueId: $issueId) {
    issueId
    jira(fields: ["key", "summary"])
    status { name color }
    tests(limit: 100) {
      total
      results { issueId jira(fields: ["key", "summary"]) }
    }
  }
}
```

### Paginate

`limit` is capped at 100 per query. For longer lists, use `start`
+ `limit`:

```graphql
query { getTests(jql: "...", limit: 100, start: 0) { total results { issueId } } }
```

Iterate `start` in steps of 100 while `start < total`.

## 4. Core mutations

### Create a Manual Test

```graphql
mutation CreateTest(
  $projectKey: String!,
  $summary: String!,
  $steps: [CreateStepInput],
  $assigneeAccountId: String
) {
  createTest(
    testType: { name: "Manual" },
    steps: $steps,
    jira: {
      fields: {
        project:  { key: $projectKey },
        summary:  $summary,
        assignee: { accountId: $assigneeAccountId }
      }
    }
  ) {
    test { issueId jira(fields: ["key"]) }
    warnings
  }
}
```

Variables:

```json
{
  "projectKey": "PROJ",
  "summary": "User can log in with a plus-sign email",
  "assigneeAccountId": "61e1a042e67ea2006b5b2157",
  "steps": [
    { "action": "Open the login page", "data": "", "result": "Form is visible" },
    { "action": "Enter email 'user+tag@example.com' and password",
      "data": "", "result": "Fields accept input" },
    { "action": "Click Log in", "data": "",
      "result": "Dashboard renders within 2s" }
  ]
}
```

`warnings` in the response is non-fatal but worth surfacing.

### Create a Cucumber Test

```graphql
mutation {
  createTest(
    testType: { name: "Cucumber" },
    gherkin: "Scenario: Plus-sign email login\n  Given ...\n",
    jira: { fields: { project: { key: "PROJ" }, summary: "..." } }
  ) { test { issueId } }
}
```

### Update Test steps (in place)

```graphql
mutation UpdateTestStep(
  $issueId: String!,
  $stepId: String!,
  $step: UpdateStepInput!
) {
  updateTestStep(issueId: $issueId, stepId: $stepId, step: $step) {
    warnings
  }
}
```

For reordering / adding / removing: `addTestStep`, `removeTestStep`.
Fetch current step IDs first — do not reassign them.

### Add Tests to a Test Set / Test Plan

```graphql
mutation {
  addTestsToTestSet(
    issueId: "<TS issueId>",
    testIssueIds: ["<T1 issueId>", "<T2 issueId>"]
  ) { addedTests warning }
}

mutation {
  addTestsToTestPlan(
    issueId: "<TP issueId>",
    testIssueIds: ["<T1 issueId>", "<T2 issueId>"]
  ) { addedTests warning }
}
```

Removal: `removeTestsFromTestSet` / `removeTestsFromTestPlan`.

### Create a Test Execution

```graphql
mutation {
  createTestExecution(
    testIssueIds: ["<T1 issueId>", "<T2 issueId>"],
    jira: {
      fields: {
        project: { key: "PROJ" },
        summary: "Regression run 2026-04-22 / staging"
      }
    }
  ) {
    testExecution { issueId jira(fields: ["key"]) }
    warnings
  }
}
```

For a Test Execution tied to a Test Plan:

```graphql
... createTestExecution(
  testPlanIssueId: "<TP issueId>",
  testIssueIds: [ ... ], ...
) ...
```

### Report a single Test Run result

Given a Test Run ID from `getTestExecution().testRuns.results[].id`:

```graphql
mutation UpdateTestRun(
  $id: String!,
  $status: String!,   # e.g. "PASSED", "FAILED"
  $comment: String,
  $evidence: [AttachmentDataInput]
) {
  updateTestRunStatus(id: $id, status: $status) { warnings }
  updateTestRunComment(id: $id, comment: $comment) { warnings }
  addEvidenceToTestRun(id: $id, evidence: $evidence) { warnings }
}
```

Evidence is uploaded as base64:

```json
[
  { "filename": "login-failure.png",
    "mimeType": "image/png",
    "data":     "<base64>" }
]
```

For bulk results from a file, prefer the REST import endpoints
(see `results-import.md`) — far cheaper than N single-Run
mutations.

### Link a Test to a requirement (coverage)

```graphql
mutation {
  addTestsToRequirement(
    issueId: "<Story issueId>",
    testIssueIds: ["<Test issueId>"]
  ) { addedTests warning }
}
```

Mirror: `removeTestsFromRequirement`.

## 5. Fragments — reusable shapes

```graphql
fragment JiraBasics on Issue {
  key
  summary
  status
}

fragment TestBasics on Test {
  issueId
  testType { name kind }
  jira(fields: ["key", "summary", "status"])
}
```

Use in queries:

```graphql
query { getTests(jql: "...", limit: 50) {
  total results { ...TestBasics } } }
```

## 6. Error handling

- **401** → JWT expired. Re-authenticate.
- **422 / `errors[]` in response** → malformed mutation input.
  GraphQL errors come back in the `errors` array — always check
  even on 200.
- **`warnings[]` in a success response** → not fatal, but surface
  it (unexpected downgrades, conflicting links, etc.).
- **Empty response body on a successful POST** → some proxies
  strip bodies on 204 responses; follow with a re-fetch.

## 7. Worked example — end-to-end

**Goal**: "Create a new Manual Test for PROJ, link it to story
PROJ-123, add it to the 'smoke' Test Set, create a Test
Execution, and report PASSED."

```
1. Auth:        POST /authenticate → JWT
2. Resolve:     GET /rest/api/3/issue/PROJ-123 → issueId "55501"
                GET /rest/api/3/issue/PROJ-TS10 → issueId "44401"
3. createTest:  mutation → new Test issueId "99901" (PROJ-T42)
4. addTestsToRequirement(issueId: "55501",
                         testIssueIds: ["99901"])
5. addTestsToTestSet(issueId: "44401",
                     testIssueIds: ["99901"])
6. createTestExecution(testIssueIds: ["99901"],
                       jira: { ... "summary": "Smoke 04-22" })
   → Execution issueId "99902" (PROJ-TE7)
7. getTestExecution(issueId: "99902") {
     testRuns { results { id test { jira(fields:["key"]) } } } }
   → run.id "abcd-run-id"
8. updateTestRunStatus(id: "abcd-run-id", status: "PASSED")
9. Re-fetch PROJ-TE7; confirm 1 run, PASSED.
```
