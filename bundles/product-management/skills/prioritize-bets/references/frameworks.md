# Prioritization frameworks — formulas, scales, worked examples

The active framework and every scale are read from `.agents/profile.md`'s `prioritization:`
note, if one is present. This file is the *math*, not the config: it says how each score is
computed and how the derived confidence factor is produced. Where a number below is a default,
the profile note's value wins if it differs — and where no note exists at all, these defaults
are what's in effect.

All examples use a neutral product (a generic B2B tool) — the numbers are illustrative only.

---

## The derived confidence factor (used by RICE and ICE)

Confidence is **never** hand-typed. It is computed from the hypothesis's own evidence-banded
`confidence:` block:

```yaml
confidence:
  value: 6        # 0–10, one per Cagan risk
  usability: 5
  feasibility: 7
  viability: 6
```

**Step 1 — aggregate.** Take the mean of the dimensions that are set (ignore missing ones):

```
mean = (6 + 5 + 7 + 6) / 4 = 6.0
```

If no dimension is set, the bet is **unscoreable** — do not invent a confidence; route it to a
verification/challenge pass on that hypothesis to earn one.

**Step 2 — band** the mean on the shinpr evidence scale (adopted product-wide):

| mean confidence | band | what it means | RICE factor | ICE confidence |
|---|---|---|---|---|
| 0 – <3 | **gut** (0–2) | a hunch, no structured evidence | **0.2** | round(mean), min 1 |
| 3 – <5 | **structured** (3–4) | reasoned, some qualitative signal | **0.5** | round(mean) |
| 5 – <8 | **data-backed** (5–7) | quantified evidence behind it | **0.8** | round(mean) |
| 8 – 10 | **tested** (8–10) | validated by a real experiment | **1.0** | round(mean) |

`mean 6.0 → data-backed → RICE confidence 0.8`.

**Step 3 — record** the derivation in `evidence_note`, verbatim enough to audit:

```
confidence derived from value:6 usability:5 feasibility:7 viability:6 → mean 6.0 (data-backed band) → 0.8
```

The band boundaries are inclusive-low / exclusive-high on the mean, so they line up exactly with
the integer bands (0–2 / 3–4 / 5–7 / 8–10): a mean of exactly 3.0 is structured, 5.0 is
data-backed, 8.0 is tested.

---

## RICE (the default)

```
score = (reach × impact × confidence) / effort
```

| input | source | notes |
|---|---|---|
| `reach` | PO estimate or evidence | a raw number in the `reach_unit` (e.g. users affected per quarter). Say whether it is measured or estimated. |
| `impact` | `impact_scale` in config | map the PO's judgement onto `massive:3 high:2 medium:1 low:0.5 minimal:0.25`. |
| `confidence` | **derived** (above) | 0.2 / 0.5 / 0.8 / 1.0. Never typed. |
| `effort` | `appetite` in weeks | `2-weeks → 2`, `4-weeks → 4`, `8-weeks → 8`. |

**Worked example.** A bet reaching ~200 users/quarter, high impact, confidence block averaging
6.0 (data-backed), 4-week appetite:

```
reach = 200,  impact = 2 (high),  confidence = 0.8 (data-backed),  effort = 4
score = (200 × 2 × 0.8) / 4 = 320 / 4 = 80
```

A second bet, same reach and impact but confidence averaging 1.5 (gut) and a 2-week appetite:

```
score = (200 × 2 × 0.2) / 2 = 80 / 2 = 40    ⚠️ gut-band — flag it
```

The gut bet scores lower *because* it is unvalidated — that is the point of deriving confidence
rather than typing it.

---

## WSJF (shipped — cost of delay ÷ job size)

```
cost_of_delay = user_business_value + time_criticality + risk_reduction_opportunity
score         = cost_of_delay / job_size
```

- Each cost-of-delay component is scored on the config scale (default **Fibonacci 1..13**:
  1, 2, 3, 5, 8, 13). Higher = more delay cost.
- `job_size` = `appetite` in weeks (`2-weeks → 2`, etc.).

**Worked example.** `user_business_value 8`, `time_criticality 5`, `risk_reduction_opportunity 3`,
4-week appetite:

```
cost_of_delay = 8 + 5 + 3 = 16
score = 16 / 4 = 4.0
```

**Why it ships.** WSJF/Cost-of-Delay is verified absent in the market-leading PM skill library.
It is the one framework here that makes **time-criticality** a first-class term — a bet that is
merely valuable ranks below one that is valuable *and* decays if delayed. Offer it when the PO's
real question is sequencing under a deadline. (WSJF has no confidence factor; it does not consume
the evidence band — call that out if the PO wants confidence reflected, and prefer RICE/ICE then.)

---

## ICE (impact × confidence × ease)

```
score = impact × confidence × ease            (each 1..10)
```

- `impact` — PO judgement, 1..10.
- `confidence` — **derived** (the ICE column of the band table: `round(mean)`, floored at 1).
- `ease` — inverse of effort, PO judgement 1..10 (a 2-week bet is easier than an 8-week one).

**Worked example.** `impact 7`, confidence block averaging 6 → `confidence 6`, `ease 8`:

```
score = 7 × 6 × 8 = 336
```

ICE is the quickest to run and the easiest to game — its `impact` and `ease` are unanchored PO
judgement. Deriving its confidence from the evidence band is what keeps at least one of its three
terms honest.

---

## Ranking and ties

- Sort by `score` **descending**; rank 1 builds first.
- Break ties by **smaller appetite** first (cheaper bet wins the tie), then by `id` ascending
  (stable, deterministic order).
- A bet still pointing at the `#tbd` outcome sentinel is ranked but flagged — its value is
  unvalidated on the axis that matters most; it belongs in `define-outcomes` first.
