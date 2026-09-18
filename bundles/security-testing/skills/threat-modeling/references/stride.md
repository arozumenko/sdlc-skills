# STRIDE per element

One threat is `{id, element_id, stride, title, mitigations, disposition}`:
one element, one letter, one effect. The letter is a category for
coverage, the title is what a reader remembers, so write the effect
("order total tampered in transit"), not the category ("tampering").

## The six letters

| Letter | Property violated | Question to ask of the element |
|---|---|---|
| `S` spoofing | authentication | can something claim to be this caller, this service, this signer? |
| `T` tampering | integrity | can the data this element holds or carries be changed by someone who should not? |
| `R` repudiation | non-repudiation | can an action here be denied later — no log, a forgeable log, a log without the actor? |
| `I` information disclosure | confidentiality | can this element leak what it holds, carries or errors on? |
| `D` denial of service | availability | can this element be exhausted, blocked or made to fail for everyone? |
| `E` elevation of privilege | authorization | can a caller do more through this element than its role allows? |

## Which letters apply to which kind

Enumerate only the cells marked; a threat outside them is usually a
threat against a neighbouring element, and moving it there keeps the
model honest.

| kind | S | T | R | I | D | E |
|---|---|---|---|---|---|---|
| `external` | ✓ | | ✓ | | | |
| `boundary` | ✓ | ✓ | | ✓ | ✓ | ✓ |
| `process` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `datastore` | | ✓ | ✓ | ✓ | ✓ | |
| `flow` | | ✓ | | ✓ | ✓ | |

(An `external` cannot be tampered with or exhausted from inside the model
— those threats belong to the `flow` or `boundary` that touches it; a
datastore is not spoofed, the process that trusts its contents is.)

## One threat, one effect

Split when the effects differ even if the letter is the same: "export
returns every column" (`I`) and "export error includes the SQL" (`I`) are
two threats of the same `datastore` because they are disposed
differently. Merge when only the wording differs.

## Title rules

- Non-empty, one line, indicative mood, names the asset and the effect
  (`TM-INVALID <id>: empty title` otherwise).
- No severity words: how urgent a threat is belongs to whatever the lead
  ties it to with `accepted(R-nnnn)` — a `risk-register` row — never to
  the title.
- No secret values, no personal data — the model is redacted on write
  (`cite.mjs check` redacts every string field-wise), but a redacted title
  is a useless title.

## Threat ids

`T-` plus three digits, unique across the whole model (shared with `E-nnn`
and `M-nnn`), stable across runs: a threat keeps its id from one
assessment to the next so a register row's `finding_id`-shaped subject and
a ticket body carrying `T-nnn` still refer to it. Retire an id by leaving
a gap, never by reusing it.

## Coverage, said out loud

The report counts threats by disposition (`MODEL elements=<n>
threats=<n> open=<n>`); it does not count the letters you chose not to
write. State the omissions in your return message — "no `D` threats on
datastores: the scope has no write path" — so the lead reads the model's
silence as a decision, not a gap.
