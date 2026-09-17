# Passive admission — what `plan.mjs admit` checks

The admission is a **heuristic over step text** (spec §9.1): an
allowed-operation grammar and a forbidden-pattern list, run over the
`Action` cell of every row of the case's `## Steps` table (the `Expected
Result` cell is an observation and is not linted). Unknown effects become
proposals. A case is "admitted by lint or by review" — the lint is text
matching, the review is a reviewer's word — never "safe". The rules below
are the ones the admission core of `security-evidence` runs (the pure
module `plan.mjs admit` is built on); a hit is recorded in the admission
as `{rule, step, text_redacted}`.

## Identity

`case_sha256` = sha256 over the **redacted** text of the case file —
the same number `ingest case` records as `import_sha256` and
`evidence.mjs packet --type case` names as the subject id, so an
admission, a case packet and a case import name one case the same way.
The record lives at `<run>/admissions/<case_sha256>.json`, write-once.

## Allowed operations (the grammar)

An Action is accepted when, after leading Markdown emphasis is stripped,
it **starts with** one of these verbs. Nothing else is passive by
grammar.

| Operation | Verbs |
|---|---|
| `navigate` | `navigate to`, `go to`, `browse to`, `return to`, `open`, `visit`, `load` |
| `reload` | `reload`, `refresh` |
| `observe` | `inspect`, `observe`, `read`, `view`, `check`, `verify`, `confirm`, `note`, `record`, `look at`, `examine`, `review`, `compare`, `count`, `list`, `find`, `locate`, `hover`, `expand`, `collapse`, `select`, `switch to`, `scroll`, `wait`, `capture`, `take a screenshot`, `close`, `ensure`, `assert` |

A step whose Action starts with any other verb — `fill`, `type`, `click`,
`press`, `sign in`, `log in`, `enter`, … — is an **`unknown-operation`**
hit: the effect is not known to the grammar. That is the one hit a
confirmed review can admit past (a click on a link is passive; a click on
"Delete account" is not — a reviewer can tell, the grammar cannot).

## Forbidden patterns (the list)

Any match is a hit under the rule; a step with a forbidden hit is a known
active effect and gets no `unknown-operation` hit on top.

| Rule | Matches | Examples |
|---|---|---|
| `mutating-verb` | a state-changing verb **at the start of the Action or of a clause after `and` / `then` / `or` / `;` / `,`** (so `Navigate to … then submit the form` is a hit; `Inspect the delete button` is not): `submit`, `send`, `post`, `put`, `patch`, `delete`, `remove`, `drop`, `upload`, `create`, `register`, `sign up`, `modify`, `update`, `edit`, `change`, `alter`, `inject`, `exploit`, `brute force`, `fuzz`, `scan`, `spray`, `bypass`, `escalate`, `tamper`, `intercept`, `replay`, `forge`, `overwrite`, `execute`, `run`, `install`, `deploy`, `reset`, `disable`, `enable`, `grant`, `revoke`, `transfer`, `pay`, `purchase`, `check out`, `approve`, `reject`, `cancel`, `order`, `book`, `import`, `export`, `migrate`, `truncate`, `wipe`, `kill`, `restart`, `shut down` | `Submit the login form`, `Delete the test user` |
| `injection-payload` | anywhere in the Action: `<script`, `javascript:`, an `onload=` / `onerror=` / `onclick=` handler, a quoted `' OR 1` / `" AND x=` tautology, `UNION SELECT`, `; DROP` / `; DELETE` / `; EXEC`, `../` or `..\` traversal, `%2e%2e`, `%00`, `%0d%0a`, a `{{7*7}}` template probe, `${…}` expression, a shell chain (`;`, `&&`, `||`, a pipe) into cat, ls, id, whoami, curl, wget, nc, bash, sh, rm or powershell | `Navigate to {{base_url}}/search?q=<script>alert(1)</script>`, `Open {{base_url}}/?next=../../etc/passwd` |
| `tooling` | a security or transfer tool named anywhere (plain words, any case): sqlmap, nmap, nikto, burp, zap, metasploit, hydra, dirb, gobuster, ffuf, wfuzz, masscan, nuclei, curl, wget, httpie, netcat | `Run sqlmap against {{base_url}}/login` |
| `volume` | `repeat`, `repeatedly`, `loop`, `flood`, `spam`, `hammer`, `concurrently`, `in parallel`, or `<two or more digits> times / requests / attempts / logins / tries / users / sessions` | `Reload the page 500 times` |
| `host-not-allowed` | a literal `http(s)://` URL whose host (`host[:port]`, lower-cased, the default port dropped) is not in `engagement.md` `targets.browser`; `{{base_url}}` is the runner's placeholder and always fine | `Open https://evil.example.net/probe` against `browser: ["staging.example.com"]` |

The lists are closed and lexical. They catch spellings, not intent: a
step that reads "Observe the result of removing every row" is accepted
by grammar (`observe`) and its effect is whatever the runner does with
it. Write steps that say what the runner does, one verb, one object.

## The classification

| Hits | `--receipt` | Classification |
|---|---|---|
| none | none | `admitted-heuristic` |
| any | none | `proposal` |
| none, or `unknown-operation` only | a `vulnerability-review` on the case packet, `confirmed`, and `receipt apply` derives `REVIEW_CONFIRMED` for the case | `admitted-reviewed` (with `receipt_sha256`) |
| any forbidden rule | `confirmed` | `proposal` — a forbidden hit is not reviewable away |
| any | `refuted` / `indeterminate`, or two same-run reviews that disagree (`REVIEW_INDETERMINATE`) | `proposal`, with a `review-not-confirmed` hit at step 0 naming the derived state |

The review state is derived by `states.applyReceipts` over every
admitted receipt and packet of the run — the same algorithm `receipt
apply`, `build-report` and `check` use — so a `confirmed` and a `refuted`
receipt on the same case in the same run read as indeterminate here too.
A receipt that is not a `vulnerability-review`, or whose subject is not
this case's identity, is `4 RECEIPT-MISMATCH(<reason>)`; a receipt sha
not admitted in the run is `2 USAGE(admit: unknown receipt …)`.

## The record

```json
{
  "case_sha256": "<64 hex>",
  "classification": "admitted-heuristic | admitted-reviewed | proposal",
  "lint_hits": [{ "rule": "<rule>", "step": 3, "text_redacted": "<the Action cell, redacted>" }],
  "assumptions": { "base_url_host": "<host of engagement base_url, or unknown>", "account": "<frontmatter account:, or unknown>" },
  "target_policy_sha256": "<sha256 over {targets, base_url?} of the run's engagement record>",
  "receipt_sha256": "<64 hex — admitted-reviewed only>"
}
```

`assumptions` are what the case was admitted against, never blank
(`unknown` when the record cannot say); `target_policy_sha256` pins the
authority policy the hosts were checked under, so a later reader knows
which `targets.browser` admitted them. Every classification exits 0 —
the record is the result; the `ADMISSION` line repeats it.
