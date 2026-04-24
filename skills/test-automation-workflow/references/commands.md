# Test Automation — Command Recipes

Concrete commands for each phase. Load this file when you need the
copy-pasteable template; the main `SKILL.md` has the conceptual flow.

## Phase 1: Framework discovery

```bash
# What did scout produce?
cat AGENTS.md 2>/dev/null | head -80
cat .agents/testing.md 2>/dev/null
cat .agents/architecture.md 2>/dev/null
cat .agents/test-automation.yaml 2>/dev/null

# If nothing — run project-seeder before proceeding
# (invoke the project-seeder skill via the running host)

# Detect framework if testing.md didn't name it
ls playwright.config.* cypress.config.* wdio.conf.* 2>/dev/null
find . -maxdepth 3 -name pytest.ini -o -name pyproject.toml -o -name pom.xml 2>/dev/null
grep -l "playwright\|cypress\|selenium\|webdriver" package.json pyproject.toml pom.xml build.gradle 2>/dev/null

# Find where tests live
ls tests/ test/ __tests__/ e2e/ integration/ cypress/ 2>/dev/null

# Find existing page objects / helpers
find tests -name "*.page.*" -o -name "*Page.*" 2>/dev/null | head
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

```
# Single case — run directly
Agent({
  subagent_type: "general-purpose",
  description: "Analysis pass — execute case CASE-ID",
  prompt: "You are qa-engineer (Sage). Read .claude/agents/qa-engineer/AGENT.md
          and the test-case-analysis skill at
          .claude/skills/test-case-analysis/SKILL.md. Load case CASE-ID via
          the adapter declared in .agents/test-automation.yaml, execute it
          against $BASE_URL using playwright-testing or browser-verify skill,
          produce the AFS at
          test-specs/{feature}/l{pri}_{slug}_CASE-ID.md, and return the path."
})

# Batch — parallel sub-agents, one per case
# Fire N Agent calls in one message; collect paths; verify files exist.
```

### Taskbox / Copilot / host-native

Use the host's equivalent of `runSubagent` / `task` / `Agent`. Pass the
same prompt. The `qa-engineer` persona lives in `.github/agents/`
(Copilot), `.claude/agents/` (Claude), or `.octobots/agents/`
(taskbox). The `test-case-analysis` skill it loads lives under the
matching `.../skills/` path.

**Collecting results** (critical for background / parallel runs):

1. Wait for all agents to complete.
2. Retrieve each agent's final message via the host's `read_agent` tool.
3. Parse for the AFS path.
4. Verify the file exists on disk — `ls test-specs/.../lN_*.md`. If
   missing, recreate it yourself from the agent's returned content.
5. Aggregate paths before handing off to automation engineers.

## Phase 5–6: Automation implementation

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

## Phase 7: Review

```bash
# Code-review skill
# Invoke via host: Skill tool with "code-review" against the branch diff

# QA review — delegate to qa-engineer agent
Agent({
  subagent_type: "general-purpose",
  description: "QA review of automation diff",
  prompt: "You are qa-engineer (Sage). Review the diff between main and
          HEAD for test-automation correctness: do assertions prove the
          AC, are selectors stable, is the sad path covered, is there
          defect masking? Report findings."
})
```

## Phase 8: Deliver + TMS sync

```bash
# Commit, push, PR — via task-completion skill
git checkout -b automation/CASE-ID-short-slug
git add tests/ test-specs/
git commit -m "$(cat <<'EOF'
test(CASE-ID): automate apply-promo flow

- AFS at test-specs/checkout/l2_apply_promo_CASE-ID.md
- Page object extension in tests/pages/checkout.page.ts
- Regression for GH#234 via expect.soft

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
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
- [x] Ran in CI pipeline, green
- [x] TMS execution updated to PASSED

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

# TMS back-write (example: Zephyr Scale over HTTP)
curl -s -X POST -H "Authorization: Bearer $ZEPHYR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"projectKey\":\"SCRUM\",\"testCaseKey\":\"$TMS_ID\",\"statusName\":\"Pass\"}" \
  "https://api.zephyrscale.smartbear.com/v2/testexecutions"

# TMS back-write over MCP (preferred when server is configured):
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

Analyst writes under `screenshots/` and `json/` during execution.
Engineer's test runs extend the same tree for CI artifacts.
