# Results import — JUnit, Cucumber, TestNG, NUnit, xUnit, Xray JSON

Xray can import test results from every mainstream runner. The
import endpoints create a **Test Execution** and one **Test Run**
per reported test case. Mapping report rows to existing Tests
relies on conventions you need to get right — a mis-mapped report
creates a 0-run Execution and fails silently.

## 1. Endpoints

Same path on Cloud and Server; only the base URL differs:

```
Cloud  : https://xray.cloud.getxray.app/api/v2/import/execution/...
Server : https://<your-jira>/rest/raven/2.0/import/execution/...
```

| Format | Endpoint suffix | Body |
|---|---|---|
| JUnit XML | `/junit` | multipart file |
| JUnit (multi-file) | `/junit/multipart` | multipart, multiple files |
| TestNG XML | `/testng` | multipart file |
| NUnit XML (v2, v3) | `/nunit`, `/nunit/multipart` | multipart file |
| xUnit XML | `/xunit`, `/xunit/multipart` | multipart file |
| Cucumber JSON | `/cucumber` | JSON body |
| Robot Framework | `/robot` (if plugin present) | multipart file |
| Xray JSON (canonical) | `/` (just `/import/execution`) | JSON body |

Common query params:

- `projectKey=PROJ` — where the new Test Execution lands
- `testExecKey=PROJ-TE7` — append results to an existing Execution
- `testPlanKey=PROJ-P7` — link to a Test Plan (rollup)
- `fixVersion=2.7.0`, `revision=abc123`, `testEnvironments=staging`

## 2. JUnit XML — the default for most JS / Python runners

Standard JUnit shape:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="smoke" tests="3" failures="1" errors="0" skipped="0">
    <testcase classname="login.PlusSignEmail" name="accepts plus sign"
              time="1.234"/>
    <testcase classname="login.ShortPassword" name="rejects short password"
              time="0.321">
      <failure message="AssertionError: expected 200, got 500"
               type="AssertionError">
        at /app/tests/login.spec.ts:42
      </failure>
    </testcase>
    <testcase classname="login.SSO" name="redirects to IdP" time="0.0">
      <skipped message="SSO disabled in this env"/>
    </testcase>
  </testsuite>
</testsuites>
```

### How Xray maps JUnit rows to Jira Test keys

Xray looks at `classname` + `name` against Jira Test keys using
one of these strategies (configurable per project):

1. **Test description / summary match** — if your Jira Test
   summary is `"accepts plus sign"` and the JUnit `<testcase
   name>` matches, Xray may match. Unreliable — strings drift.
2. **Label match** — each Jira Test carries a label
   `automation:<classname>.<name>`; Xray uses that as the mapping
   key. Reliable, but requires maintenance.
3. **Cucumber Test Issue Key** (Cucumber only) — the scenario's
   `@TEST_PROJ-T42` tag becomes the mapping key. Most reliable
   for BDD flows.
4. **Exact Jira key in `classname`** — `classname="PROJ-T42"`,
   `name="<description>"`. Most reliable for XML-based runners:
   make your runner emit Jira keys as classnames. The dmtools-cli
   + Elitea SDK patterns both use this approach.

Pick ONE strategy for the project and document it in
`.agents/testing.md` so both the runner config and the Xray
project match. The single biggest import-failure cause is
runners and Xray disagreeing on mapping.

### Status mapping (JUnit → Xray)

| JUnit | Xray (default) |
|---|---|
| `<testcase>` (no child elements) | `PASSED` |
| `<failure>` | `FAILED` |
| `<error>` | `FAILED` (or `ABORTED` in some configs) |
| `<skipped>` | `TODO` (or `SKIPPED` if that status is configured) |

Failure messages go into the Test Run `comment`; text inside
`<failure>` becomes the error output.

### Minimal working call (Cloud)

```
curl -H "Authorization: Bearer $JWT" \
     -F "file=@results.xml" \
     "https://xray.cloud.getxray.app/api/v2/import/execution/junit?projectKey=PROJ&testPlanKey=PROJ-P7"
```

Response:

```json
{
  "id":    "99902",
  "key":   "PROJ-TE7",
  "self":  "https://your-site.atlassian.net/browse/PROJ-TE7"
}
```

## 3. Cucumber JSON

Standard `cucumber-json` output:

```json
[
  {
    "uri": "features/login.feature",
    "id": "login",
    "name": "Login",
    "elements": [
      {
        "id": "login;plus-sign-email-login",
        "name": "Plus-sign email login",
        "type": "scenario",
        "tags": [{ "name": "@TEST_PROJ-T42" }],
        "steps": [
          { "keyword": "Given ", "name": "I am on the login page",
            "result": { "status": "passed", "duration": 123000000 } },
          { "keyword": "When ", "name": "I submit user+tag@x.com",
            "result": { "status": "passed", "duration": 50000000 } },
          { "keyword": "Then ", "name": "I see the dashboard",
            "result": { "status": "failed",
                        "error_message": "Timeout after 2000ms",
                        "duration": 2100000000 } }
        ]
      }
    ]
  }
]
```

Import:

```
curl -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     --data-binary @cucumber.json \
     "https://xray.cloud.getxray.app/api/v2/import/execution/cucumber?projectKey=PROJ"
