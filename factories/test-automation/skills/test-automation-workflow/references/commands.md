# Test Automation — Command Recipes

## Contents

- [Phase 1: Framework discovery](#phase-1-framework-discovery)
- [Phase 2: Ingest case from TMS](#phase-2-ingest-case-from-tms)
- [Phase 3: Route — earning execution evidence](#phase-3-route--earning-execution-evidence)
- [Phase 4: Build](#phase-4-build)
- [Phase 5: Review](#phase-5-review)
- [Phase 6: Deliver + TMS sync](#phase-6-deliver-tms-sync)
- [Sub-agent result collection pattern (cross-host)](#sub-agent-result-collection-pattern-cross-host)
- [Evidence paths (convention)](#evidence-paths-convention)

Concrete commands for each phase. Load this file when you need the
copy-pasteable template; the main `SKILL.md` has the conceptual flow.

## Phase 1: Framework discovery

```bash
# What did scout produce?
cat AGENTS.md 2>/dev/null | head -80
cat .agents/testing.md 2>/dev/null
cat .agents/architecture.md 2>/dev/null
cat .agents/test-automation.yaml 2>/dev/null

# If nothing — run seeding-automation-project before proceeding
# (invoke the seeding-automation-project skill via the running host)

# Detect framework if testing.md didn't name it — scan broadly across
# surfaces, not just browser runners. Match whatever the project uses.
ls playwright.config.* cypress.config.* wdio.conf.* 2>/dev/null   # UI
find . -maxdepth 3 -name pytest.ini -o -name pyproject.toml -o -name pom.xml -o -name build.gradle 2>/dev/null
# UI runners, API/test frameworks, mobile drivers, load tools — one grep, unordered:
grep -lE "playwright|cypress|selenium|webdriver|supertest|httpx|rest-assured|restassured|appium|espresso|k6|gatling|jmeter|locust" \
  package.json pyproject.toml pom.xml build.gradle 2>/dev/null
ls k6.config.* *.jmx Gatling* 2>/dev/null                        # perf, if any

# Find where tests live
ls tests/ test/ __tests__/ e2e/ integration/ api/ cypress/ 2>/dev/null

# Find the existing abstraction layer (page objects for UI, API clients /
# screen objects on other surfaces) / helpers
find tests -name "*.page.*" -o -name "*Page.*" -o -name "*client*" -o -name "*Client*" 2>/dev/null | head
```

## Phase 2: Ingest case from TMS

### MCP transport (preferred when available)

When the host has an MCP server wired for the TMS (Elitea, Atlassian
Remote MCP, vendor MCPs), call tools instead of HTTP. Tool names are
exposed by the host as `mcp__<server>__<tool>`. Example call sequence
(pseudocode — substitute your host's tool-invocation syntax):

```
# Fetch Zephyr Scale test case through Elitea MCP
mcp__Elitea_Dev__ZephyrConnector_get_test_case({ testCaseKey: "SCRUM-T101" })
mcp__Elitea_Dev__ZephyrConnector_get_test_case_test_steps({ testCaseKey: "SCRUM-T101" })
mcp__Elitea_Dev__ZephyrConnector_get_test_case_links({ testCaseKey: "SCRUM-T101" })

# Find cases linked to a story
mcp__Elitea_Dev__JiraIntegration_search_using_jql({ jql: "issuekey = STORY-42" })
mcp__Elitea_Dev__ZephyrConnector_get_issue_link_test_cases({ issueId: "<jira-id>" })

# Back-write execution after the automation run
mcp__Elitea_Dev__ZephyrConnector_create_test_execution({
  projectKey: "SCRUM", testCaseKey: "SCRUM-T101", statusName: "Pass"
})
mcp__Elitea_Dev__ZephyrConnector_update_test_execution_test_steps({ ... })
```

No credentials in these calls — the MCP server holds the token in the
host's config (`~/.claude.json`, `.mcp.json`, host equivalents). If the
MCP server isn't available, fall back to HTTP below.

### Zephyr Scale (HTTP)

```bash
TMS_ID="$1"  # e.g. SCRUM-T101
curl -s -H "Authorization: Bearer $ZEPHYR_TOKEN" \
  "https://api.zephyrscale.smartbear.com/v2/testcases/$TMS_ID" | jq .
curl -s -H "Authorization: Bearer $ZEPHYR_TOKEN" \
  "https://api.zephyrscale.smartbear.com/v2/testcases/$TMS_ID/teststeps" | jq .
```

### TestRail

```bash
CASE_ID="$1"
curl -s -u "$TESTRAIL_CREDS" \
  "https://your-company.testrail.io/index.php?/api/v2/get_case/$CASE_ID" | jq .
```

### Xray

```bash
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"client_id\":\"${XRAY_CLIENT%:*}\",\"client_secret\":\"${XRAY_CLIENT#*:}\"}" \
  https://xray.cloud.getxray.app/api/v2/authenticate | tr -d '"')
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://xray.cloud.getxray.app/api/v2/tests/$1" | jq .
```

### Azure Test Plans

```bash
CASE_ID="$1"
curl -s -u ":$AZURE_DEVOPS_PAT" \
  "https://dev.azure.com/$ORG/$PROJECT/_apis/wit/workitems/$CASE_ID?api-version=7.0" | jq .
```

### Markdown (default)

```bash
find "${CASES_DIR:-tasks}" -name "*${TMS_ID:-$SLUG}*.md"
```

## Phase 3: Route — earning execution evidence

The route is decided by `.agents/testing.md § Execution provider` plus the
evidence on disk (playbook § The loop, per unit). Commands worth having:

```bash
# provider manual-qa: does qualifying evidence exist for this case?
ls tasks/*/${TMS_ID}_*.md               # the authored case file
# the run record is reports/RUN-*.md (always written by test-reporter);
# require the case id with a Pass verdict in its Results table
grep -lE "${TMS_ID}.*Pass" reports/RUN-*.md 2>/dev/null
grep -l "\"tc_id\": \"${TMS_ID}\"" reports/metrics/*.json 2>/dev/null   # optional corroboration (metrics add-on)
```

PASS run record + case file → build from that evidence, no dispatch. Missing
→ dispatch manual-qa's `test-runner` per case, on their exact contract
(playbook § Canonical dispatch templates → Runner):

```
Execute the test case at {CASE_FILE_PATH} against base_url={BASE_URL}.
```

One runner at a time — it drives the one shared browser and the tree stays on
the trunk. The dispatch failing (agent type unknown) → the unit is
`needs-execution` in the report; never execute the case yourself when policy
says manual-qa. Provider `self` → no runner at all: the build's first green
run is the execution.

## Phase 4: Build

Run with **whatever the project uses** — the run command lives in
`.agents/testing.md` § Run command (or `.agents/test-automation.yaml`
`framework.run_command`). The recipes below are examples per common
framework and surface, not a default; match the one the project
actually has.

### Playwright (TypeScript/JavaScript)

```bash
# Run one spec
npx playwright test tests/checkout/apply-promo.spec.ts --headed

# Run by grep
npx playwright test --grep "apply promo"

# Debug mode
npx playwright test tests/checkout/apply-promo.spec.ts --debug

# Read error-context.md from test-results/
ls test-results/
cat test-results/**/error-context.md 2>/dev/null
```

### Cypress

```bash
npx cypress run --spec "cypress/e2e/checkout/apply-promo.cy.ts"
npx cypress open    # interactive
```

### Pytest + Playwright-python

```bash
pytest tests/checkout/test_apply_promo.py -x --headed
pytest tests/checkout/test_apply_promo.py -k apply_promo -v
```

### Selenium / JUnit

```bash
mvn test -Dtest=CheckoutApplyPromoIT
```

### WebdriverIO

```bash
npx wdio run ./wdio.conf.ts --spec=tests/checkout/apply-promo.e2e.ts
```

### API / service suites (non-UI examples)

```bash
# Node — supertest / Playwright request, run one spec
npx playwright test tests/api/orders.spec.ts            # Playwright API project
npx jest tests/api/orders.test.ts                       # supertest under Jest

# Python — pytest + httpx
pytest tests/api/test_orders.py -k create_order -v

# Java — RestAssured under JUnit
mvn test -Dtest=OrdersApiIT
```

### Performance / load suites (non-UI examples)

```bash
k6 run perf/checkout.js                                  # k6
mvn gatling:test -Dgatling.simulationClass=CheckoutSim   # Gatling
locust -f perf/checkout.py --headless -u 50 -r 5         # Locust
```

## Phase 5: Review

```bash
# Code-review skill
# Invoke via host: Skill tool with "code-review" against the branch diff
```

Delegate to the reviewer slot — an engineer-typed FRESH dispatch. Use the
canonical dispatch templates in
[orchestration-playbook.md § Canonical dispatch templates](./orchestration-playbook.md#canonical-dispatch-templates)
— native subagent types, per-unit parameters, and the coverage-walk preamble
([reviewer-contract.md](./reviewer-contract.md)).

## Phase 6: Deliver + TMS sync

The commit + PR below is a **Playwright/UI worked example**; the shape is
the same for any framework — substitute the project's abstraction layer
(API client / screen object), soft-assertion mechanism, and run command.

```bash
# Commit, push, PR — via completing-a-task skill
git checkout -b tests/CASE-ID-short-slug
git add tests/checkout/apply-promo.spec.ts tests/pages/checkout.page.ts \
        .agents/automation/surface/checkout.md      # by exact path, always
git commit -m "$(cat <<'EOF'
test(CASE-ID): automate apply-promo flow

- Coverage declaration in the spec: steps 1-5; 6 excluded
  (blocked-by-defect: GH#234)
- Page object extension in tests/pages/checkout.page.ts
- Surface cache updated with the promo-field handles

<your host's co-author trailer, if the project convention uses one>
EOF
)"
git push -u origin HEAD
gh pr create --title "test(CASE-ID): automate apply-promo flow" \
  --body "$(cat <<'EOF'
## Summary
- Automates CASE-ID (apply-promo) in Playwright, coverage: partial
  (step 6 blocked-by-defect: GH#234)
- Execution provenance: manual-qa run RUN-2026-08-12 (or: first green run)
- Re-uses `CheckoutPage` page object

## Test plan
- [x] Ran locally, green
- [ ] Hardening gate N× green
- [ ] TMS execution updated post-merge (status + coverage note)

<your host's co-author trailer, if the project convention uses one>
EOF
)"
```

### Post-merge TMS back-write (orchestrator, per seeded policy — playbook § 3. Close)

Owned by the **orchestrator after the merge** — see
[orchestration-playbook.md § 3. Close — read the report, act on it](./orchestration-playbook.md#3-close--read-the-report-act-on-it-yours)
— never fired unconditionally at PR-open. Gated on CI / an opt-in
env flag, and only runs when the seed declares a real `tms.adapter`
(graceful on failure). **Dual-write policy applies**
([tms-adapters.md § Dual-write policy](./tms-adapters.md#dual-write-policy--ta-writes-automation-manual-qa-writes-live-runs)):
this writes the AUTOMATION execution — gate outcome, coverage note
(`full | partial` + excluded steps with reasons), PR link — and never a
manual/live run.

```bash
# Example: Zephyr Scale over HTTP — comment carries the coverage note
curl -s -X POST -H "Authorization: Bearer $ZEPHYR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"projectKey\":\"SCRUM\",\"testCaseKey\":\"$TMS_ID\",\"statusName\":\"Pass\",
       \"comment\":\"Automated (gate 3/3 green). Coverage: partial — step 6 excluded (blocked-by-defect: GH#234). PR #41.\"}" \
  "https://api.zephyrscale.smartbear.com/v2/testexecutions"

# Over MCP (preferred when server is configured):
# mcp__<server>__ZephyrConnector_create_test_execution({ projectKey, testCaseKey, statusName, comment })
```

## Sub-agent result collection pattern (cross-host)

When you fire N parallel sub-agents and need their outputs:

```
for each agent_id returned by the host's spawn call:
    final_message = host.read_agent(agent_id)    # NOT a shell call
    extract expected output paths from final_message
    for path in expected_paths:
        if not os.path.exists(path):
            recreate path from final_message content
aggregate once all agents resolved.
```

Never rely on the sub-agent to persist files for you. Always verify.

## Evidence paths (convention)

```
test-results/
  screenshots/{test-id}-step-{n}-{action}.png
  reports/{test-id}-{iso-timestamp}.html
  json/{test-id}-{iso-timestamp}.json
  unsynced/        # TMS back-writes that failed and need manual sync
```

The runner writes evidence here during execution; the engineer's test runs
extend the same tree for CI artifacts. The artifact *kinds* follow the
surface — `screenshots/` for UI, request/response captures or `json/`
transcripts for API, metric summaries for perf — but the tree and the
`reports/` + `json/` + `unsynced/` layout stay the same.
