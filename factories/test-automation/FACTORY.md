---
name: Test Automation Team
description: "Three-agent automation team (scout seeds, the lead routes and merges, the engineer builds and reviews) that compiles ready-made test cases — TMS or manual-qa-authored — into merged, honest automated tests: per-spec coverage contract, independent engineer-typed review, one N×-green hardening gate per batch."
owner: Applied AI
authors:
  - "Alexander Bychinskiy <Alexander_Bychinskiy@epam.com>"
install_script: "npx github:arozumenko/sdlc-skills init --factory test-automation"
install_script_unix: "npx github:arozumenko/sdlc-skills init --factory test-automation"
sdlc_phase: Test Automation
support_level: Self-Serve
use_cases:
  - TMS-driven test automation
  - Batch test hardening
---
# Test Automation Team

A three-agent automation team (scout seeds, the lead routes and merges, the
engineer builds and reviews) that compiles ready-made test cases — from a TMS
or authored by the manual-qa factory — into merged, honest automated tests:
every case routed on execution evidence, built under the coverage contract,
independently reviewed, and proven by one N×-green hardening gate per batch.

## Install

```bash
npx github:arozumenko/sdlc-skills init --factory test-automation
```

See [`README.md`](README.md) for the roster and how the team works.
