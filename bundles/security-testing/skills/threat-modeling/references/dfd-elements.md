# DFD elements — code-derived, one citation each

An element exists in the model only because a citation in `engagement.md`'s
`scope_paths` makes it real: `{id, name, kind, citations}`. `cite.mjs check
<st>/threat-model.json` re-reads every citation against the bytes at `head`
and marks it `VERIFIED` or `FAILED(<why>)`, the same rule it applies to a
finding.

## The five kinds

| `kind` | What it is | Cite the lines that… | Typical id prefix use |
|---|---|---|---|
| `external` | an actor or system outside your control that talks to the system: a browser, a partner API, a queue you consume, a cron trigger | receive from it or call it — the route handler's signature, the HTTP client call, the consumer's subscribe | `E-0xx` |
| `boundary` | a change of trust: authentication middleware, a network edge, a serialization edge, a tenant check | enforce the change — the middleware registration, the guard, the deserializer | `E-1xx` |
| `process` | code that transforms data on behalf of a request or a job | do the work — the handler body, the service method, the job runner | `E-2xx` |
| `datastore` | where data rests: a table, a bucket, a cache, a file, a secret store | read or write it — the query, the ORM model, the client call | `E-3xx` |
| `flow` | a data movement between two of the above worth its own threats (a webhook fan-out, an export, a replication) | move the data — the producer call or the consumer loop | `E-4xx` |

The prefix ranges are a convention for readability; the schema requires
only `E-` followed by three digits and uniqueness across the whole model
(shared with `T-nnn` and `M-nnn` — reusing a spelling anywhere is
`TM-INVALID <id>: duplicate id`).

## The citation

```json
{ "path": "src/orders.js", "lines": [40, 52], "snippet": "…pasted from `show`…" }
```

- `path` — repo-relative, no leading `./`, no `..`, no absolute segment. A
  path outside `scope_paths` fails the citation with
  `FAILED <locus>.<i> path-not-in-scope`.
- `lines: [start, end]` — raw, as `git show` prints them (D3), 1-based,
  `start ≤ end`, `end - start + 1 ≤ 40` (`FAILED <locus>.<i> range-over-40`
  otherwise). Read a long file in consecutive ≤ 40-line windows and cite
  the window that makes the element real.
- `snippet` — the shown lines joined with `\n`, pasted from `cite.mjs show`
  output, never retyped. The compare that verifies it is whitespace- and
  blank-line-insensitive, so a snippet `check` already redacted still
  verifies on the next run — but it still has to be a contiguous run of
  the cited window (`FAILED <locus>.<i> snippet-not-found` otherwise).
- `oid?` — optional; `check` stamps the element's own `head` (or the
  document's `head`, or the run's `HEAD`) onto it when absent. A citation
  that isn't `{path, lines, snippet}` at all is
  `FAILED <locus>.<i> bad-shape`.

One citation per element. When two ranges make the element real, choose
the one a reader must see first; the second becomes a mitigation's
citation or a second element (a `boundary` next to a `process` is common).
An element with no citation is `TM-INVALID <id>: no citation` (or
`elements[<i>]` when the id itself does not match `E-nnn`).

## Naming

`name` is non-empty prose a lead can read in a table without the code
open: "Checkout API (POST /orders)", "Orders table", "Payment provider
webhook". A blank or whitespace-only name is `TM-INVALID <id>: empty name`.

## Where to start

1. `engagement.md`'s `scope_paths` — every file you may cite. Read it
   before the code; a path outside it does not exist for this model.
2. Entry points: routers, handlers, message consumers, schedulers. Each
   yields an `external` (who calls) and a `process` (what runs).
3. Trust changes on each path: where is the caller authenticated, where is
   input parsed, where does a tenant or role check happen. Each is a
   `boundary`; a path with none is itself a finding for the lead.
4. Sinks: queries, file writes, outbound calls, secret reads. Each is a
   `datastore` or a `flow`.
5. Stop when every file in scope is either cited by an element, covered by
   a mitigation's citation, or consciously left out — say which in your
   return message; the lead reads coverage separately.
