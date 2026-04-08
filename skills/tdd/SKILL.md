---
name: tdd
description: Test-driven development workflow. Use when the user asks to "write tests first", "TDD", "add test coverage", "test this function", or wants to develop a feature test-first.
license: Apache-2.0
compatibility: Works with any test framework (pytest, jest, go test, cargo test, etc.)
metadata:
  author: octobots
  version: "0.1.0"
---

# Test-Driven Development

Red-green-refactor. Write the test, watch it fail, make it pass, clean up.

## Workflow

### 1. Red — Write a Failing Test

Write the simplest test that describes the desired behavior:

```python
def test_user_can_login_with_valid_credentials():
    result = login("alice", "correct-password")
    assert result.success is True
    assert result.user.name == "alice"
```

Run it. Confirm it fails for the *right reason* (missing function, not syntax error).

### 2. Green — Make It Pass

Write the minimum code to make the test pass. Don't generalize. Don't optimize. Don't clean up. Just make it green.

### 3. Refactor — Clean Up

Now that tests are green, improve the implementation:
- Remove duplication
- Extract clear names
- Simplify logic

Run tests again after refactoring. Still green? Good. Commit.

## Test Quality Rules

- **Test behavior, not implementation.** Tests should survive refactoring.
- **One assertion per concept.** Multiple `assert` calls are fine if they verify one logical thing.
- **Descriptive names.** `test_expired_token_returns_401` not `test_auth_3`.
- **No mocks unless necessary.** Prefer real objects. Mock only external services and I/O.
- **Arrange-Act-Assert structure.** Set up, do the thing, check the result.

## When to Use TDD

Good fit:
- Business logic with clear inputs/outputs
- Bug fixes (write the test that catches the bug first)
- API endpoints (expected request → expected response)
- Data transformations and validators

Poor fit:
- Exploratory/prototype code (write tests after)
- UI layout (use visual testing)
- Infrastructure/config (use integration tests)

## Framework Detection

Detect the project's test framework from existing files:

```bash
# Python
ls pytest.ini pyproject.toml setup.cfg 2>/dev/null | head -1
grep -r "import pytest\|import unittest" tests/ --include="*.py" -l | head -3

# JavaScript/TypeScript
grep -E "jest|vitest|mocha" package.json 2>/dev/null

# Go — built in
ls *_test.go 2>/dev/null
```

Follow the existing test patterns. Don't introduce a new framework.
