---
name: bugfix-workflow
description: End-to-end bugfix workflow. Test first, plan, fix, verify. Use when the user says "fix bug", "bugfix", "investigate issue", "fix #NNN", or any bug-related work. Covers reproduction, test creation, RCA, fix implementation, verification, and ticket documentation.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.1.0"
---

## Bugfix Workflow: Reproduce → Test → Fix → Verify

Core philosophy: **reproduce before you fix, verify after you fix, link everything to the ticket.**

## Workflow

```
Step 1: Read & Understand the Bug
         ↓
Step 2: Reproduce
         ↓
Step 3: Write a Failing Test
         ↓
Step 4: Root Cause Analysis
         ↓
Step 5: Implement the Fix
         ↓
Step 6: Verify (tests pass)
         ↓
Step 7: Document on Ticket
```

## Step 1: Read & Understand the Bug

**Goal:** Fully understand the issue before touching code.

```bash
gh issue view <NUMBER>
```

Read all comments. Identify:
- Expected behavior vs actual behavior
- Which files/modules are involved
- Any error messages, stack traces, screenshots
- Related or duplicate issues

**Comment on ticket:**
```bash
gh issue comment <NUMBER> --body "🔧 **Investigating**: Reading the report and reproducing."
```

## Step 2: Reproduce

**Goal:** Confirm the bug exists and understand exact conditions.

### For UI Bugs (Playwright MCP)
```
browser_navigate → browser_snapshot → follow reported steps →
browser_console_messages → browser_network_requests → browser_take_screenshot
```

### For API Bugs
```bash
curl -s -X POST http://localhost:PORT/api/endpoint \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}' | jq .
```

### For Logic Bugs
Write a minimal script that triggers the issue:
```python
# reproduce_issue_NNN.py
from module import function
result = function(edge_case_input)
print(f"Expected: X, Got: {result}")
```

**If you cannot reproduce:** Comment on ticket with what you tried and ask for more details. Do NOT proceed to fix.

**Comment on ticket:**
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

## Step 3: Write a Failing Test

**Goal:** Capture the bug as a test BEFORE fixing it. The test must fail now and pass after the fix.

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

## Step 4: Root Cause Analysis

**Goal:** Find the exact code that causes the bug.

1. **Locate** the relevant code:
   ```bash
   # Search for the function/class involved
   grep -rn "function_name" src/ --include="*.py"
   ```

2. **Trace** the execution path from entry point to failure

3. **Identify** the root cause:
   - Logic error (wrong condition, off-by-one, missing case)
   - Data error (unexpected input, type mismatch, null handling)
   - Concurrency (race condition, missing lock)
   - Configuration (wrong default, missing env var)
   - Integration (API contract changed, dependency updated)

4. **Assess impact:** What else uses this code? Could the fix break other things?

**Comment on ticket:**
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

## Step 5: Implement the Fix

**Goal:** Minimal, focused fix. Don't refactor, don't clean up neighbors.

1. Fix the root cause — only the root cause
2. Verify syntax: `python -m py_compile file.py` (or equivalent)
3. Don't change unrelated code

## Step 6: Verify

**Goal:** The failing test now passes. Nothing else broke.

```bash
# 1. The regression test passes
pytest tests/test_module.py::test_issue_NNN -x -v

# 2. Full test suite still passes
pytest tests/ -x -q

# 3. Lint/type check
ruff check . && mypy src/  # or your project's equivalent
```

If anything fails, fix it before proceeding.

## Step 7: Document on Ticket

**Goal:** Complete audit trail — what was wrong, what was fixed, proof it works.

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
```

Commit and create PR:
```bash
git add -A
git commit -m "Fix: [description] (#NNN)"
git push -u origin HEAD
gh pr create --title "Fix: [description] (#NNN)" --body "Closes #NNN"
```

## Anti-Patterns

- Don't fix without reproducing first
- Don't skip the failing test — no test = no proof
- Don't refactor while fixing — separate concerns
- Don't close the ticket without documenting the fix
- Don't fix multiple bugs in one PR
