# Plan Feature — Templates & Investigation Recipes

## Contents

- [Step 2: Investigation commands](#step-2-investigation-commands)
- [Step 3: Clarifying question patterns](#step-3-clarifying-question-patterns)
- [Step 4: Feasibility tables](#step-4-feasibility-tables)
- [Step 5: Acceptance criteria format (Given/When/Then)](#step-5-acceptance-criteria-format-givenwhenthen)
- [Step 6: Implementation plan template](#step-6-implementation-plan-template)
- [Implementation Plan](#implementation-plan)
- [Step 7: Approval presentation template](#step-7-approval-presentation-template)
- [Feature Plan: [Name]](#feature-plan-name)

Detailed templates and command patterns for each step of the feature planning
workflow. Load this file when you need exact investigation commands,
feasibility table layouts, acceptance criteria formats, or approval
presentations; the main SKILL.md has the step-by-step conceptual flow.

## Step 2: Investigation commands

```bash
# Find relevant code
grep -rn "related_term" src/ --include="*.py" -l
grep -rn "related_term" src/ --include="*.ts" -l

# Check for existing tests
grep -rn "test.*related" tests/ -l

# Check git history for context
git --no-pager log --oneline --all --grep="related_term" | head -10
```

Document:
- What already exists that can be reused
- What needs to change vs. what's new
- Existing patterns to follow
- Technical constraints discovered

## Step 3: Clarifying question patterns

Common unknowns:

- **Scope:** "Does this include X?" → ask
- **Integration:** "Does this need to work with Y?" → investigate
- **Performance:** "How fast does this need to be?" → ask
- **Security:** "Who should have access?" → ask
- **Edge cases:** "What happens when Z?" → document assumption or ask

When presenting options to the user, lay out trade-offs:

> "For the search feature, I see two approaches:
> A) Full-text search via PostgreSQL — simpler, no new deps
> B) Elasticsearch — faster for large datasets, needs infra
> Which fits our needs?"

## Step 4: Feasibility tables

### Impact assessment

| Area     | Impact          | Files Affected                   |
|----------|-----------------|----------------------------------|
| API      | New endpoints   | `src/api/routes.py`              |
| Database | New table       | `migrations/`, `src/models.py`   |
| Frontend | New page        | `components/`, `pages/`          |
| Tests    | New test suite  | `tests/test_feature.py`          |

### Risk assessment

| Risk     | Likelihood    | Impact        | Mitigation    |
|----------|---------------|---------------|---------------|
| [risk]   | Low/Med/High  | Low/Med/High  | [mitigation]  |

### Dependencies

- **External:** APIs, services, libraries
- **Internal:** other features, shared code
- **Blocking:** what must be done first

## Step 5: Acceptance criteria format (Given/When/Then)

```markdown
### AC-1: [Criterion title]
**Given** [precondition]
**When** [action]
**Then** [expected result]

### AC-2: Error handling
**Given** [invalid input condition]
**When** [action with bad data]
**Then** [expected error behavior]

### AC-3: Edge case
**Given** [edge case condition]
**When** [action]
**Then** [expected graceful behavior]
```

**Rules:**
- Every AC must be testable (pass/fail, no "should be intuitive")
- Include happy path, error cases, and edge cases
- Include performance criteria if relevant ("loads in under 2s")

## Step 6: Implementation plan template

```markdown
## Implementation Plan

### Phase 1: Foundation (no dependencies)
- [ ] TASK-1: Database migration — add new table
- [ ] TASK-2: UI component shells — empty components with routing

### Phase 2: Core (depends on Phase 1)
- [ ] TASK-3: API endpoints — CRUD operations
- [ ] TASK-4: Frontend integration — connect to API

### Phase 3: Polish (depends on Phase 2)
- [ ] TASK-5: Validation and error handling
- [ ] TASK-6: E2E tests

### Parallel opportunities
- TASK-1 and TASK-2 can run simultaneously
- TASK-3 and TASK-4 can start once their Phase 1 dep is done

### Estimated scope
- Total tasks: 6
- Parallel groups: 3 phases
- Critical path: TASK-1 → TASK-3 → TASK-5
```

For each task, define:
- What to build (not how — that's the developer's job)
- Interface contract (input/output types)
- Acceptance criteria it satisfies
- Which role should do it (python-dev, js-dev, qa-engineer)

## Step 7: Approval presentation template

```markdown
## Feature Plan: [Name]

**Summary:** [1-2 sentences]
**Scope:** [in/out]
**Tasks:** [count] across [phases] phases
**Risks:** [top 1-2 risks with mitigations]
**Dependencies:** [external/internal]

### Acceptance Criteria
[list from Step 5]

### Implementation Plan
[from Step 6]

**Ready to proceed?**
```

Don't start implementation until approved. Plans change; implementation is
expensive.