```

Key rule: each scenario must carry `@TEST_PROJ-T<key>` in its
tags for unambiguous mapping. Without the tag, Xray tries
name-match, which drifts.

## 4. Xray canonical JSON — full control

When JUnit / Cucumber shapes don't fit (custom runner, need to
upload evidence per step, need per-step actualResult):

```json
{
  "info": {
    "project":            "PROJ",
    "summary":            "Smoke 2026-04-22 / staging",
    "description":        "Automated run from CI #1087",
    "user":               "<username or accountId>",
    "revision":           "abc123",
    "testPlanKey":        "PROJ-P7",
    "testEnvironments":   ["staging"],
    "startDate":          "2026-04-22T09:00:00Z",
    "finishDate":         "2026-04-22T09:14:22Z"
  },
  "tests": [
    {
      "testKey":      "PROJ-T42",
      "status":       "PASSED",
      "comment":      "All three steps green.",
      "executedBy":   "<username or accountId>",
      "start":        "2026-04-22T09:00:00Z",
      "finish":       "2026-04-22T09:02:11Z",
      "steps": [
        { "status": "PASSED", "actualResult": "Form visible" },
        { "status": "PASSED", "actualResult": "Submit accepted" },
        { "status": "PASSED", "actualResult": "Dashboard rendered 1.4s" }
      ],
      "evidence": [
        { "filename": "final-dashboard.png",
          "contentType": "image/png",
          "data": "<base64>" }
      ]
    },
    {
      "testKey":    "PROJ-T43",
      "status":     "FAILED",
      "comment":    "Submit step timed out after 2s.",
      "defects":    ["PROJ-201"]
    }
  ]
}
```

Import:

```
curl -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     --data-binary @xray-results.json \
     "https://xray.cloud.getxray.app/api/v2/import/execution"
```

## 5. Validation after import — non-negotiable

A 200 response does NOT prove the import landed correctly. Every
import must be followed by:

1. **Count check** — re-fetch the created Test Execution, count
   `testRuns`. It must equal the number of cases in the source
   report. A count of zero is the silent-fail signature of
   broken mapping.
2. **Status distribution check** — sum PASSED / FAILED / …
   against the source report. Off-by-many is a mapping error;
   off-by-one is often a skipped test reported as two rows.
3. **Spot-check one PASSED and one FAILED** — verify the comment
   / error message matches the source.
4. **Evidence check** (if attached) — re-fetch each Test Run's
   evidence list, confirm filenames / sizes.

Cloud:

```graphql
query { getTestExecution(issueId: "<id>") {
  jira(fields: ["key"])
  testRuns(limit: 1000) {
    total
    results { status { name } test { jira(fields: ["key"]) } comment }
  }
} }
```

Server:

```
GET /rest/raven/2.0/api/testexec/PROJ-TE7/test
```

## 6. Common pitfalls

- **`Unknown test: …`** / 0 runs imported — `classname` or
  `@TEST_PROJ-…` tag doesn't map to an existing Test in the
  target project. Fix the runner config OR pre-create the Tests.
- **All runs show as `TODO`** — a status value your runner
  emitted isn't in the project's status catalogue. Query
  `getStatuses` / `/settings/teststatuses` and map explicitly.
- **Evidence not attached** — base64 mis-encoded or
  `contentType` missing. Xray silently drops malformed evidence
  entries.
- **Test Execution links to wrong Test Plan** — `testPlanKey`
  query param was omitted; Execution was created without the
  Plan link. Fix with an update, OR re-import with the param.
- **Multiple TMs updating the same Execution race** — JUnit
  multipart import is not atomic across concurrent posts. Import
  per-suite sequentially, OR create one Execution per CI shard
  and link all to the same Test Plan.
- **Big reports time out** — split into chunks by suite or by
  class, import sequentially into the same Execution with
  `testExecKey=`.

## 7. Choosing a format

| Situation | Use |
|---|---|
| JS / Python / Java runners emit JUnit by default | JUnit |
| BDD project (Cucumber / SpecFlow / Behave) | Cucumber JSON |
| Custom runner; need per-step results + evidence | Xray canonical JSON |
| .NET runner with NUnit/xUnit output | NUnit/xUnit |
| Robot Framework and plugin is installed | Robot |
| Unclear / heterogeneous pipelines | Xray canonical JSON (most control) |
