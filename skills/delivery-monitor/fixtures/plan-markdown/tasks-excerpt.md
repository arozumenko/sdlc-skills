# excerpt — technical decomposition

## 1. Execution plan

Dependency graph first.

```
G0   001 docs (M-1)                                   055 hook probe (independent, any time)
G1   003 normalize · 004 redact
G2   002 canon (needs 004: writeArtifact → redactDeep)
G6   008 pipeline · 013 scope
     032 purge · 058 run snapshot register|verify|proposals
G7   012 run init/ledger (+ empty assessment inputs) · 029 transitions (+ ticketed)
```

### Parallel groups

| Group | Tasks |
|---|---|
| G0 | 001, 055 |

## 5. Technical tasks

#### TASK-001: Repo docs match the installer
**Story:** US-001 · **Assigned:** maintainer / js-dev · **Depends on:** none · **Complexity:** S

#### TASK-055: Hook-input probe result
**Story:** US-030 · **Assigned to:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-003: `normalize.mjs` + published test vectors
**Story:** US-002 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** M

#### TASK-004: `redact.mjs` + `redaction-rules.json` v1
**Story:** US-003 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** M

#### TASK-002: `canon.mjs` — strict reader
**Story:** US-002 · **Assigned:** js-dev · **Depends on:** TASK-004 · **Complexity:** L

#### TASK-008: pipeline
**Story:** US-004 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** L

#### TASK-013: scope
**Story:** US-004 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** M

#### TASK-032: purge
**Story:** US-005 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-058: run snapshot
**Story:** US-005 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** M

#### TASK-012: run init/ledger
**Story:** US-006 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** M

#### TASK-029: transitions
**Story:** US-006 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-099: Orphan task not in any group
**Story:** US-009 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S
