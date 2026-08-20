# Coverage contract — how delivered code proves it covers the case

Two sources of truth survive in this pipeline: **the case** (TMS or
`tasks/<suite>/TC-*.md` — TA never edits it) and **the code**. The coverage
contract is the binding between them: every delivered spec declares, in the
code itself, which case steps it asserts and which it excludes — and every
exclusion is checkable. There is no intermediate spec document; the
declaration below is what the reviewer walks and the gate greps.

Two layers, framework-neutral.

## Layer 1 — invariant + baseline grammar (factory-owned)

Every delivered spec file carries, in a comment block (comments exist in every
language):

```
TC-<id> coverage: steps 1-6, 8
TC-<id> excluded: 7 (un-automatable: captcha — no test hook), 9 (covered-elsewhere: test_password_reset_api — email delivery asserted via API)
```

Three invariants:

1. **The case id appears in the test's identity** — title, annotation, or tag,
   per the project's idiom (Layer 2).
2. **Every case step traces to an assertion or an explicit exclusion.** The
   coverage line and the excluded line together partition the case's steps —
   a step in neither is a silent gap, and a silent gap is blocking.
3. **The declaration is machine-findable in this fixed grammar.** One
   `TC-<id> coverage:` line per case id the spec covers (a family spec carries
   one pair per case id); an `excluded:` line only when exclusions exist —
   omitting it declares zero exclusions, and the explicit form
   `TC-<id> excluded: none` (optionally `none — <note>`) parses the same; each
   exclusion is `<step> (<category>: <referent> — <note>)` with the category
   from the closed vocabulary below.

## Closed exclusion vocabulary

Each category REQUIRES a verifiable referent. A category without its referent,
or any free-text reason ("flaky", "hard", "not needed"), is INVALID grammar —
blocking at review and at the gate.

| Category | Required referent |
|---|---|
| `covered-elsewhere` | name of the existing test that asserts it |
| `blocked-by-defect` | filed defect id |
| `un-automatable` | category from automation-scoping's complexity taxonomy |
| `by-seeded-policy` | the policy line in `.agents/testing.md` |

`blocked-by-defect` is also how a known, ticketed defect rides a delivered
spec: the blocked step is excluded against the defect id, the rest of the case
automates with `coverage: partial`, and the spec stays honestly green — the
declaration replaces every masking device (`test.fail()`, skip markers,
weakened assertions), which remain forbidden.

## Layer 2 — idiom (project-owned)

Scout picks the framework idiom at seeding and records it in
`.agents/testing.md § Coverage idiom`. The baseline comment block is ALWAYS
present regardless of idiom — it is what the gate greps; the idiom is what
makes coverage readable in reports and runners.

| Framework | Case identity | Step mapping |
|---|---|---|
| Playwright | case id in the test title or an annotation/tag | `test.step('3. …')` per case step + the header comment block |
| pytest | marker (e.g. `@pytest.mark.case("TC-101")`) or docstring | docstring step list; step comments at each assertion |
| JUnit | `@DisplayName` / `@Tag` carrying the id | `@DisplayName` per nested test, or step comments |
| REST-assured | its JUnit/TestNG host's identity idiom | one request/assert block per step, step-commented |
| k6 | case id in `options.tags` or the header comment | `group('3. …')` per case step |
| Appium | the host framework's idiom (JUnit / pytest rows above) | screen-step comments or nested tests per step |

## Enforcement — who checks what

**The reviewer walks; the gate greps.** Split deliberately: judgement to the
review, mechanics to the script.

**Reviewer** ([`reviewer-contract.md`](reviewer-contract.md)) — walks the case
step by step against the code: every step has a real assertion at that step or
a valid exclusion; a silent gap is blocking. Every referent is **touched**,
not eyeballed — run (or open) the named covering test, open the defect, check
the taxonomy category, read the policy line. And every `un-automatable`
exclusion is cross-checked against the intake screening verdicts
(`.agents/estimation/<slug>-verdicts.json`): the engineer cannot mint
un-automatability the screening didn't see — only request it, with escalation
to the lead.

**Gate** — the mechanical part, per spec file: a coverage line exists for
every case id the unit claims, excluded lines parse, categories are from the
closed vocabulary. It reads the grammar, never the case body.

**Back-write** — the coverage declaration is what the TMS close sweep reports:
case status plus a coverage note (`full | partial` and the excluded steps with
their categories/referents). See [`tms-adapters.md`](tms-adapters.md) § Dual-write
policy.
