# Quality Engineering Team

A **manual quality-engineering discipline** team — governance and coverage,
not run execution. The team treats requirement quality and traceability as the
product: it triages stories for testability *before* anyone authors a case,
authors manual cases that each trace to a requirement, runs them by hand,
reports results, and then closes the loop by triangulating
**requirement ↔ case ↔ result** to expose coverage gaps. There is no test
automation here — no Playwright framework, no generated test code. This is the
discipline that decides *what good coverage even means* and proves you have it.

> **Not** the `web-qa` team. `web-qa` is a run-**execution** machine — it
> authors, sizes, and runs cases live via Playwright MCP and writes run
> reports. `quality-engineering` is the **governance/coverage** discipline —
> requirement testability, manual execution, and the requirement ↔ case ↔
> result coverage matrix. Use `web-qa` to *run a suite*; use
> `quality-engineering` to *govern requirement quality and prove coverage*.

## Install

```bash
npx github:arozumenko/sdlc-skills init --bundle quality-engineering
```

Installs the 5 agents below into your IDE (`.claude/`, `.cursor/`, …), pulls
each agent's skills, seeds per-role briefings into `.agents/memory/<role>/`,
and splices the team conventions into `AGENTS.md` / `CLAUDE.md`.

## Roster

| Role | Alias | Group | Does |
|---|---|---|---|
| `project-manager` | max | core | **The orchestrator** — runs the QE pipeline (triage → author → execute → report → triangulate), owns the QE gate, dispatches every other role and routes their reports |
| `quality-architect` | quinn | qa | **QE standard-owner** — story triage (testability / ambiguity / missing criteria → gaps & questions for the BA), requirement ↔ case ↔ result triangulation, the quality bar and severity rubric, plus dimensional audits (a11y / security / privacy / performance / responsive / content-SEO / UX) and persona review |
| `qa-engineer` | sage | qa | **Manual author + executor + reporter** — authors manual cases that trace to a requirement, runs them by hand, logs defects, and writes run reports. No automation |
| `ba` | alex | core | Owns requirements and acceptance criteria; receives Quinn's triage gaps & questions and resolves them |
| `scout` | kit | core | Onboards the app/repo for QE — generates the project config and per-role briefings the team boots from |

## How this team works

This is a **PM-orchestrated** team. There is no agent-to-agent handoff: every
role reports back to the **project-manager** (Max), and Max routes the work to
the next role. You talk only to Max. The pipeline runs in five stages, and Max
owns the QE gate across all of them:

1. **Triage** (`quality-architect`). Before any case is authored, Quinn reviews
   the requirements/stories for **testability** — ambiguity, missing or
   contradictory acceptance criteria, untestable claims, hidden assumptions —
   and emits a **Requirement gaps & questions** report. Max routes it to `ba`
   (Alex), who resolves the gaps with the PO. **Gate:** don't author cases
   against un-triaged requirements.
2. **Author** (`qa-engineer`). Once requirements are clean, Sage authors
   **manual** test cases. Every case **traces to a requirement** — that link is
   what makes triangulation possible later.
3. **Execute** (`qa-engineer`). Sage runs the cases **by hand** against the
   current build and logs defects. No automation, no framework, no Playwright.
4. **Report** (`qa-engineer`). Sage writes the run report — what passed, what
   failed, the evidence behind each result.
5. **Triangulate** (`quality-architect`). Quinn builds the
   **requirement ↔ case ↔ result coverage matrix** and surfaces the gaps Max
   gates on.

### Requirement ↔ case ↔ result triangulation

The signature move of this team. Quinn (via the **`requirement-traceability`**
skill) cross-references three inputs — **requirements** (BA stories / docs / a
matrix imported via `xlsx-reader`), **cases** (TC files or xlsx), and
**results** (run reports / TMS) — into one coverage matrix, then reports
findings on a p0–p3 schema across four gap classes:

1. **Uncovered requirement** — a requirement with no case (p0/p1).
2. **Orphan case** — a case tracing to no requirement (waste / scope creep).
3. **Stale result** — a case not executed against the current build
   (an untrustworthy green).
4. **Contradiction / weak evidence** — a case "passes" but the evidence
   doesn't actually prove the requirement.

This is what separates a green dashboard from *real* coverage: a passing run
that doesn't trace to a requirement, or traces to one but doesn't prove it, is
a gap — and this team makes it visible.

## What this bundle adds

- **Agents + skills** — the 5 roles above and their declared skills.
- **Instructions** — [`instructions.md`](instructions.md) → spliced into `AGENTS.md` / `CLAUDE.md`.
- **Briefings** — QE overlays in [`briefings/`](briefings/) → seeded into `.agents/memory/<role>/project_briefing.md` (scout refines them per project).
- **The `requirement-traceability` skill** — bundle-owned, overlaid onto `quality-architect`. It carries the two ends of the discipline: **Phase 0 — story triage** (testability review → gaps & questions report for the BA) and **Phase 1 — triangulation** (the requirement ↔ case ↔ result matrix + four gap classes). Pairs with `xlsx-reader` (requirement matrices arrive as Excel) and `verifying-outcomes` (goal-backward evidence check).
- **Skill overlay** — `requirement-traceability` added to `quality-architect`'s `skills:` so the installed copy owns triage + triangulation. No automation skills are added to `qa-engineer` — this is a deliberately manual discipline.
- **Hooks** — _(none)_.

See [`bundle.json`](bundle.json) for the exact manifest and the top-level
[`../SPEC.md`](../SPEC.md) for how bundles are defined and installed.
