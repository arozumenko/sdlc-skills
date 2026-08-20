# Digest format

The parser emits markdown, one section per analyzed session:

```
## Session <id> — <date>  (branch: <b>, <Nu> user / <Na> assistant turns, ~<min> min)
Skills/plugins seen: <comma-separated attribution set>

### Sub-agents (<total>)
- <agentType> — <n> dispatch(es), <n> with errors, median <n> turns (max <n>)

#### Repeated identical dispatches (<n>) — same agent type, same prompt, more than once
- <n>x <agentType> — "<prompt excerpt>"

#### Turn outliers (>=3x the median for their type)
- <agentType> — <turns> turns, <errors> errors — "<prompt excerpt>"

#### Failure-shaped returns (<n> distinct)
- <n>x <returned result, digits blanked>

#### Returned outcomes (<n> distinct shapes)
- <n>x <returned result, digits blanked>

### Signals
- Tool errors: <Tool>: error ×<count>
- Retry/loop: <Tool> on <target> ×<count>
- File churn: <path> edited ×<count>
- Interrupts: human stopped the agent ×<count> (turns <n>, <n>, …)
- Candidate corrections (<shown> strongest of <found>):
  - [<kind>] "<short quoted user turn>" (turn <n>)
```

A session with none of the above shows `- (no notable signals)`. The digest is
bounded: quotes truncated to 200 chars, max 12 corrections/session, file churn
only listed at ≥4 edits, and sub-agents are **rolled up, never listed one by
one** (one campaign produced 761). Signals are **extracted, not interpreted** —
judgment is the agent's job.

The header states which languages correction detection covers. Read it before
concluding a quiet session was a good one — see `signal-taxonomy.md`.

## Sub-agent sections: what they are for

`Candidate corrections` and `Interrupts` both need a human at the keyboard — in
an unattended run (a workflow, or a plain sub-agent dispatch) they are always
empty. These four sections are their equivalents, and none of them needs a
human, a board, or knowledge of any bundle's schemas:

- **Repeated identical dispatches** — a byte-identical prompt sent to the same
  agent type more than once. Reported as a fact, not judged: a clerk invoked 24x
  with one prompt is routine, an analyst invoked twice on one case is waste, and
  the transcript cannot tell them apart. You can.
- **Turn outliers** — an agent that took ≥3x the median for its type. Where a
  run went sideways without necessarily erroring.
- **Failure-shaped returns** — returns whose text reads like a failure
  (`blocked`, `unable`, `limit`, `not found`…). Matched on plain English, not on
  field names, so it works whatever the caller's schema. This is where an
  account ceiling or a missing env file surfaces: one campaign returned
  "You've hit your session limit" 151 times.
- **Returned outcomes** — every return, with digit runs blanked so per-case
  values (ids, PR numbers, branches) collapse into shapes. This is the only
  section carrying what an agent actually *said*, which is where domain gotchas
  live — the other signals see the shape of a run, never its content.
