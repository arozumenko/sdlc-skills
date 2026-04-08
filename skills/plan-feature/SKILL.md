---
name: plan-feature
description: Structured feature planning workflow. Use when the user says "plan a feature", "design this", "how should we build", "feasibility check", or any pre-implementation planning work. Covers requirements, investigation, feasibility, and implementation planning.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.1.0"
---

## Feature Planning: Understand → Investigate → Plan → Approve

Core philosophy: **plan before you build. The cheapest bugs are the ones you prevent during planning.**

## Workflow

```
Step 1: Understand the Request
         ↓
Step 2: Investigate Current State
         ↓
Step 3: Clarify Unknowns
         ↓
Step 4: Feasibility Analysis
         ↓
Step 5: Define Acceptance Criteria
         ↓
Step 6: Implementation Plan
         ↓
Step 7: Get Approval
```

## Step 1: Understand the Request

**Goal:** Know exactly what's being asked before investigating.

Ask yourself:
- **What** is being requested? (feature, change, improvement)
- **Who** benefits? (end user, developer, ops)
- **Why** now? (business driver, user feedback, tech debt)
- **What does done look like?** (measurable outcome)

If the request is vague, ask clarifying questions BEFORE investigating:
- "When you say X, do you mean A or B?"
- "Is this for all users or a specific role?"
- "What's the expected scale? 10 users or 10,000?"

## Step 2: Investigate Current State

**Goal:** Understand what exists before proposing changes.

```bash
# Find relevant code
grep -rn "related_term" src/ --include="*.py" -l
grep -rn "related_term" src/ --include="*.ts" -l

# Read existing implementation
# Look for: patterns to follow, constraints to respect, code to reuse

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

## Step 3: Clarify Unknowns

**Goal:** Resolve ambiguity before committing to a plan.

Common unknowns:
- **Scope:** "Does this include X?" → ask
- **Integration:** "Does this need to work with Y?" → investigate
- **Performance:** "How fast does this need to be?" → ask
- **Security:** "Who should have access?" → ask
- **Edge cases:** "What happens when Z?" → document assumption or ask

If asking the user, present options:
> "For the search feature, I see two approaches:
> A) Full-text search via PostgreSQL — simpler, no new deps
> B) Elasticsearch — faster for large datasets, needs infra
> Which fits our needs?"

## Step 4: Feasibility Analysis

**Goal:** Assess effort, risk, and trade-offs.

### Impact Assessment

| Area | Impact | Files Affected |
|------|--------|---------------|
| API | New endpoints | `src/api/routes.py` |
| Database | New table | `migrations/`, `src/models.py` |
| Frontend | New page | `components/`, `pages/` |
| Tests | New test suite | `tests/test_feature.py` |

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| [risk] | Low/Med/High | Low/Med/High | [mitigation] |

### Dependencies
- External: APIs, services, libraries
- Internal: other features, shared code
- Blocking: what must be done first

## Step 5: Define Acceptance Criteria

**Goal:** Testable definition of done.

Write in Given/When/Then format:

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

Rules:
- Every AC must be testable (pass/fail, no "should be intuitive")
- Include happy path, error cases, and edge cases
- Include performance criteria if relevant ("loads in under 2s")

## Step 6: Implementation Plan

**Goal:** Ordered list of tasks with dependencies.

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

## Step 7: Get Approval

**Goal:** Alignment before implementation begins.

Present to the user/PM:
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

Don't start implementation until approved. Plans change — implementation is expensive.

## Anti-Patterns

- Don't plan in a vacuum — investigate the codebase first
- Don't propose solutions without understanding constraints
- Don't skip acceptance criteria — they're the contract
- Don't create monolithic tasks — break into parallel-friendly pieces
- Don't assume requirements — ask when ambiguous
