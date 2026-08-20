# Tech-task brief — the unit contract for work that isn't a case

A TMS case enters the pipeline with an AFS: a spec grounded in live execution
that the reviewer triangulates against and the gate proves. A **technical
unit** — a tech-debt item, a stable-handle migration, a reporting improvement,
a config fix, a suite-health repair that outgrew a single dispatch — has no
case and no AFS, and without a written equivalent the reviewer has nothing
objective to tick and the gate has no defined run set. The **brief** is that equivalent:
one markdown file per unit, written before the build dispatch, gated by the
orchestrator exactly like AFS quality.

Where the AFS is grounded in *executing the case live*, the brief is grounded
in *reading the actual code and the actual failure*. Scope comes from
enumeration, not from the issue title: "finish the testid migration" becomes a
brief only after someone has listed what is actually left to migrate. When that
enumeration needs real investigation (a survey across specs, a reproduce run),
that IS the unit's investigation step — dispatch it, and its output lands in
the brief before anything is built. The orchestrator writes trivial briefs
directly (an atomic fix is a paragraph); anything needing a survey is dispatch
material (Critical rule 7 — payloads stay with slots).

**Where it lives:** `.agents/automation/<slug>/briefs/<unit-id>.md`, committed
where the work lands (the batch trunk; the unit branch for a batch of one) —
same rule as the AFS, and for the same reason: the plan survives an interrupted
run, and the reviewer reads it from disk, not from your context.

## Required sections

A brief missing any of these is `blocked`, not dispatchable — the mirror of
the AFS quality gate.

1. **Source** — where the unit came from: the tracker item (id + URL), or the
   operator's ask quoted verbatim. This is the close sweep's back-write target;
   an unit with no recorded source can't report back.
2. **Scope** — the concrete change: which files / components / behaviours, and
   the approach where it isn't obvious. Grounded in the code as it is today —
   enumerated, not paraphrased from the source item.
3. **Out of scope** — named explicitly, with where the excluded work lives
   instead (an existing item, a new finding). This is what keeps the build
   dispatch from wandering: adjacent debt spotted mid-build becomes a
   `finding`, never silent scope creep.
4. **Acceptance criteria** — at least one checkable statement per unit. These
   are what the reviewer ticks (the brief sits where the AFS sits in the
   reviewer's triangle: source item ↔ brief ↔ diff) and what the close sweep
   verifies before the back-write.
5. **Blast radius** — what this unit *changes*, symbol by symbol, and the
   specs that reach those symbols. Scope by change, not by touch: an additive
   change to a shared file (a new method or handle nothing existing calls) has
   no blast radius; modifying or deleting an existing symbol pulls in every
   spec that reaches it (one hop through shared helpers) — never "every spec
   importing the file". This literally becomes the gate's run set, selected by
   spec/node-id. "None" is a claim to argue (nothing existing modified), never
   a default.
6. **Verification** — how this unit is proven: which specs/suite must run
   green, and — when the unit fixes a bug — the regression test that would
   have caught it. Optional `estimate` (effort band) — feeds scoping /
   tokenomics (WIP) where the project tracks it.

## Example

One instance — a UI suite migrating to stable handles. The shape is
surface-agnostic: a real brief names this project's actual files and handles,
whatever the stack. On an API suite the same sections name client modules and
response fields; on mobile, screen objects and accessibility ids; the ids and
paths below are placeholders, not a convention.

```markdown
# Brief: migrate the checkout page object off fallback locators

**Source:** issue #412 — "[Tech-debt] Checkout page object uses fallback-only
locators, no stable handles".

**Scope:** replace the 9 brittle CSS-fallback locators in the checkout page
object with the stable handles the app now exposes (enumerated below — from
reading the page object, not the issue). No behaviour change, no new specs.

**Out of scope:** the two components that don't expose a stable handle yet
(issue #430) — their locators keep the fallback with a
`// stable handle pending #430` note.

**Acceptance criteria:**
- no CSS-fallback locator remains in the checkout page object except the two
  noted above
- every replacement handle was observed in the live app or the component
  source — not guessed from naming conventions

**Blast radius:** the 9 locators are *existing* symbols being modified, so
every spec that reaches them — the 5 specs using the checkout page object.
(Had this unit only *added* new handles alongside the old ones, the radius
would be none.)

**Verification:** those 5 specs, green N× in the hardening gate. No new specs.
```

Everything downstream is unchanged: build → static review (fix rounds to
APPROVED, same stop conditions) → merge to the trunk → one hardening gate over
the batch — with the gate's N× set drawn from the briefs' blast radii plus any
new or changed specs. The report uses the same seven-outcome vocabulary
(`automated` reads "proven and landed"), and the close sweep back-writes the
**Source** item per the seeded write policy instead of a TMS execution. Full
routing: [`orchestration-playbook.md`](orchestration-playbook.md) § The same
loop runs work that isn't a case.
