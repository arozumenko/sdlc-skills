# Bugfix Workflow — Command Recipes

Detailed command templates for each step of the bugfix workflow. Load this
file when you need the exact heredoc text or reproduction pattern; the main
SKILL.md has the step-by-step conceptual flow.

## Step 1: Investigating comment

```bash
gh issue view <NUMBER>
gh issue comment <NUMBER> --body "🔧 **Investigating**: Reading the report and reproducing."
```

Look for: expected vs actual, files/modules involved, error messages, stack
traces, screenshots, duplicate/related issues.

## Step 2: Reproduction patterns

### UI bugs (Playwright MCP)

```
browser_navigate → browser_snapshot → follow reported steps →
browser_console_messages → browser_network_requests → browser_take_screenshot
```

### API bugs

```bash
curl -s -X POST http://localhost:PORT/api/endpoint \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}' | jq .
```

### Logic bugs

```python
# reproduce_issue_NNN.py
from module import function
result = function(edge_case_input)
print(f"Expected: X, Got: {result}")
```

### Reproduced comment

```bash
gh issue comment <NUMBER> --body "$(cat <<'EOF'
✅ **Reproduced**

**Steps:** [exact steps]
**Expected:** [what should happen]
**Actual:** [what happens]
**Frequency:** Always / Intermittent
EOF
)"
```

**If you cannot reproduce:** comment on the ticket with what you tried and
ask for more details. Do NOT proceed to fix.

## Step 3: Failing test template

```python
def test_issue_NNN_description():
    """Regression test for #NNN: [bug title]."""
    # Arrange — set up the conditions that trigger the bug
    input_data = edge_case_input

    # Act — trigger the bug
    result = function(input_data)

    # Assert — what SHOULD happen (this fails now)
    assert result == expected_value
```

Run it to confirm it fails:

```bash
pytest tests/test_module.py::test_issue_NNN -x -v
# Should FAIL — that's the point
```

## Step 4: Root cause comment

```bash
gh issue comment <NUMBER> --body "$(cat <<'EOF'
🔍 **Root Cause**

**Location:** `src/module.py:42`
**Cause:** [description of what's wrong]
**Impact:** [what else is affected]
**Fix approach:** [brief plan]
EOF
)"
```

Root cause classification:
- **Logic error** — wrong condition, off-by-one, missing case
- **Data error** — unexpected input, type mismatch, null handling
- **Concurrency** — race condition, missing lock
- **Configuration** — wrong default, missing env var
- **Integration** — API contract changed, dependency updated

## Step 6: Verification commands

```bash
# 1. The regression test passes
pytest tests/test_module.py::test_issue_NNN -x -v

# 2. Full test suite still passes
pytest tests/ -x -q

# 3. Lint/type check
ruff check . && mypy src/  # or your project's equivalent
```

JS/TS equivalents: `npx tsc --noEmit`, `npx eslint <path>`, `npm test` or
`npx vitest` / `npx jest`.

## Step 7: Fixed comment + PR

```bash
gh issue comment <NUMBER> --body "$(cat <<'EOF'
✅ **Fixed**

**Root Cause:** [one sentence]
**Fix:** [what changed, which files]
**Regression Test:** `tests/test_module.py::test_issue_NNN`
**PR:** #XX

All tests passing.
EOF
)"

git checkout -b fix/<short-description>
git add -A
git commit -m "Fix: [description] (#NNN)"
git push -u origin HEAD
gh pr create --title "Fix: [description] (#NNN)" --body "Closes #NNN"
```

For the full PR body template and reviewer notification, see the
`completing-a-task` skill.
