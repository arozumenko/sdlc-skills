# Test Automation — Command Recipes

## Contents

- [Phase 1: Framework discovery](#phase-1-framework-discovery)
- [Phase 2: Ingest case from TMS](#phase-2-ingest-case-from-tms)
- [Phase 3–4: Analyst execution + AFS output](#phase-34-analyst-execution-afs-output)
- [Phase 5–6: Automation implementation](#phase-56-automation-implementation)
- [Phase 7: Review](#phase-7-review)
- [Phase 8: Deliver + TMS sync](#phase-8-deliver-tms-sync)
- [Summary](#summary)
- [Test plan](#test-plan)
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

# If nothing — run seeding-a-project before proceeding
# (invoke the seeding-a-project skill via the running host)

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
find test-specs -name "*${TMS_ID:-$SLUG}*.md"
```

## Phase 3–4: Analyst execution + AFS output

Host-native sub-agent spawning:

### Claude Code (this harness)

Use the canonical dispatch templates in
[orchestration-playbook.md § Canonical dispatch templates](./orchestration-playbook.md#canonical-dispatch-templates)
— native subagent types, per-case parameters, and the reviewer
triangulation preamble. Dispatch analysts ONE AT A TIME — the analyst
owns the tree and commits its own AFS to the trunk (playbook § The
loop, per unit); verify each returned AFS path exists on disk before
the next dispatch. Never fan out writers (playbook § Dispatching).

### Copilot / other hosts

Use the exact dispatch form `.agents/team-comms.md` documents for the
host. Pass the same prompt. The `qa-engineer` persona lives in
`.github/agents/` (Copilot) or `.claude/agents/` (Claude Code). The
`test-case-analysis` skill it loads lives under the matching
`.../skills/` path.

**Collecting results** (per dispatch, before the next one starts):

1. Wait for the agent to complete — never end a turn with a dispatch in flight.
2. Retrieve its final message via the host's `read_agent` tool (or the return itself).
3. Parse for the AFS path.
4. Verify the file exists on disk — `ls test-specs/.../lN_*.md`. If
   missing, recreate it yourself from the agent's returned content.
5. Aggregate paths as you go; hand the full list to the automation engineers.

## Phase 5–6: Automation implementation

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

## Phase 7: Review

```bash
# Code-review skill
# Invoke via host: Skill tool with "code-review" against the branch diff
```

QA review — delegate to the reviewer slot. Use the canonical dispatch
templates in
[orchestration-playbook.md § Canonical dispatch templates](./orchestration-playbook.md#canonical-dispatch-templates)
— native subagent types, per-case parameters, and the reviewer
triangulation preamble.

## Phase 8: Deliver + TMS sync

The commit + PR below is a **Playwright/UI worked example**; the shape is
the same for any framework — substitute the project's abstraction layer
(API client / screen object), soft-assertion mechanism, and run command.

```bash
# Commit, push, PR — via completing-a-task skill
git checkout -b automation/CASE-ID-short-slug
git add tests/ test-specs/
git commit -m "$(cat <<'EOF'
test(CASE-ID): automate apply-promo flow

- AFS at test-specs/checkout/l2_apply_promo_CASE-ID.md
- Page object extension in tests/pages/checkout.page.ts
- Regression for GH#234 via expect.soft

<your host's co-author trailer, if the project convention uses one>
EOF
)"
git push -u origin HEAD
gh pr create --title "test(CASE-ID): automate apply-promo flow" \
  --body "$(cat <<'EOF'
## Summary
- Automates CASE-ID (apply-promo) in Playwright
- Re-uses `CheckoutPage` page object
- Known defect GH#234 captured as soft-expect

## Test plan
- [x] Ran locally, green
- [ ] Ran in CI pipeline, green
- [ ] TMS execution updated to PASSED

<your host's co-author trailer, if the project convention uses one>
EOF
)"
```

### Post-merge TMS back-write (orchestrator, per seeded policy — playbook § 3. Close)

Owned by the **orchestrator after the merge** — see
[orchestration-playbook.md § 3. Close — read the report, act on it](./orchestration-playbook.md#3-close--read-the-report-act-on-it-yours),
phase 5 — never fired unconditionally at PR-open. Gated on CI / an opt-in
env flag, and only runs when the seed declares a real `tms.adapter`
(graceful on failure — `SKILL.md` § Phase 5).

```bash
# Example: Zephyr Scale over HTTP
curl -s -X POST -H "Authorization: Bearer $ZEPHYR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"projectKey\":\"SCRUM\",\"testCaseKey\":\"$TMS_ID\",\"statusName\":\"Pass\"}" \
  "https://api.zephyrscale.smartbear.com/v2/testexecutions"

# Over MCP (preferred when server is configured):
# mcp__<server>__ZephyrConnector_create_test_execution({ projectKey, testCaseKey, statusName })
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

Analyst writes evidence here during execution; the engineer's test runs
extend the same tree for CI artifacts. The artifact *kinds* follow the
surface — `screenshots/` for UI, request/response captures or `json/`
transcripts for API, metric summaries for perf — but the tree and the
`reports/` + `json/` + `unsynced/` layout stay the same.
