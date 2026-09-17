---
name: Security Testing Team
description: "Threat-led, read-only security testing team: code-derived STRIDE threat model, evidence-gated secure code review with re-checkable citations, passive security cases for the manual-qa and test-automation bundles, fix verification from a validated test-start snapshot, and a residual-risk register."
owner: Applied AI
authors:
  - "Daniel Sallai <Daniel_Sallai@epam.com>"
install_script: "npx github:arozumenko/sdlc-skills init --factory security-testing"
install_script_unix: "npx github:arozumenko/sdlc-skills init --factory security-testing"
sdlc_phase: Security Testing
support_level: Best Effort Support
use_cases:
  - "Code-derived STRIDE threat model with file:line citations"
  - "Evidence-gated secure code review whose citations anyone with the repo can re-check"
  - "Passive security cases in manual-qa format, proposals for active testing"
  - "Fix verification from a validated test-start snapshot with a script-emitted verdict"
  - "Residual-risk register with unauthenticated acceptance records and expiry"
---
# Security Testing Team

A threat-led, **read-only** security testing team: a code-derived STRIDE
threat model with a citation per element, an evidence-gated secure code
review whose citations anyone with the repository can re-check with one
command, passive security cases handed to the manual-qa and test-automation
bundles, fix verification from a validated test-start snapshot, and a
residual-risk register whose approvals are stored and reported as
unauthenticated. It produces a **security assessment**, not a penetration
test, and never merges, closes, rotates or fixes anything.

**Roster:** `security-lead` (the only human-facing role), `threat-modeler`,
`security-reviewer`. **Skills:** `security-evidence` (every script and
schema), `security-engagement`, `threat-modeling`, `secure-code-review`,
`security-test-planning`, `risk-register`.

## Install

```bash
npx github:arozumenko/sdlc-skills init --factory security-testing
```

Two-skill standalone review (no agents; the human drives the commands):

```bash
npx github:arozumenko/sdlc-skills init --skills security-testing/secure-code-review,security-testing/security-evidence
```

See [`README.md`](README.md) for the roster, the exact guarantees and what
is not guaranteed, and the standalone command sequence.
