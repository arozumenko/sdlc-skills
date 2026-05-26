# Implement Feature — Command Recipes

Detailed command templates and verification patterns for each step of the
feature implementation workflow. Load this file when you need the exact
heredoc, test template, or handoff command; the main SKILL.md has the
step-by-step conceptual flow.

## Step 1: Load the plan

```bash
gh issue view <NUMBER>
```

Identify acceptance criteria, interface contract, dependencies, explicit
in/out scope.

Ask clarifying questions via a subagent call or tracker comment before
starting if anything is unclear.

Started comment:

```bash
gh issue comment <NUMBER> --body "🔧 **Started**: [brief approach description]"
```

## Step 2: Test case templates

### Python (pytest)

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

### TypeScript (vitest/jest)

```typescript
describe("FeatureName", () => {
  it("AC-1: happy path", () => {
    const result = feature(validInput);
    expect(result.status).toBe("success");
  });

  it("AC-2: rejects invalid input", () => {
    expect(() => feature(invalidInput)).toThrow(ValidationError);
  });
});
```

Confirm tests fail before implementing:

```bash
pytest tests/test_feature.py -x -v       # Python
npx vitest run tests/feature.test.ts     # TS
# Should FAIL — implementation doesn't exist yet
```

## Step 3: Verify-after-edit commands

```bash
python -m py_compile src/module.py   # Python
npx tsc --noEmit                     # TypeScript
```

Don't:
- Add features beyond the acceptance criteria
- Refactor neighboring code
- Add error handling for impossible scenarios
- Optimize before it works

## Step 4: Manual verification by feature type

### API features

```bash
curl -s http://localhost:PORT/api/endpoint | jq .
```

### UI features

```
browser_navigate → browser_snapshot → interact → verify visually
```

### Backend logic

```python
python -c "from module import feature; print(feature(test_input))"
```

## Step 5: Integration test template

```python
def test_feature_persists_to_db(db_session):
    result = feature(valid_input)
    saved = db_session.query(Model).get(result.id)
    assert saved is not None
    assert saved.name == valid_input.name
```

## Step 6: Full suite commands

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

## Step 7: Commit & PR

```bash
git checkout -b feat/<short-description>
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

## Step 8: Done comment + PM notification

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

Include `PR #XX ready for review — [one-line summary]` in your final reply
to PM so the handoff is complete.

For the full five-step handoff protocol (commit → PR → issue comment →
notify), see the `completing-a-task` skill.
