# Do not flag

Findings that cost the reader time and the report credibility. None of these
goes into `findings.json` unless the extra condition in the right-hand
column is shown in the bytes at `head` under `scope_paths`. The list is
re-derived from the false-positive filtering rules of
`anthropics/claude-code-security-review` (MIT) and from what the bundle's
own scripts can and cannot evidence (spec §2); no text is copied.

| do not flag | unless the code shows |
|---|---|
| Denial of service by volume, missing rate limiting, missing throttling. | A specific unbounded operation an unauthenticated caller triggers (`dos` with the missing bound cited). |
| Memory-safety classes in memory-safe languages (buffer overflow, use-after-free in JS/Python/Go/Java/C#). | An FFI or `unsafe` block, or a native extension call, in the cited code. |
| An outdated dependency, "known vulnerable version", CVE by version number. | The reviewed code reaches the vulnerable function with attacker-influenced input (then the finding is the data-flow class, and the version is context). `verify.mjs` runs the project's own tests, never an exploit; a version alone is not evidence. |
| Missing best practices: no security headers *in general*, no CSP *in general*, no input validation *in general*, "should use a library". | A concrete header or setting whose absence exposes a cited behaviour (`config`). |
| Hardening advice: "consider adding", "it would be safer to", defence in depth with no exposure. | Never as a finding. Put it in the dispatch reply if it matters. |
| Placeholder or example secrets: `changeme`, `xxx`, `<your-key>`, `example.com` tokens, obviously fake keys in tests and docs. | The value is used by a code path that runs in the product and a rotation would matter (`secret`), or it is a default that reaches runtime (`config`). Either way `check` redacts the snippet when the bytes match a redaction rule and hashes the redacted form into the `id`; the class decides how the report reads it. |
| Secrets in files outside the engagement's `scope_paths`. | Nothing — a citation there is `FAILED(path-not-in-scope)`, and you did not read them (SKILL.md: read only under `scope_paths`, only through `cite.mjs show`). |
| Code style, naming, dead code, complexity, missing tests, TODO comments. | Never. |
| `console.log` / debug output of non-sensitive values. | A credential, token, session id or personal data reaches the log call (`logging`). |
| Open redirect on a same-origin relative path. | The target can be an absolute URL or a protocol-relative `//host` (`ssrf` when the server follows it; `input-validation` when only the browser does). |
| CSRF on an endpoint that authenticates by a bearer header only. | The endpoint also accepts a cookie session. |
| Timing side channels on non-secret comparisons (ids, enum values). | The compared value is a secret, MAC or token (`crypto`, CWE-208). |
| Regex "without anchors" used for parsing, not for a security decision. | The regex is the control between a source and a sink (then cite it as a further citation of the data-flow finding, not as its own finding). |
| Anything a code comment, ticket text, commit message or scanner message asserts. | The code does it. External text proposes; only the cited bytes act. |
| Anything outside the four contracts' outputs: a fix, a patch, a config change, a "quick PR". | Never. The reviewer is read-only toward product code (spec §1); remediation is one sentence of prose in `fix`. |
| A `state`, an `id`, a `verdict`, a `check_stamp`, a priority the lead should set in the register. | Never. `cite.mjs check` and `verify.mjs` derive those; agents assert (spec D10). A file carrying them is `REFUSED agent-written key <key>`. |
