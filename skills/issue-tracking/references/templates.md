# Issue Templates

## Bug Report

```markdown
## [SEVERITY] Bug title

**Environment:** Production / Staging / Local
**Version:** v1.2.3 or commit SHA
**Browser:** Chrome 120 / Firefox / Safari (if UI)

### Steps to Reproduce
1. Navigate to /page
2. Click "button"
3. Enter "value"

### Expected Behavior
What should happen.

### Actual Behavior
What happens instead.

### Evidence
- Screenshot: [attached]
- Console: `Error message`
- Network: `POST /api/x returned 500`

### Frequency
Always / Intermittent (3/5 attempts) / Once

### Workaround
None / Description
```

## Task

```markdown
## Task: Title

**Parent:** #100 [EPIC] Feature Name
**Assigned to:** @username
**Complexity:** small / medium / large

### Objective
One sentence: what this task accomplishes.

### Context
Why this exists in the epic.

### Requirements
- [ ] Functional requirement 1
- [ ] Technical requirement 1

### Interface Contract
**Input:** request shape / function args
**Output:** response shape / return type

### Definition of Done
- [ ] Code compiles
- [ ] Tests pass
- [ ] PR reviewed
- [ ] QA verified
```

## Epic

```markdown
## [EPIC] Feature Name

### Overview
One paragraph: what + why + who benefits.

### Business Value
What problem this solves for users.

### Scope
**In scope:**
- Deliverable 1
- Deliverable 2

**Out of scope:**
- Explicitly deferred item

### Architecture
Brief technical approach. Link to ADR if significant.

### Tasks
| # | Title | Assignee | Dependencies | Complexity |
|---|-------|----------|--------------|------------|
| 101 | Foundation | @dev | none | small |
| 102 | Core feature | @dev | #101 | medium |
| 103 | QA verification | @qa | #102 | small |

### Acceptance Criteria
- [ ] Testable criterion 1
- [ ] Testable criterion 2

### Dependencies
- External: API X available
- Internal: Module Y updated
```

## Workflow States

```
Backlog → Ready → In Progress → Review → QA → Done
                       ↓
                    Blocked → (unblock) → In Progress
```
