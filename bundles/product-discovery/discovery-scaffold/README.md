# Discovery Pipeline

This is the seed layout for `docs/discovery/` — installed empty into a
consumer project by the `product-discovery` bundle. It holds the working
record for the Product Owner discovery loop: raw ask in, verified and
prioritized hypothesis out, ready to hand off to engineering.

## The loop

1. **Raw ask** — an unstructured request, complaint, or idea lands in
   `evidence/intake/`.
2. **Problem** — the ask is framed as a `problems/PRB-NNN-*.md` record: who
   hurts, what hurts, why it matters.
3. **Personas / journeys** — `personas/` and `journeys/` capture the people
   and flows a problem touches, referenced by role, not by name.
4. **Hypothesis** — a testable bet on how to address the problem is recorded
   in `hypotheses/HYP-NNN-*.md`.
5. **Outcome** — if the hypothesis is worth committing to, a dated,
   ratifiable anchor is added to `outcomes.md`.
6. **Prioritize** — competing hypotheses and outcomes are weighed against
   each other; the call is recorded in `decisions.md`.
7. **Verify** — evidence for or against a hypothesis is gathered in
   `evidence/research/`, `evidence/interviews/`, and `evidence/verifications/`,
   with what was learned distilled into `evidence/learnings/`.
8. **Handoff** — a promoted hypothesis with a ratified outcome is handed to
   the `ba` role to become groomed backlog work.

## Folders

| Folder | Holds |
|---|---|
| `problems/` | `PRB-NNN` problem records |
| `personas/` | Persona sketches referenced by problems/journeys |
| `journeys/` | User/customer journey maps |
| `hypotheses/` | `HYP-NNN` hypothesis records |
| `evidence/intake/` | Raw, unprocessed asks awaiting framing |
| `evidence/interviews/` | Interview notes and summaries |
| `evidence/research/` | Desk research, market/competitive material |
| `evidence/verifications/` | Evidence gathered to test a specific hypothesis |
| `evidence/learnings/` | Distilled takeaways from verification |
| `outcomes.md` | Ratification-gated outcome register |
| `decisions.md` | Append-only decision log |

## Hypothesis status

A hypothesis's lifecycle lives in its own frontmatter, not in folder
placement:

```yaml
status: incubating   # incubating | promoted | parked
```

- `incubating` — still being shaped or tested.
- `promoted` — outcome ratified, ready for handoff to `ba`.
- `parked` — set aside; evidence didn't support it or priorities shifted.

## ID conventions

| Prefix | Record | Example |
|---|---|---|
| `PRB-NNN` | Problem | `PRB-001` |
| `HYP-NNN` | Hypothesis | `HYP-001` |
| `DEC-NNN` | Decision | `DEC-001` |

IDs are zero-padded, sequential, and never reused.

## Confidential material

`_inbox/` is a manual convention for raw, person-named notes (transcripts,
unredacted interview scratch) that should never be committed. It is
gitignored. There is no hook enforcing this — before promoting anything out
of `_inbox/` into a committed record, redact names and refer to people by
role instead.
