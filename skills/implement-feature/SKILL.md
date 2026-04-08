---
name: implement-feature
description: End-to-end feature implementation workflow. Use when the user says "implement", "build feature", "work on task", "start implementation", or any feature development work. Covers plan review, test writing, implementation, verification, and delivery.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.1.0"
---

## Feature Implementation: Plan → Test → Build → Verify → Ship

Core philosophy: **understand the plan, write tests first, implement to pass them, verify everything, ship clean.**

## Workflow

```
Step 1: Load the Plan
         ↓
Step 2: Write Test Cases
         ↓
Step 3: Implement
         ↓
Step 4: Manual Verification
         ↓
Step 5: Write Automated Tests
         ↓
Step 6: Run Full Test Suite
         ↓
Step 7: Commit & PR
         ↓
Step 8: Document on Ticket
```

## Step 1: Load the Plan

**Goal:** Understand exactly what to build before writing code.

```bash
# Read the task/story issue
gh issue view <NUMBER>
```

Identify:
- **Acceptance criteria** — the definition of done
- **Interface contract** — input/output types if defined
- **Dependencies** — what must exist before this works
- **Scope** — what's explicitly IN and OUT

If anything is unclear, ask via taskbox before starting:
```bash
python3 octobots/skills/taskbox/scripts/relay.py send \
  --from $OCTOBOTS_ID --to tech-lead "Question about #NNN: [specific question]"
```

**Comment on ticket:**
```bash
gh issue comment <NUMBER> --body "🔧 **Started**: [brief approach description]"
```

## Step 2: Write Test Cases

**Goal:** Define "done" as executable tests BEFORE implementing.

For each acceptance criterion, write a test:

```python
class TestFeatureName:
    def test_happy_path(self):
        """AC-1: User can [do the thing]."""
        result = feature(valid_input)
        assert result.status == "success"

    def test_error_case(self):
        """AC-2: Invalid input returns clear error."""
        with pytest.raises(ValidationError):
            feature(invalid_input)

    def test_edge_case(self):
        """AC-3: Empty input handled gracefully."""
        result = feature(empty_input)
        assert result.items == []
```

Run to confirm they fail (TDD red phase):
```bash
pytest tests/test_feature.py -x -v
# Should FAIL — implementation doesn't exist yet
```

## Step 3: Implement

**Goal:** Write the minimum code to pass the tests.

1. **Follow existing patterns** — read similar features in the codebase first
2. **One change at a time** — verify syntax after each file edit
3. **Interface contract first** — if the task defines input/output types, match them exactly

```bash
# Verify syntax after each edit
python -m py_compile src/module.py  # Python
npx tsc --noEmit                     # TypeScript
```

Don't:
- Add features beyond the acceptance criteria
- Refactor neighboring code
- Add error handling for impossible scenarios
- Optimize before it works

## Step 4: Manual Verification

**Goal:** Sanity check before automated tests.

### For API features
```bash
curl -s http://localhost:PORT/api/endpoint | jq .
```

### For UI features
```
browser_navigate → browser_snapshot → interact → verify visually
```

### For backend logic
```python
python -c "from module import feature; print(feature(test_input))"
```

## Step 5: Write Automated Tests

**Goal:** Extend the test cases from Step 2 with integration and E2E tests if needed.

- **Unit tests** — already written in Step 2
- **Integration tests** — if the feature touches external systems (DB, APIs)
- **E2E tests** — if there's a UI component (use Playwright)

```python
# Integration test
def test_feature_persists_to_db(db_session):
    result = feature(valid_input)
    saved = db_session.query(Model).get(result.id)
    assert saved is not None
    assert saved.name == valid_input.name
```

## Step 6: Run Full Test Suite

**Goal:** Nothing broke.

```bash
# All tests
pytest tests/ -x -q

# Lint
ruff check .  # or eslint

# Type check
mypy src/     # or tsc --noEmit

# Check scope of changes
git --no-pager diff --stat
```

If anything fails, fix it. Don't ship broken code.

## Step 7: Commit & PR

```bash
git add src/ tests/
git commit -m "feat: [description] (#NNN)"
git push -u origin HEAD
gh pr create --title "feat: [description] (#NNN)" \
  --body "$(cat <<'EOF'
## Summary
- [what was built]
- [key decisions made]

## Test Plan
- [x] Unit tests: N tests
- [x] Integration tests: N tests
- [ ] E2E tests: if applicable

Closes #NNN
EOF
)"
```

## Step 8: Document on Ticket

```bash
gh issue comment <NUMBER> --body "$(cat <<'EOF'
✅ **Done**

**Implemented:** [summary]
**Tests:** N unit + N integration
**PR:** #XX
**Key decisions:** [any architectural choices]

All tests passing. Ready for review.
EOF
)"
```

Notify PM:
```bash
python3 octobots/skills/taskbox/scripts/relay.py send \
  --from $OCTOBOTS_ID --to project-manager \
  "TASK (#NNN) complete. PR #XX ready for review. [one-line summary]"
```

## Anti-Patterns

- Don't implement without understanding the acceptance criteria
- Don't skip tests — they're proof of correctness
- Don't expand scope beyond what the task defines
- Don't commit without running the full test suite
- Don't forget to document on the ticket
