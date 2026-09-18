# Passive admission — what `cases.mjs admit` checks

The admission is a **heuristic over step text**: an allowed-operation
grammar and a forbidden-pattern list, run over the `Action` cell of every
row of the case's `## Steps` table (the `Expected Result` cell is an
observation and is not linted). A case is `admitted by lint` when no rule
matches; any hit and it stays a `proposal`. There is no reviewable hit
and no confirmed state in this bundle — v1 ships no second-opinion path
for candidate cases, so a hit is not something a review can waive. A hit
is recorded as `{rule, step, text}` (`lib/admission.mjs` `lintCase`).

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
hit: the effect is not known to the grammar. Rewrite the step; there is
no reviewer to admit it past the grammar in v1.

## Forbidden patterns (the list)

Any match is a hit under the rule; a step with a forbidden hit gets no
`unknown-operation` hit on top.

| Rule | Matches | Examples |
|---|---|---|
| `mutating-verb` | a state-changing verb **at the start of the Action or of a clause after `and` / `then` / `or` / `;` / `,`** (so `Navigate to … then submit the form` is a hit; `Inspect the delete button` is not): `submit`, `send`, `post`, `put`, `patch`, `delete`, `remove`, `drop`, `upload`, `create`, `register`, `sign up`, `modify`, `update`, `edit`, `change`, `alter`, `inject`, `exploit`, `brute force`, `fuzz`, `scan`, `spray`, `bypass`, `escalate`, `tamper`, `intercept`, `replay`, `forge`, `overwrite`, `execute`, `run`, `install`, `deploy`, `reset`, `disable`, `enable`, `grant`, `revoke`, `transfer`, `pay`, `purchase`, `check out`, `approve`, `reject`, `cancel`, `order`, `book`, `import`, `export`, `migrate`, `truncate`, `wipe`, `kill`, `restart`, `shut down` | `Submit the login form`, `Delete the test user` |
| `injection-payload` | anywhere in the Action: `<script`, `javascript:`, an `onload=` / `onerror=` / `onclick=` handler, a quoted `' OR 1` / `" AND x=` tautology, `UNION SELECT`, `; DROP` / `; DELETE` / `; EXEC`, `../` or `..\` traversal, `%2e%2e`, `%00`, `%0d%0a`, a `{{7*7}}` template probe, `${…}` expression, a shell chain (`;`, `&&`, `||`, a pipe) into cat, ls, id, whoami, curl, wget, nc, bash, sh, rm or powershell | `Navigate to {{base_url}}/search?q=<script>alert(1)</script>` |
| `tooling` | a security or transfer tool named anywhere (plain words, any case): sqlmap, nmap, nikto, burp, zap, metasploit, hydra, dirb, gobuster, ffuf, wfuzz, masscan, nuclei, curl, wget, httpie, netcat | `Run sqlmap against {{base_url}}/login` |
| `volume` | `repeat`, `repeatedly`, `loop`, `flood`, `spam`, `hammer`, `concurrently`, `in parallel`, or `<two or more digits> times / requests / attempts / logins / tries / users / sessions` | `Reload the page 500 times` |
| `host-not-allowed` | a literal `http(s)://` URL whose host (`host[:port]`, lower-cased, the default port dropped) is not in `engagement.md` `targets.browser`; `{{base_url}}` is the runner's placeholder and always fine | `Open https://evil.example.net/probe` against `browser: ["staging.example.com"]` |

The lists are closed and lexical. They catch spellings, not intent: a
step that reads "Observe the result of removing every row" is accepted
by grammar (`observe`) and its effect is whatever the runner does with
it. Write steps that say what the runner does, one verb, one object.

## The classification

| Hits | Outcome | Command result |
|---|---|---|
| none | admitted by lint | `ADMITTED <suite>/<file>` |
| any | proposal | `PROPOSAL <st>/proposals/<file> hits=<n>`, one `HIT <rule> step <n>: <action>` per hit |

There is nothing else: no `--receipt`, no reviewed classification, no
`confirmed`/`refuted`/`indeterminate` states. A `threat-modeler` may mark
a threat `planned(TC-nnn)` before the case exists; that disposition
validates once `admit` actually admits the file, not before.

## Identity

The admitted copy is written with `{file, sha256}` — the bare basename
and the sha256 of the bytes `admit` wrote (already redacted) — upserted
into `<suite>/.admitted.json`. `verify-suite` recomputes every suite
file's sha256 against that index before it prints a hand-off prompt, so
an edited or hand-copied file is caught even if its name is right.

## Writing steps that admit cleanly

- One verb, one object per step; put the header/cookie check in the
  audit-step form (`references/audit-branch.md`) rather than describing
  a browser panel.
- Never write a credential assignment in Test Data as plain text — the
  suite file is the candidate's *redacted* text, so it reaches the
  runner as `<REDACTED:…>` regardless, but a passive case needs none.
- A literal URL must resolve to a host in `targets.browser`, or use
  `{{base_url}}`.
