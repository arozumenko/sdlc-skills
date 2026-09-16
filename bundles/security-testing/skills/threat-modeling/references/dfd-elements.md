# DFD elements — code-derived, one citation each

An element exists in the model only because a range of code in the run's
scope makes it real. The citation is the element's evidence; `tm-lint
check` validates it with the same range rule `gate` applies to a finding.

## The five kinds

| `kind` | What it is | Cite the lines that… | Typical id prefix use |
|---|---|---|---|
| `external` | an actor or system outside your control that talks to the system: a browser, a partner API, a queue you consume, a cron trigger | receive from it or call it — the route handler's signature, the HTTP client call, the consumer's subscribe | `E-0xx` |
| `boundary` | a change of trust: authentication middleware, a network edge, a serialization edge, a tenant check | enforce the change — the middleware registration, the guard, the deserializer | `E-1xx` |
| `process` | code that transforms data on behalf of a request or a job | do the work — the handler body, the service method, the job runner | `E-2xx` |
| `datastore` | where data rests: a table, a bucket, a cache, a file, a secret store | read or write it — the query, the ORM model, the client call | `E-3xx` |
| `flow` | a data movement between two of the above worth its own threats (a webhook fan-out, an export, a replication) | move the data — the producer call or the consumer loop | `E-4xx` |

The prefix ranges are a convention for readability; the schema requires
only `E-` followed by three digits and uniqueness across the model.

## The citation

```json
{ "path": "src/orders.js", "side": "head", "lines": [40, 52] }
```

- `path` is repo-relative, exactly as `scope.json` spells it (no `./`, no
  leading `/`). A path the scope does not list ⇒ `PATH-NOT-IN-SCOPE`.
- `side` is `head` for what is at the run's `head_oid` — the normal case
  on an assessment run — or `base` for code that existed at `base_oid`
  and is gone at head (a removed control you still want to model). A file
  the scope recorded at `snapshot` (a dirty file in a review run) cannot
  be cited: `tm-lint` answers `cites a dirty file; build the model on an
  assessment run` (PM ruling R2). There is no mapping from `head` to the
  snapshot; the model is an assessment-run artifact.
- `lines` is `[start, end]`, 1-based, `start ≤ end`, at most 40 lines
  (`RANGE-TOO-LONG` otherwise), lying inside **one** admitted range of the
  file (`RANGE-NOT-ADMITTED` otherwise). Line numbers are normalised lines
  (the bundle's normalisation rules: newline-preserving, so a blank raw
  line that normalises away shifts nothing below it).

One citation per element. When two ranges make the element real, choose
the one a reader must see first; the second becomes a mitigation's
citation or a second element (a `boundary` next to a `process` is common).

## Naming

`name` is non-empty prose a lead can read in a table without the code
open: "Checkout API (POST /orders)", "Orders table", "Payment provider
webhook". A blank or whitespace-only name is `TM-INVALID(E-nnn: name is
empty)` — the report forbids blank cells.

## Where to start

1. `scope.json` — every file and admitted range you may cite. Read it
   before the code.
2. Entry points: routers, handlers, message consumers, schedulers. Each
   yields an `external` (who calls) and a `process` (what runs).
3. Trust changes on each path: where is the caller authenticated, where is
   input parsed, where does a tenant or role check happen. Each is a
   `boundary`; a path with none is itself a finding for the lead.
4. Sinks: queries, file writes, outbound calls, secret reads. Each is a
   `datastore` or a `flow`.
5. Stop when every admitted range is either cited by an element, covered
   by a mitigation's citation, or consciously left out — say which in the
   return message, the lead reads coverage separately.
