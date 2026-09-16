# The anchor

The register's event log (`<st>/register/events.jsonl`) is hash-chained:
every event carries the sha256 of the previous one, the first carries 64
zeros, and the hash of the last event is the chain's fingerprint. The anchor
is that fingerprint with its position and its engagement:

```
<engagement_id>:<seq>:<chain_sha256>
```

`register.mjs anchor print` prints it, bare, so it can be pasted:
`<engagement_id>:<seq>:<chain_sha256>`. It names one exact state of the log:
the engagement, how many events there were, and the hash the chain had
reached.

## Where to keep it: outside the repository

The register directory is inside the managed `.gitignore` block, on the
operator's disk, and anyone with write access can rewrite `events.jsonl` and
re-chain it — the chain proves internal consistency, not who wrote it. An
anchor kept next to the log is rewritten with it. So the anchor's value comes
from being held by someone else, somewhere else:

- paste it into the tracker ticket that records the sign-off, or into the
  message that accompanies the report the consumer receives (an assessment
  report's register section prints the snapshot's engagement, `seq` and
  `chain_sha256` — the anchor of the state *at snapshot time*, which is
  behind the final state whenever the register moved after
  `run snapshot register`);
- hand it to the consumer in the message that closes the engagement, and
  tell them what it is for: "keep this outside the repo; a later sign-off with
  `--expect` this value proves the register is the one you were shown";
- never commit it into the repository whose register it witnesses, and never
  store it under `<st>/`.

Print it **after the last register change** of the engagement — every
`add`, `accept`, `revoke`, `check`, `close-false-positive`, `reopen`,
`supersede`, `consume-verdict` and every tracker read-back appends an event
and moves the chain. An anchor printed before the final change will read as
`DIVERGED` afterwards, which is correct and useless. The rendered view
(`register.mjs render`) shows the anchor of the state it was rendered from.

## Verifying

`register.mjs anchor verify --expect <engagement_id:seq:hash>` compares the
live register with a held anchor, and
`evidence.mjs sign-off --engagement <engagement_id> --expect <anchor>` does the
same as one of its checks (a mismatch fails the sign-off). The answers:

| Answer | Meaning | What to do |
|---|---|---|
| `MATCH` (exit 0) | `seq` and `chain_sha256` both equal: the log is exactly the anchored state | nothing; say "register matches anchor `<seq>`" |
| `TRUNCATED` (exit 5) | the log is shorter than the anchored `seq`: events were removed | report it; the held anchor is the evidence — do not "repair" the log |
| `DIVERGED` (exit 5) | not the anchored state at that length: a rewritten history, another engagement's register, or a log that legitimately advanced past the anchor | check `seq`: if the register moved on since the anchor was printed, print a fresh anchor and hand it over; if `seq` is the same or the engagement differs, report it |

The recovery rule runs first on every command: a projection ahead of the log
or a broken chain is `5 CORRUPT`, and `CORRUPT` beats any comparison —
there is no state to compare.

## What the anchor does not cover

The alias log (`<st>/register/finding-alias.jsonl`) is chained the same way
but is not part of the anchor's preimage; `register.mjs replay` and every
command verify its chain, and `run snapshot register` copies it into the run
next to the events. If an equivalence matters to a reader, name the alias
line (`ALIAS from=<id> to=<id> seq=<n>`) in the report text.

The anchor witnesses the register, not the runs: a run's own identity is its
`manifest.json` and `COMMITTED` marker (`evidence.mjs check`). Both together
are what `sign-off` checks; neither is an approval of anything.
