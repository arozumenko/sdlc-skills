---
name: plan-feature
description: Structured feature planning workflow. Use when the user says "plan a feature", "design this", "how should we build", "feasibility check" — or before writing code for any non-trivial feature: plan first, build second. Covers requirements, investigation, feasibility, and implementation planning.
license: Apache-2.0
metadata:
  author: octobots
  version: "0.1.0"
---

## Feature Planning: Understand → Investigate → Plan → Approve

**Core philosophy:** plan before you build. The cheapest bugs are the ones
you prevent during planning.

## The seven steps

```
1. Understand the request
2. Investigate current state
3. Clarify unknowns
4. Feasibility analysis
5. Define acceptance criteria
6. Implementation plan
7. Get approval
```

### 1. Understand the request

Know exactly what's being asked before investigating. Ask yourself:

- **What** is being requested? (feature, change, improvement)
- **Who** benefits? (end user, developer, ops)
- **Why** now? (business driver, user feedback, tech debt)
- **What does done look like?** (measurable outcome)

If the request is vague, ask clarifying questions *before* investigating —
don't dig into code for a direction that might change.

### 2. Investigate current state

Understand what exists before proposing changes. Grep for relevant terms,
read existing implementation, look for patterns to follow and code to reuse,
check git history for prior context. Document what already exists, what needs
to change vs. what's new, existing patterns, and technical constraints.

### 3. Clarify unknowns

Resolve ambiguity before committing to a plan. Common unknowns: scope,
integration, performance, security, edge cases. When presenting options to
the user, lay out the trade-offs — don't force a pick without context.

### 4. Feasibility analysis

Assess effort, risk, and trade-offs. Build an impact table (area → impact →
files affected), a risk table (risk → likelihood → impact → mitigation), and
a dependency list (external, internal, blocking).

### 5. Define acceptance criteria

Testable definition of done, in Given/When/Then format. Every AC must be
pass/fail — no "should be intuitive." Cover happy path, error cases, and
edge cases. Include performance criteria when relevant.

### 6. Implementation plan

Ordered list of tasks with dependencies, grouped into phases. For each task
define: what to build (not how — that's the developer's job), interface
contract, acceptance criteria it satisfies, and which role owns it
(python-dev, js-dev, qa-engineer). Call out parallel opportunities and the
critical path.

### 7. Get approval

Alignment before implementation begins. Present summary, scope, task count,
top risks, dependencies, acceptance criteria, and the plan. Ask explicitly:
"Ready to proceed?" Don't start implementation until approved — plans are
cheap, implementation is expensive.

## Templates & recipes

All the investigation commands, feasibility table layouts, AC format, plan
template, and approval presentation live in
[references/templates.md](references/templates.md). Load that file when you
need the exact format.

## Anti-Patterns

- Don't plan in a vacuum — investigate the codebase first
- Don't propose solutions without understanding constraints
- Don't skip acceptance criteria — they're the contract with the developer
- Don't create monolithic tasks — break into parallel-friendly pieces
- Don't assume requirements — ask when ambiguous
