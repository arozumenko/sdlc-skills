<!--
  priority-block.md — the `priority:` frontmatter block prioritize-bets writes onto each scored
  hypothesis, on the PO's explicit confirm. It replaces the born-empty `priority: {}`.

  ONE shape per framework — write only the block matching the active framework (from
  `.agents/profile.md`'s `prioritization:` note, or RICE if that note is absent). RICE and ICE
  carry a DERIVED confidence; WSJF has no confidence term and carries none. Every shape
  carries: framework, its inputs, the DERIVED confidence, score, scored_on (today), rank, and
  evidence_note (the derivation, verbatim).

  These sub-fields are not schema-checked elsewhere, so keep them exactly as below. Values shown
  are illustrative.
-->

# RICE (default) — replace `priority: {}` with:
priority:
  framework: RICE
  reach: "200 users/quarter"       # a number in the profile note's rice.reach_unit (or the reference default)
  impact: 2                        # from impact_scale: massive 3 / high 2 / medium 1 / low 0.5 / minimal 0.25
  confidence: 0.8                  # DERIVED — 0.2 gut / 0.5 structured / 0.8 data-backed / 1.0 tested
  effort: 4                        # appetite in weeks (2-weeks→2, 4-weeks→4, 8-weeks→8)
  score: 80                        # round((reach × impact × confidence) / effort)
  scored_on: 2026-08-01
  rank: 1
  evidence_note: "confidence derived from value:6 usability:5 feasibility:7 viability:6 → mean 6.0 (data-backed band) → 0.8"

# WSJF — replace `priority: {}` with:
priority:
  framework: WSJF
  user_business_value: 8           # config scale (default modified Fibonacci 1..20)
  time_criticality: 5
  risk_reduction_opportunity: 3
  cost_of_delay: 16                # = the three components summed
  job_size: 4                      # appetite in weeks
  score: 4.0                       # cost_of_delay / job_size
  scored_on: 2026-08-01
  rank: 1
  evidence_note: "WSJF has no confidence factor — does not consume the evidence band; job_size = 4-week appetite"

# ICE — replace `priority: {}` with:
priority:
  framework: ICE
  impact: 7                        # 1..10, PO judgement
  confidence: 6                    # DERIVED — round(mean of the confidence block), floored at 1
  ease: 8                          # 1..10, inverse of effort
  score: 336                       # impact × confidence × ease
  scored_on: 2026-08-01
  rank: 1
  evidence_note: "confidence derived from value:6 usability:5 feasibility:7 viability:6 → mean 6.0 (data-backed band) → 6"
