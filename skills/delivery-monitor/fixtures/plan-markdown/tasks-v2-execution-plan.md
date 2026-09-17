# excerpt — real execution-plan block (verbatim) for the importer regression test

## 1. Execution plan

```
G0   001 docs (M-1)                                   055 hook probe (independent, any time)
G1   003 normalize · 004 redact · 005 schemas · 056 offline harness
G2   002 canon (needs 004: writeArtifact → redactDeep)
G3   006 skeleton+version.json · 007 engagement parser+templates · 026 evaluate (pure) + verify.json fixtures
G4   009 keys · 011 engagement init step 0 · 028 register core
G5   010 baseline · 012 run init/ledger (+ empty assessment inputs) · 029 transitions (+ ticketed)
G6   008 engagement init pipeline+validate · 013 scope · 015 import store · 030 consume-verdict
     032 purge · 058 run snapshot register|verify|proposals · 059 register render
G7   014 cite · 017 ingest tracker-side · 018 ingest qa-side · 020 coverage · 057 packet core + scope packet
G8   016 ingest sarif
G9   019 gate
G10  021 subject packet
G11  022 receipt validate|apply + states
G12  023 build-report core + review template · 034 secure-code-review skill
G13  027 verify all (two-pass) · 031 publish + check-export · 036 security-reviewer agent
G14  024 assessment/verify/threat-model templates
G15  025 check
G16  033 sign-off
G17  035 security-engagement skill
G18  037 M1 manifest / FACTORY.md / README / instructions
G19  038 installed E2E, both shapes                                     ← M1 done
G20  039 tm-lint + threat-modeling (M2) · 045 tracker readback + fix route (M3) · 046 risk-register skill (M3)
G21  040 threat-modeler agent · 041 sign-off disposition policy
G22  042 plan.mjs admit|propose + planning skill
G23  043 admitted suite (case/handoff profiles) · 051 execution-authorization note (M4)
G24  044 observations + TA
G25  047 security-lead agent
G26  048 final manifest + E2E roster extension
G27  049 manual-qa PR · 050 feature-development PR · 052 catalog/marketplaces
G28  053 smoke
G29  054 dogfood
```

## 5. Technical tasks

#### TASK-001: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-002: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-003: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-004: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-005: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-006: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-007: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-008: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-009: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-010: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-011: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-012: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-013: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-014: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-015: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-016: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-017: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-018: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-019: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-020: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-021: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-022: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-023: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-024: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-025: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-026: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-027: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-028: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-029: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-030: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-031: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-032: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-033: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-034: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-035: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-036: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-037: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-038: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-039: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-040: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-041: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-042: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-043: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-044: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-045: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-046: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-047: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-048: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-049: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-050: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-051: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-052: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-053: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-054: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-055: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-056: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-057: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-058: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

#### TASK-059: t
**Story:** US-001 · **Assigned:** js-dev · **Depends on:** none · **Complexity:** S

