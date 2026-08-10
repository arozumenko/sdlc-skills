# Signal taxonomy

What the parser extracts (thresholds in `distill-sessions.mjs` constants):

| Signal | Definition | Threshold |
|---|---|---|
| Tool error | a `tool_result` with `is_error`, name-correlated via `tool_use_id` | any |
| Retry/loop | same tool + same primary target within a 6-call window | ≥1 repeat |
| File churn | one `file_path` edited via Edit/Write/NotebookEdit | ≥4 edits |
| Candidate correction | user turn after assistant activity matching a scored correction pattern; labelled with its kind | ≤12/session, ranked |
| Interrupt | the human stopped the agent mid-flight (`[Request interrupted by user]`) | any |

## Correction kinds

Each candidate carries a kind, so a list of twelve can be triaged without
re-reading twelve sessions. Roughly strongest to weakest:

| Kind | What it means | Typical follow-up |
|---|---|---|
| `reversal` | undo what you just did | the change was wrong, not just imperfect — look at what led to it |
| `prohibition` | don't do that / never do that | often a standing preference the team never wrote down |
| `wrong` | that is not right / not what I asked | a comprehension gap: check whether the brief was ambiguous |
| `missed` | you forgot, skipped, broke something | usually context the role did not have |
| `redirect` | actually, do it the other way | a change of mind as often as a mistake — weigh carefully |
| `challenge` | are you sure? / why not X? | the weakest signal, and the most likely to be a genuine question |

## Coverage and its limits

**Detection covers English.** A session held in another language will produce
few or no candidates no matter how many corrections it contained — and it will
look identical to a session that went perfectly. Before concluding "few
corrections, the sessions went well", check what language they were held in.
The other signals (tool errors, retries, churn, interrupts) are
language-neutral, so a session with plenty of those and no corrections is a
strong hint the detector is the thing that's blind.

If your team works in another language, extend `CORRECTION_TIERS` in
`distill-sessions.mjs` — the matcher's word boundaries are already
Unicode-aware, so non-Latin alternatives work correctly — and update the
coverage line the digest prints, which exists precisely so a reader can tell a
quiet list from a blind one.

Corrections are **ranked, then capped**, not taken in order of appearance: a
loose matcher with a fixed budget has to spend it on its strongest hits. The
digest says `(12 strongest of 37)` when it dropped some.

Deliberately excluded, because each one attributes words to the human that the
human did not type: harness envelopes (`<system-reminder>`, `<task-notification>`,
slash-command blocks), the compaction summary (which quotes the whole session
back, including its corrections), pasted code, and anything over 500 characters
— a correction is a reaction, and reactions are short.

## How to read them

- **Tool errors / retries** → friction or a missing convention. Ask: would a
  note in a role briefing or `workflow.md` have prevented the loop?
- **File churn** → thrash. Often a sign the role lacked context the briefing
  could carry.
- **Candidate corrections** → the richest source of durable lessons, but
  noisy. A correction is only a finding if it generalizes beyond the one turn.
- **Interrupts** → the sharpest efficiency signal there is: a human watched
  work happen and paid to stop it. Each one is tokens spent going the wrong
  way. Look at what the agent was doing in the turns just before.

Signals are evidence, not findings. Promote a signal to a finding only when it
recurs or clearly generalizes, and always keep its session id as evidence. When
a finding recurs across sessions *and* a previous retrospective already wrote it
down, see `finding-to-target.md` — that is the point where more prose stops
being the answer.
