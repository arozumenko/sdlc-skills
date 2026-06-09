---
marp: true
theme: default
paginate: true
style: |
  section {
    font-size: 18px;
    padding: 40px 50px;
  }
  h1 { font-size: 2em; color: #1a1a2e; }
  h2 { font-size: 1.4em; color: #16213e; border-bottom: 2px solid #0f3460; padding-bottom: 6px; }
  h3 { font-size: 1.1em; color: #0f3460; }
  table { font-size: 0.85em; width: 100%; }
  th { background: #0f3460; color: white; }
  tr:nth-child(even) { background: #f0f4ff; }
  code { background: #f0f4ff; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 6px; font-size: 0.8em; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
  .highlight { background: #fff3cd; border-left: 4px solid #ffc107; padding: 8px 12px; }
  .good { background: #d4edda; border-left: 4px solid #28a745; padding: 8px 12px; }
  .bad { background: #f8d7da; border-left: 4px solid #dc3545; padding: 8px 12px; }
---

<!-- _paginate: false -->

# Session-Aware Test Grouping
## Optimizing Mobile QA Execution via State Chaining

**Project:** MobitruDemo Smoke Suite — Android (Mobitru Device Farm)
**Approach:** Eliminate redundant app resets between compatible test cases
**Branch:** `feat/mobile-qa-session-grouping`
**Date:** 2026-06-09

---
**Authors:** Olha Stetsenko | Claude Code (Sonnet 4.6)

---

## Agenda

1. **The Problem** — why standard mobile test suites are slow by design
2. **Benchmark Data** — measured baseline on real device farm
3. **The Idea** — state-aware session grouping concept
4. **State Model** — how app state is defined and tracked
5. **How Grouping Works** — the chaining mechanism for smoke suite
6. **Architecture** — 5-agent pipeline overview
7. **Implementation Details** — TC frontmatter, session plan, agent changes
8. **Expected Results** — projected time & cost savings
9. **Scalability** — impact on larger suites
10. **Lessons Learned** — design decisions and review findings
11. **Next Steps** — pending run results (placeholders)

---

## The Problem: Every TC Starts From Zero

In standard mobile automation, **each test case is a fully isolated unit**. Before every TC:

```
terminate_app  →  launch_app  →  set_orientation  →  [login]  →  [navigate to screen]  →  [set data state]
```

This is correct for **isolation** — but wasteful when consecutive TCs naturally share state.

### What this costs per TC (device-farm, real Android device)

| Step | Typical Duration | Tool Calls |
|------|-----------------|------------|
| `mobile_terminate_app` | ~3s | 1 |
| `mobile_launch_app` | ~8s | 1 |
| `mobile_set_orientation → portrait` | ~3s | 1 |
| **Tap "Sign in with correct user"** | ~8s | 2–3 |
| **Verify login success** | ~5s | 1 |
| **Total overhead per TC** | **~27–30s** | **6–7 calls** |

For a 4-TC smoke suite: **3 unnecessary resets × ~28s ≈ 84s of pure overhead**.

The TCs themselves (the actual test work) take far less time than the setup overhead.

---

## Baseline: Run History on Mobitru Device Farm

All runs: MobitruDemo APK v1.2.0 · Android 14 real device · 4 smoke TCs

| Run ID | Date | Mode | Result | Duration | Tool Calls | Notes |
|--------|------|------|--------|----------|------------|-------|
| RUN-2026-06-03-001 | 2026-06-03 | appium / emulator | 4/4 ✅ | 5m 37s | — | `noReset:true` — runners had to logout manually |
| RUN-2026-06-03-002 | 2026-06-03 | appium / emulator | 4/4 ✅ | 2m 40s | — | `noReset:false` — fresh session per TC |
| **RUN-2026-06-08-003** | 2026-06-08 | **device-farm** | 4/4 ✅ | **14m 32s** | **68** | First device-farm run — full overhead, no optimization |
| **RUN-2026-06-08-004** | 2026-06-08 | **device-farm** | 4/4 ✅ | **8m 53s** | **46** | Optimized: shared Appium session, no recordings |

### Optimization applied between RUN-003 → RUN-004 (−39% time, −32% calls)

- **One `mobile_appium_init` per suite** instead of per TC — eliminated 3 × session reinit overhead
- **Removed screen recordings** — no `start_recording` / `stop_recording` / `download_recording`
- **Removed pre-launch orientation** — `set_orientation` only after `launch_app`, not before
- **TC-003 sort fix** — Lenovo Legion is first in default price-ascending order; removed sort toggle

**RUN-004 (8m53s, 46 calls) is the benchmark for session grouping comparison.**

---

## The Idea: Stop Resetting When You Don't Need To

> "Expert QA leads plan test order manually to avoid redundant state rebuilding. Why not automate that?"

### Core insight

Each test case has a **precondition state** (what must be true before it runs) and a **postcondition state** (what will be true when it finishes). If TC[n]'s postcondition **exactly matches** TC[n+1]'s precondition — there is no reason to reset.

```
TC-001 ends:  auth=logged_in, screen=product_list, cart=empty
TC-002 needs: auth=logged_in, screen=product_list, cart=empty  ← MATCH → no reset needed
```

The app is already in the right state. Just keep executing.

### What changes

- **Without grouping:** `terminate → launch → login` before EVERY TC
- **With grouping:** `terminate → launch → login` only at the **start of each group** (when state doesn't match or is unknown)

For the smoke suite: **4 TCs → 1 group → 1 reset instead of 4**.

---

## State Model: Defining "Compatible State"

The State Model lives in `.agents/mobile-qa/app_profile.md` and defines what dimensions matter for grouping.

### State Dimensions (MobitruDemo)

| Dimension | Values | Meaning |
|-----------|--------|---------|
| `auth` | `logged_out` / `logged_in` | Whether the user is past the Login screen |
| `screen` | `login` / `product_list` / `cart` / `checkout` | Current foreground screen |
| `cart` | `empty` / `has_items` | Whether cart contains ≥1 item |

### Boundary Rules

A TC can **inherit state** from the previous TC if and only if:
1. The previous TC's `postcondition_state` **exactly matches** this TC's `precondition_state` (all dimensions)
2. The previous TC **PASSed** — a FAIL invalidates the shared state; next TC must restart fresh

### Reset Cost Reference

| Reset type | Overhead |
|-----------|---------|
| Full reset (terminate → launch → login) | ~27–30s, ~6–7 tool calls |
| State inheritance (no reset) | ~0s, 0 tool calls (+ precondition verification: ~3s, 1 call) |

### Extensibility

The model is intentionally minimal for this app. For other apps, add dimensions:
`user_role`, `data_state` (order placed / none), `permissions` (camera: denied — hard reset needed), `network_state` (online / throttled), `app_data` (first_launch / returning)

---

## Smoke Suite: The Chain

All 4 TCs form **one continuous session** — zero resets between them.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GROUP 1  (1 session reset)                        │
│                                                                             │
│  TC-001          TC-002          TC-003          TC-004                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │PRE:      │    │PRE:      │    │PRE:      │    │PRE:      │              │
│  │logged_out│───▶│logged_in │───▶│logged_in │───▶│logged_in │              │
│  │login     │    │prod_list │    │prod_list │    │prod_list │              │
│  │cart:empty│    │cart:empty│    │cart:empty│    │cart:items│              │
│  │          │    │          │    │          │    │          │              │
│  │POST:     │    │POST:     │    │POST:     │    │POST:     │              │
│  │logged_in │    │logged_in │    │logged_in │    │logged_in │              │
│  │prod_list │    │prod_list │    │prod_list │    │cart      │              │
│  │cart:empty│    │cart:empty│    │cart:items│    │cart:items│              │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
│  inherit:false   inherit:true    inherit:true    inherit:true               │
│  (full reset)    (skip steps     (skip steps     (skip steps               │
│                   1–2)            1–2)            1–3)                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why TC-004 skips 3 steps, not 2

TC-002 and TC-003 skip **launch + login** (steps 1–2).
TC-004 must also skip **add-to-cart** (step 3) — Lenovo Legion is already in the cart from TC-003.
Starting from step 4 (Tap Cart header) is correct.

---

## Architecture: 5-Agent Pipeline

```
User / CI
    │
    ▼
┌─────────────────────┐
│  mobile-run-lead    │  Orchestrator: reads plan, books device,
│  (orchestrator)     │  dispatches runners, collects results, generates report
└──────┬──────────────┘
       │
       │ Step 3b: dispatch if no fresh plan
       ▼
┌─────────────────────┐
│ mobile-suite-planner│  Reads TC states → groups TCs → writes session_plan.md
│  (NEW in this PR)   │  (runs once per suite change; plan is cached with staleness check)
└──────────────────────┘
       │
       │ Step 3c: book device (device-farm only)
       ▼  check_device_farm_status → find_device → take_device → install_app → appium_init
       │
       │ Step 4: dispatch per TC (sequential)
       ▼
┌─────────────────────┐
│ mobile-test-runner  │  Executes one TC; skips setup steps when inherit_state=true;
│  (updated)          │  fallback to full reset if precondition mismatch;
└─────────────────────┘  NEVER closes session (run-lead owns lifecycle)
       │
       │ Step 5c: teardown (device-farm)
       ▼  mobile_appium_close → device_farm_release_device
       │
       │ Step 6: report
       ▼
┌─────────────────────┐
│ mobile-test-reporter│  Generates RUN-*.md from JSON results array
└─────────────────────┘
```

**Key ownership rule:** `mobile-run-lead` fully owns the device and Appium session lifecycle.
Runners never call `appium_init`, `appium_close`, or `device_farm_release_device`.

---

## Implementation: TC Frontmatter

Each TC now declares its **state contract** — the precondition it requires and the postcondition it guarantees.

```yaml
# Example: TC-003_add-product-to-cart.md
---
id: TC-003
title: Add product to cart
priority: critical
runner_mode: device-farm
size: M
tags: [smoke, cart, add-to-cart]

precondition_state:         # ← What must be true BEFORE this TC can run
  auth: logged_in
  screen: product_list
  cart: empty

postcondition_state:        # ← What will be true AFTER this TC completes (PASS)
  auth: logged_in
  screen: product_list
  cart: has_items

setup_steps: 2              # ← Steps to skip when inherit_state: true
                            #   Steps 1–2 = launch app + tap sign-in (already done)
---
```

### setup_steps per TC in smoke suite

| TC | setup_steps | Skipped when inheriting | First executed step |
|----|------------|------------------------|---------------------|
| TC-001 | 0 (omitted) | Nothing — always fresh start | Step 1: Launch app |
| TC-002 | 2 | Step 1 (launch) + Step 2 (login) | Step 3: Observe "Mobile phones (12)" |
| TC-003 | 2 | Step 1 (launch) + Step 2 (login) | Step 3: Locate "Add to cart" button |
| TC-004 | **3** | Step 1 (launch) + Step 2 (login) + Step 3 (add-to-cart) | **Step 4: Tap Cart header** |

> **TC-004 requires 3 skipped steps** because the Lenovo Legion is already in the cart from TC-003.
> Starting at step 3 would attempt to tap "Add to cart" on an already-added item → failure.

---

## Implementation: session_plan.md

Generated by `mobile-suite-planner` before the run. Cached with staleness detection.

```yaml
---
suite: tasks/smoke
generated: 2026-06-09
generated_for_tc_ids: [TC-001, TC-002, TC-003, TC-004]   # ← staleness key
tc_count: 4
group_count: 1
groups:
  - group_id: G1
    tcs:
      - {id: TC-001, file: tasks/smoke/TC-001_login-sign-in-with-correct-user.md,    inherit_state: false}
      - {id: TC-002, file: tasks/smoke/TC-002_product-list-shows-12-items.md,        inherit_state: true}
      - {id: TC-003, file: tasks/smoke/TC-003_add-product-to-cart.md,                inherit_state: true}
      - {id: TC-004, file: tasks/smoke/TC-004_view-cart-with-item.md,                inherit_state: true}
---

# Session Plan — tasks/smoke
4 TCs → 1 session group(s). Resets saved: 3 (~150s).
```

### Staleness detection (run-lead Step 3b)

1. If `session_plan.md` exists → read `generated_for_tc_ids`
2. Compare against current TC IDs in suite folder
3. **Match** → plan is fresh, use it
4. **Mismatch** (TC added / removed / renamed) → regenerate automatically
5. **File absent** → generate

The plan file is committed to the repo — reviewers can verify grouping logic before running.

---

## Implementation: Run Lead Changes

### Step 3b — Session Planning (new)

```
mobile-run-lead reads app_profile → globs TCs → checks session_plan.md freshness
  ↓ plan fresh?
    YES → load groups directly from frontmatter
    NO  → dispatch mobile-suite-planner → wait → read generated plan
  ↓
store suite_plan: list of groups, each TC with inherit_state flag
```

### Step 4 — Execute with inherit_state

For device-farm runners, the prompt now includes:
```
"Execute the mobile test case at {file_path}.
 device_serial={suite_serial}
 inherit_state={true|false}    ← from suite_plan
 Read .agents/mobile-qa/app_profile.md ..."
```

**Failure cascade rule:** If TC[n] **FAILs**, the next TC in the same group gets `inherit_state: false` (failure invalidates state — unsafe to inherit unknown state from a failed TC).

For appium mode (local), run-lead also passes:
```
close_session_after={true|false}    ← true only for the last TC in the suite
```
(run-lead owns the appium session; runner closes it only when explicitly told to)

---

## Implementation: Test Runner Changes

### Session Start — branching on inherit_state

**`inherit_state: false` (full reset):**
```
mobile_terminate_app → mobile_launch_app → mobile_set_orientation → [proceed to execution]
```

**`inherit_state: true` (state inherited):**
```
# Skip terminate/launch/orientation entirely
# Verify precondition → proceed
```

### Execution Protocol — 2-step start determination

```
Step 1: Verify preconditions (mobile_list_elements_on_screen)
        If inherit=true AND screen mismatch:
            → full reset (terminate → launch → orientation)
            → mark fallback_occurred = true

Step 2: Determine execution start
        inherit=true AND fallback_occurred=false:
            → read setup_steps from frontmatter (default 0)
            → steps_skipped = setup_steps
            → begin from step setup_steps+1
        Otherwise (inherit=false OR fallback):
            → steps_skipped = 0
            → execute all steps from step 1
```

**Critical:** the `setup_steps` skip is suppressed after a fallback — a full reset means the app is on login screen, and we must execute all steps including launch and login.

### Session End — runner no longer cleans up

Runner does NOT call `mobile_terminate_app`, `mobile_appium_close`, or `device_farm_release_device`.
Run-lead calls these after all TCs complete (Step 5c).

---

## Output: Extended JSON Result

```json
{
  "tc_id": "TC-003",
  "title": "Add product to cart",
  "result": "PASS",
  "runner_mode": "device-farm",
  "steps_total": 6,          ← total steps in the TC file as written
  "steps_skipped": 2,        ← setup steps skipped due to state inheritance
  "steps_completed": 4,      ← steps_total − steps_skipped (on PASS)
  "inherit_state": true,     ← whether this TC inherited state from previous
  "failure_step": null,
  "failure_reason": null,
  "screenshot": "reports/screenshots/TC-003_2026-06-09.png",
  "duration_seconds": [[ PLACEHOLDER — actual value from run ]],
  "notes": ""
}
```

**Field semantics:**
- `steps_total` = steps in the file (never changes regardless of chaining)
- `steps_skipped` = how many were bypassed (0 if `inherit_state=false` or fallback occurred)
- `steps_completed` = steps actually executed (= `steps_total − steps_skipped` on PASS; fewer on FAIL)

The reporter can compute **"effective steps per second"** and **"setup overhead %"** from these fields.

---

## Expected Results: Time Comparison

### Per-TC timing breakdown (device-farm, Android 14)

| Phase | TC-001 | TC-002 (before) | TC-002 (after) | TC-003 (before) | TC-003 (after) | TC-004 (before) | TC-004 (after) |
|-------|--------|----------------|----------------|----------------|----------------|----------------|----------------|
| terminate + launch + orient | ~14s | ~14s | **0s** | ~14s | **0s** | ~14s | **0s** |
| login (tap sign-in) | ~8s | ~8s | **0s** | ~8s | **0s** | ~8s | **0s** |
| add-to-cart (TC-004 only) | — | — | — | — | — | ~8s | **0s** |
| Actual test steps | ~25s | ~20s | ~20s | ~25s | ~25s | ~20s | ~20s |
| Precondition verify | ~3s | ~3s | ~3s | ~3s | ~3s | ~3s | ~3s |
| **TC total** | **~50s** | **~45s** | **~23s** | **~50s** | **~28s** | **~53s** | **~23s** |

### Suite total

| Metric | RUN-004 (no grouping) | Estimated with grouping | Delta |
|--------|-----------------------|------------------------|-------|
| Total duration | **8m 53s** (533s) | **~[[ PLACEHOLDER ]]** | **[[ PLACEHOLDER ]]** |
| Tool calls | **46** | **~[[ PLACEHOLDER ]]** | **~[[ PLACEHOLDER ]]** |
| Resets performed | 4 | **1** | −3 |
| Setup overhead | ~120s (~22%) | ~[[ PLACEHOLDER ]]s | [[ PLACEHOLDER ]] |

> All "with grouping" numbers marked `[[ PLACEHOLDER ]]` — to be filled after first run on new branch.

---

## Expected Results: Tool Call Comparison

### What grouping eliminates (per chained TC)

| Eliminated calls | Per TC | × 3 chained TCs |
|-----------------|--------|-----------------|
| `mobile_terminate_app` | 1 | 3 |
| `mobile_launch_app` | 1 | 3 |
| `mobile_set_orientation` | 1 | 3 |
| Login tap (`mobile_click_web_element`) | 1 | 3 |
| Login verify (`mobile_list_elements_on_screen`) | 1 | 3 |
| TC-004 add-to-cart + verify | 2 | 2 (once) |
| **Total eliminated** | **~7** | **~17** |

### Projection

| Run | Tool calls | Notes |
|-----|-----------|-------|
| RUN-003 | 68 | Baseline (unoptimized device farm) |
| RUN-004 | 46 | After shared session + no recording |
| **RUN-005 (projected)** | **~[[ PLACEHOLDER ]]** | After session grouping (−~17 calls from RUN-004) |
| **RUN-005 (actual)** | **[[ PLACEHOLDER ]]** | To be filled after run |

> Each eliminated tool call also reduces **LLM context size** and **agent inference cost**.
> At scale (20-TC regression suite), projected savings: **40–50% total duration reduction**.

---

## Scalability: Impact on Larger Suites

Session grouping benefits scale super-linearly with suite size.

### Hypothetical 20-TC regression suite

Assumptions: average 3 TCs per session group (state resets at module boundaries), each reset ~28s

| Metric | Without grouping | With grouping | Saving |
|--------|-----------------|---------------|--------|
| Resets | 20 | ~7 | 13 |
| Reset overhead | 20 × 28s = 560s | 7 × 28s = 196s | **364s (~6m)** |
| Estimated total | ~30m | ~24m | **−20%** |
| Tool calls | ~230 | ~160 | **−30%** |

### Hypothetical 50-TC regression suite

| Metric | Without grouping | With grouping | Saving |
|--------|-----------------|---------------|--------|
| Resets | 50 | ~15 | 35 |
| Reset overhead | 50 × 28s = 1400s | 15 × 28s = 420s | **980s (~16m)** |
| Estimated total | ~70m | ~54m | **−23%** |

### What determines group count in a larger suite?

- **Login-required TCs** after logout TCs or permission-denial TCs → hard group boundary
- **Cart state changes** — TCs that empty the cart break the chain for TCs requiring `cart:empty`
- **Screen position** — TCs requiring `screen:login` always start a new group

> In well-designed suites where TCs are ordered by flow (login → browse → add → checkout),
> grouping is maximally effective. Random ordering wastes its potential.

---

## Design Decisions Log

### 1. Separate agent (mobile-suite-planner) vs extending profiler/author
**Decision:** New dedicated agent.
**Why:** Planning is a distinct concern — it reads existing TCs, doesn't create them. Keeps each agent at single responsibility. Profiler defines state vocabulary; planner applies it.

### 2. session_plan.md as pure YAML frontmatter (not markdown + YAML block)
**Decision:** Pure YAML frontmatter only.
**Why:** Mixed format (human table + separate YAML block) is ambiguous for LLM parsing. Pure frontmatter is the established pattern in this repo (all TC files use it). Run-lead reads it reliably.

### 3. Session ownership: run-lead, not runner
**Decision:** Runner never closes session or releases device.
**Why:** If runner closes session after each TC, the next chained runner finds no session. The lead is the only agent that sees all TCs in sequence — it's the natural owner.

### 4. Fallback guard for setup_steps
**Decision:** steps_skipped = 0 after any fallback (even if inherit_state=true).
**Why:** Fallback means app was reset to login screen. Skipping launch+login steps after reset would start test execution on the wrong screen — guaranteed failure. The guard is a safety net.

### 5. TC-004 needs setup_steps: 3, not 2
**Discovery:** Found in third review round by tracing full execution.
**Why:** Lenovo Legion is already in cart from TC-003. TC-004 step 3 ("Tap Add to cart") would fail on the "Added to cart" button. The add-to-cart step is setup for TC-004's actual test (viewing the cart) — it belongs with the other skipped steps.

---

## Review Process: What We Found and When

Three rounds of critical review before first run, each finding real bugs.

### Round 1 — Initial implementation review

| Bug | Impact | Fix |
|-----|--------|-----|
| Runner called `mobile_terminate_app` in Session End → next inherit runner found terminated app | **Critical — would break all chaining** | Removed terminate from runner Session End; lead owns lifecycle |
| TC steps included launch+login but no skip mechanism existed | **Critical — runner would re-execute setup** | Added `setup_steps` field to TC frontmatter |
| Appium Session End: "Always close the session" conflicted with chaining | **Critical — broke appium mode** | Conditional close on `close_session_after=true` only |
| Fallback path undefined when inherit TC finds wrong screen | Medium | Specified fallback to full reset; added `fallback_occurred` flag |

### Round 2 — Post-fix review

| Bug | Impact | Fix |
|-----|--------|-----|
| `setup_steps` skip applied even after fallback | **Medium — wrong start step after reset** | Added `fallback_occurred` guard; skip only if no fallback |
| "Complete Session End steps" referenced now-empty section | Low — misleading | Replaced with "Emit the JSON result" |
| `steps_total` / `steps_completed` semantics unclear | Low — report confusion | Added `steps_skipped` field; documented all three |
| session_plan.md: dual format (table + YAML block) | Medium — unreliable parsing | Pure YAML frontmatter only |

### Round 3 — Final pre-run review

| Bug | Impact | Fix |
|-----|--------|-----|
| TC-004 `setup_steps: 2` should be `3` | **Critical — step 3 fails on already-added item** | Changed to `setup_steps: 3` |

**Lesson:** Trace the full execution scenario end-to-end for each TC, not just read the instructions abstractly. Bugs appear at state transitions between TCs.

---

## Comparison: Before vs After (Summary)

| Dimension | RUN-003 | RUN-004 | **RUN-005 (projected)** | **RUN-005 (actual)** |
|-----------|---------|---------|------------------------|---------------------|
| Date | 2026-06-08 | 2026-06-08 | — | [[ PLACEHOLDER ]] |
| Mode | device-farm | device-farm | device-farm | device-farm |
| Result | 4/4 ✅ | 4/4 ✅ | 4/4 ✅ (expected) | [[ PLACEHOLDER ]] |
| Duration | 14m 32s | **8m 53s** | **~6m 20s** | [[ PLACEHOLDER ]] |
| Tool calls | 68 | **46** | **~29** | [[ PLACEHOLDER ]] |
| App resets | 4 | 4 | **1** | [[ PLACEHOLDER ]] |
| Session inits | 4 | **1** | 1 (unchanged) | [[ PLACEHOLDER ]] |
| Recordings | 4 | **0** | 0 (unchanged) | [[ PLACEHOLDER ]] |
| steps_skipped total | N/A | N/A | **7** (0+2+2+3) | [[ PLACEHOLDER ]] |
| Optimization applied | baseline | shared session, no recording | **+ session grouping** | — |
| Cumulative time saving vs RUN-003 | — | −39% | **~−57%** | [[ PLACEHOLDER ]] |

> Fill `[[ PLACEHOLDER ]]` columns after running `tasks/smoke` on `feat/mobile-qa-session-grouping`.

---

## What to Verify in the First Run

### Functional correctness

- [ ] TC-002 starts execution at step 3 (not step 1) — confirm in agent output log
- [ ] TC-003 starts at step 3 — confirm Lenovo Legion's "Add to cart" button is found without login
- [ ] TC-004 starts at step 4 — confirm Cart header tap works without re-adding item
- [ ] All 4 TCs: PASS
- [ ] `steps_skipped` in JSON: TC-001=0, TC-002=2, TC-003=2, TC-004=3
- [ ] `session_plan.md` written to `tasks/smoke/`

### Performance

- [ ] Total duration < 8m 53s (RUN-004 baseline)
- [ ] Tool calls < 46 (RUN-004 baseline)
- [ ] Device booked once (1 × `device_farm_take_device_by_id` in run-lead logs)
- [ ] App launched once (1 × `mobile_launch_app` in TC-001; 0 in TC-002/003/004)

### Failure resilience (manual test — optional)

- [ ] Artificially fail TC-002 → verify TC-003 gets `inherit_state=false` → full reset executed → steps_skipped=0

---

## Next Steps

### Immediate
1. **Run smoke suite** on `feat/mobile-qa-session-grouping` → fill all `[[ PLACEHOLDER ]]` values in this deck
2. **Commit run results** (report + actual timing) to branch
3. **Update memory** with RUN-005 data

### Near term
4. **Add `runner_mode` check** — suite-planner currently groups regardless of runner_mode; if a suite mixes appium + device-farm TCs, groups should be runner_mode-homogeneous
5. **TC-001 state note** — add explanation that TC-001's `setup_steps` is 0 by design (it IS the login test; it always starts from a clean state)
6. **Add to mobile-test-author** — when authoring new TCs, author should set `precondition_state`, `postcondition_state`, and `setup_steps` automatically based on the test flow

### Future / regression suite
7. **Plan regression suite grouping** — when regression TCs are written, validate group structure
8. **Measure real savings** on 15–20 TC suite
9. **session_plan.md visualization** — add a Mermaid diagram output from suite-planner showing the group chain
10. **Consider parallel groups** — independent groups (different screens/flows) could potentially run in parallel on separate devices

---

<!-- _paginate: false -->

## Thank You

**Session-Aware Test Grouping** is now implemented on `feat/mobile-qa-session-grouping`.

Three agents updated · One new agent · Four TCs extended · Three review rounds

```
feat/mobile-qa-bundle           30a9cb2   ← device farm setup complete
    └── feat/mobile-qa-session-grouping
            493587f  feat(smoke): add state contracts to TC frontmatter
            249a553  feat(app-profile): add State Model section
            d0a50a1  feat(mobile-qa): implement session grouping — run-lead, runner, suite-planner
            cfc162a  fix(smoke): correct TC-004 setup_steps from 2 to 3
```

**Benchmark target:** < 8m 53s (RUN-004) · < 46 tool calls · 1 app reset instead of 4

---
*Generated with Claude Code (Sonnet 4.6) · 2026-06-09*
