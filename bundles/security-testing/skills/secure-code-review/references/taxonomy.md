# Finding taxonomy — the `class` ids with CWE anchors

`class` is one of **fifteen ids, closed** — the list below. `cite.mjs check`
only requires a non-empty string, so the list is enforced by this page and
by the lead reading the report; a finding with any other class is not a
finding of this bundle. The page says what each class means, which CWE
anchors it, whether it is a **data-flow class** (a source *and* a sink must
be cited, see SKILL.md), and what it is *not*, so two reviewers file the
same defect under the same class.

Attribution. The categories are re-derived from two public sources, in the
bundle's own words: the vulnerability categories and the false-positive
filtering rules of `anthropics/claude-code-security-review` (MIT) and the
OWASP Top 10 (2021) / OWASP ASVS control families. CWE identifiers are MITRE's.
No text was copied from either source.

## Classes

| class | data-flow | meaning | CWE anchors | not this class |
|---|---|---|---|---|
| `injection` | **yes** | Untrusted input becomes part of a command, query or expression that an interpreter executes: SQL/NoSQL, OS command, LDAP, template, expression language, code `eval`. | CWE-89, CWE-78, CWE-77, CWE-94, CWE-90, CWE-1336 | Rendering into HTML (`xss`); building a URL that the server fetches (`ssrf`); a filesystem path (`path-traversal`). |
| `xss` | **yes** | Untrusted input reaches an HTML/JS/CSS context in a browser without encoding for that context: reflected, stored, DOM-based, `innerHTML`, unsafe template helpers. | CWE-79, CWE-80, CWE-116 | Server-side template injection that executes on the server (`injection`). |
| `ssrf` | **yes** | The server issues a request whose destination (host, scheme, port or path) is influenced by untrusted input, including via redirects. | CWE-918, CWE-601 (when the redirect target is the exposure) | A client-side redirect only (`input-validation` unless it enables phishing of credentials — then `auth`). |
| `path-traversal` | **yes** | Untrusted input selects a filesystem path (read, write, include, archive extraction) and is not confined to the intended root. | CWE-22, CWE-23, CWE-36, CWE-73, CWE-434 (when the written name is attacker-chosen) | A path derived only from server constants; a `join` whose input is validated against an allowlist that cannot contain separators. |
| `deserialization` | **yes** | Untrusted bytes are turned into objects by a mechanism that can instantiate arbitrary types or run code: language-native serialisation, YAML `load`, pickle, XML with external entities, prototype pollution through recursive merge. | CWE-502, CWE-611, CWE-1321 | `JSON.parse` of untrusted JSON on its own (no code runs) — look for what the parsed object then reaches. |
| `auth` | no | Establishing *who* the caller is, done wrong: missing authentication on a route, credential handling (plaintext comparison, weak hashing, no rate limit on login), session fixation, token validation skipped (`alg: none`, signature not checked), password reset flows. | CWE-287, CWE-306, CWE-307, CWE-384, CWE-347, CWE-640, CWE-916 | What an authenticated caller may *do* (`authz`). |
| `authz` | no | A checked identity is allowed to act on an object or function it should not: missing ownership check (IDOR), role check absent or done client-side, mass assignment of privileged fields, privilege escalation through parameters. | CWE-285, CWE-639, CWE-862, CWE-863, CWE-915 | Nobody is identified at all (`auth`). |
| `crypto` | no | Cryptography that does not provide the property the code relies on: broken or home-grown algorithms, ECB, static IV or nonce, predictable randomness for security values, missing integrity on ciphertext, TLS verification disabled, constant-time comparison missing where timing matters. | CWE-327, CWE-328, CWE-329, CWE-330, CWE-338, CWE-295, CWE-208 | Storing a credential in source (`secret`); weak password hashing for stored passwords (`auth`, CWE-916). |
| `secret` | no | A credential, key or token literal that is live or plausibly live in a tracked file: API keys, private keys, connection strings with passwords, signing secrets, cloud credentials. Ask "would rotating this matter?" | CWE-798, CWE-321, CWE-540 | A development default that is not a live credential and is overridden by the environment (`config`; `check` redacts the snippet either way because the bytes match a redaction rule); a placeholder value (`do-not-flag.md`). |
| `input-validation` | no | Input accepted without the checks the code downstream assumes, where the consequence is not one of the data-flow classes: type confusion, unbounded sizes, numeric overflow, regex without anchors used as a security check, unchecked file type. | CWE-20, CWE-1284, CWE-190, CWE-129 | When the unchecked input reaches an interpreter, a browser, a fetch or a path — use the data-flow class; `input-validation` is the class of last resort for input problems. |
| `config` | no | A security-relevant setting whose value in the reviewed code weakens the system: permissive CORS, debug mode on, security headers absent, cookies without `Secure`/`HttpOnly`/`SameSite`, verbose errors to clients, default credentials in a fallback path, overly broad IAM/policy documents in code. | CWE-16, CWE-942, CWE-1004, CWE-614, CWE-489, CWE-1188 | A setting that only matters in an environment the scope does not show (state it in `rationale` as a prerequisite, or leave it). |
| `logging` | no | Sensitive data written to logs, or security events not logged where the code otherwise logs: credentials, tokens, full card numbers, session ids in log lines; audit trail missing on privileged actions that have a logger in reach. | CWE-532, CWE-778, CWE-117 (log injection when it enables forgery of entries) | A generic "insufficient logging" complaint with no cited log call and no cited privileged action (`do-not-flag.md`). |
| `dos` | no | Unbounded resource use an unauthenticated or low-privilege caller can trigger: catastrophic regex (ReDoS), unbounded allocation from a request size, missing pagination on an unbounded query, decompression bombs, recursion on untrusted structure. Cite the bound that is missing. | CWE-400, CWE-1333, CWE-770, CWE-409, CWE-674 | Rate limiting missing in general; "could be slow" (`do-not-flag.md`). |
| `supply-chain` | no | The reviewed code trusts something it fetches or installs without pinning or verifying: unpinned install from a URL, `curl \| sh`, dependency confusion (unscoped private package name), lockfile bypass, postinstall scripts that download, CI pulling mutable tags for privileged steps. | CWE-829, CWE-494, CWE-1357, CWE-1395 | A dependency that is merely old (no cited exploit path in this code) (`do-not-flag.md`). |
| `unmapped` | no | Reserved for imported scanner findings the mapping cannot classify (the v2 SARIF import, spec §12); no v1 script writes it. **A reviewer never writes `unmapped`**: if none of the fourteen classes above fits, the finding is not a security finding for this bundle. | — | — |

## Data-flow classes

`injection`, `xss`, `ssrf`, `path-traversal`, `deserialization` are the five
data-flow classes. For them the finding's `citations[]` must show the
**source** (where the untrusted value enters) and the **sink** (where it is
consumed dangerously) — the first citation is the sink, the identity anchor —
plus every **control** on the path that was examined and found insufficient.
Without a cited source and a cited sink the finding is not a data-flow
finding — it is a suspicion, and `refutation-criteria.md` says what to do
with a suspicion.

## Priority and confidence

`priority` (`p0`–`p3`) is the reviewer's proposal of urgency; the lead may
re-prioritise in the register. Use `p0` for unauthenticated remote reach of
code execution, data of every user, or credentials; `p1` for the same with a
low-privilege account or one precondition; `p2` for a defect that needs an
unusual precondition or yields limited data; `p3` for defence-in-depth gaps
with no direct exposure shown.

`confidence` (`high` | `medium` | `low`) is how sure the reviewer is that
the cited code has the defect **as described** — not how severe it is. Below
`high`, the refutation criteria expect `rationale` to say what would raise
it: the evidence outside the scope that was not seen.
