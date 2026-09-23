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
  - Code-derived STRIDE threat model with file:line citations
  - Evidence-gated secure code review whose citations anyone with the repo can re-check
  - Passive security cases in manual-qa format, proposals for active testing
  - Fix verification at the fix commit with a script-emitted verdict
  - Residual-risk register with unauthenticated acceptance records and expiry
---
See [`README.md`](README.md) for the roster, install steps, and how the team works.
