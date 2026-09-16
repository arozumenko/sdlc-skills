# 06 — Industry standards for delivery-performance and estimate-vs-actual metrics

Research input for the "internal delivery performance tracker" spec (analogue of
`bundles/test-automation/skills/tokenomics/`, but attributing cycle time / cadence /
estimate-vs-actual to harness work items: campaign / mission / task / case).

Scope: what the primary sources define, how they say to measure, what they warn against.
This file does NOT propose the design; the last section lists implications only.
Everything marked **(inferred)** or **(secondary source)** is not a direct primary-source quote.
Research date: 2026-09-16.

---

## 0. Reading guide — per-metric fields

For every metric below the same fields are given where the source supports them:
**Name · Definition (start/stop) · Unit · Aggregation · Minimum sample · Pitfalls · Source.**
Where a source is silent on a field, the field says "not specified".

---

## 1. DORA — the "four keys" (now five)

Primary source: DORA metrics history page, https://dora.dev/insights/dora-metrics-history/ and the
2024 survey question bank, https://dora.dev/research/2024/questions/.

### 1.1 Current (2024+) definitions, exact wording from dora.dev

DORA groups the five metrics under **"Software Delivery Throughput"** and **"Software Delivery Instability"**:

| Group | Metric (current name) | DORA definition (verbatim) |
|---|---|---|
| Throughput | **Change Lead Time** | "Time from code commit to successful production deployment." |
| Throughput | **Deployment Frequency** | "How often application changes are deployed." |
| Throughput | **Failed Deployment Recovery Time** | "Time to recover from a failed deployment." |
| Instability | **Change Fail Rate** | "Percentage of deployments causing failures in production." |
| Instability | **Deployment Rework Rate** | "Percentage of deployments that are unplanned work to fix bugs." |

Note that DORA files *recovery time* under **throughput**, not stability (dora.dev history page).

### 1.2 Rename / addition history (dora.dev history page)

- **MTTR → "time to restore service" → "failed deployment recovery time" (2023).** Reason given: the older definition "did not distinguish between a failure initiated by a software change and a failure caused by external factors such as a data center outage"; the 2023 definition is strictly about restoring service after a *change to production* caused impairment.
- **Rework rate added in 2024** as a fifth metric. Reason quoted: "change failure rate — the percentage of deployments requiring hotfixes or rollbacks — acted as a proxy for the amount of rework a team must perform."
- The framing moved from "four keys, throughput vs stability" to a five-metric "throughput and instability" model. (Secondary write-ups: https://cd.foundation/blog/2025/10/16/dora-5-metrics/ ; https://octopus.com/devops/metrics/dora-metrics/.)

### 1.3 Exact measurement instruments (survey buckets) — dora.dev/research/2024/questions/

DORA's own data is **survey-bucketed, not telemetry**. The exact questions and response scales:

- **Lead time for changes:** "What is your lead time for changes (i.e., how long does it take to go from code committed to code successfully running in production)?" Options: *More than six months · Between one month and six months · Between one week and one month · Between one day and one week · Less than one day · Less than one hour · I don't know or NA*.
  - Start event = **code committed**; stop event = **code successfully running in production**.
- **Deployment frequency:** "How often does your organization deploy code to production or release it to end users?" Options: *Fewer than once per six months · Between once per month and once every 6 months · Between once per week and once per month · Between once per day and once per week · Between once per hour and once per day · On demand (multiple deploys per day) · I don't know or NA*.
- **Change failure rate:** "Approximately what percentage of changes to production or released to users result in degraded service (for example, lead to service impairment or service outage) and subsequently require remediation?" Option: 0–100 % value.
- **Failed deployment recovery time:** "How long does it generally take to restore service after a change to production or release to users results in degraded service?" Same six duration buckets as lead time.
- **Rework rate:** "Approximately what percentage of deployments in the last 6 months were not planned but were performed to address a user-facing bug?" 0–100 % value.

Implication for telemetry implementers: DORA gives *events* (commit; production deploy; degraded service; restore) and *log-scale buckets* (hour / day / week / month / six months); it does not prescribe mean vs median. Vendor implementations (LinearB, GetDX, Atlassian) conventionally use median or P75 (see §2.6).

### 1.4 DORA findings on AI adoption (2024 and 2025)

- **2024 report** (https://dora.dev/research/2024/dora-report/): "AI adoption significantly increases individual productivity, flow, and job satisfaction. However, it also negatively impacts software delivery stability and throughput." The widely-cited numbers (secondary: RedMonk https://redmonk.com/rstephens/2024/11/26/dora2024/ , GetDX): a **25 % increase in AI adoption ≈ 1.5 % decrease in throughput and 7.2 % decrease in stability**. Suggested (not proven) mechanism: larger batch sizes.
- **2025 report, "State of AI-assisted Software Development"** (https://dora.dev/dora-report-2025/ ; PDF https://services.google.com/fh/files/misc/2025_state_of_ai_assisted_software_development.pdf):
  - ~90 % of respondents use AI at work; median ~2 h/day (RedMonk summary https://redmonk.com/rstephens/2025/12/18/dora2025/).
  - Throughput relationship **flipped from negative to positive**: higher AI adoption now associated with "higher levels of software delivery throughput".
  - Stability did not improve: "AI adoption not only fails to fix instability, it is currently associated with increasing instability" (as quoted by RedMonk from the report).
  - Framing: "AI's primary role is as an amplifier, magnifying an organization's existing strengths and weaknesses" (dora.dev/dora-report-2025).
  - 2025 replaced the low/medium/high/elite performance tiers with **seven team archetypes** (e.g. "The Legacy Bottleneck", "The Harmonious High Achiever") and uses eight composite outcome measures: throughput, stability, team performance, product performance, individual effectiveness, time spent on valuable work, friction, burnout (RedMonk summary). RedMonk's critique: archetypes make longitudinal tracking harder than the old tiers.
- **DORA AI Capabilities Model** (companion, https://dora.dev/ai/capabilities-model/report/ ; PDF https://services.google.com/fh/files/misc/2025_dora_ai_capabilities_model.pdf). The seven capabilities: **(1) Clear and communicated AI stance, (2) Healthy data ecosystems, (3) AI-accessible internal data, (4) Strong version control practices, (5) Working in small batches, (6) User-centric focus, (7) Quality internal platforms.** (Google Cloud blog: https://cloud.google.com/blog/products/ai-machine-learning/introducing-doras-inaugural-ai-capabilities-model.) It is a *capabilities* model, not a metrics model — it does not define new delivery metrics.

### 1.5 Independent evidence on AI and delivery time

- **METR RCT (July 2025)**, https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ (arXiv 2507.09089): 16 experienced OSS developers, 246 tasks; with AI allowed, tasks took **19 % longer**; developers forecast 24 % faster beforehand and still believed 20 % faster afterwards. Relevance: **self-reported speed is not a substitute for measured elapsed time**; METR announced a redesign of the experiment in Feb 2026 (https://metr.org/blog/2026-02-24-uplift-update/).

---

## 2. Flow metrics — Flow Framework and Kanban

### 2.1 Flow Framework (Mik Kersten, *Project to Product*, 2018) — exact definitions

Source: https://flowframework.org/ffc-discover/ (registered-trademark names as printed there).

| Metric | Verbatim definition | Unit | Aggregation |
|---|---|---|---|
| **Flow Velocity®** | "The number of Flow Items of each type completed over a particular time period." | items / period, per type | count |
| **Flow Time** | "The time it takes for Flow Items to go from 'work start' to 'work complete', including both active and wait times." | elapsed time | not specified on the page |
| **Flow Efficiency®** | "The ratio of active time vs. wait time." | % | ratio |
| **Flow Load®** | "The number of Flow Items currently in progress in a value stream." | items | count (point-in-time) |
| **Flow Distribution®** | "The ratio of the four Flow Items completed over a particular time period." | % per type | ratio |

Four **Flow Items**: Features ("New value added to drive a business result"), Defects ("Fixes for quality problems that affect the customer experience"), Debts ("Improvement of the software architecture and operational architecture"), Risks ("Work to address security, privacy, and compliance exposures").

Flow Time start = "work start" (item pulled into active state), stop = "work complete"; it explicitly **includes wait time** (calendar clock, not effort). Flow efficiency numbers commonly reported by vendors are 15–25 % (secondary: LinearB/GetDX blogs) — this is folklore, not a Kersten-published benchmark.

**Flow efficiency pitfalls** (secondary sources: TechTarget "Flow efficiency is one of the trickiest DevOps metrics"; Nave "3 fundamentals of an accurate flow efficiency calculation"; B. Baketarić "You should not track flow efficiency!"): requires reliable capture of every active/wait transition; teams classify "Code Review" inconsistently as active or wait; it is gameable by reclassifying states; it is least reliable exactly where it would matter (many handoffs). **(inferred)** For an agent harness the only reliably observable "active" signal is the agent session itself, so flow efficiency is only defensible if active time is defined as *agent-session wall-clock inside the item's cycle*.

### 2.2 The Kanban Guide (May 2025) — mandatory flow measures, verbatim

Source: https://kanbanguides.org/the-kanban-guide/2025.5/ (also https://prokanban.org/the-kanban-guide).

- **WIP:** "The number of work items started but not finished."
- **Throughput:** "The number of work items finished per unit of time. Note the measurement of throughput is the exact count of work items."  (i.e. *count*, never points/size)
- **Work Item Age:** "The elapsed time between when a work item started and the current date."
- **Cycle Time:** "The elapsed time between when a work item started and when a work item finished."
- Start/finish are whatever the **Definition of Workflow (DoW)** declares: "A definition for when work items are started and finished within the workflow. Depending on the work item, your workflow may have more than one started or finished point."
- **Service Level Expectation (SLE):** "a forecast of how long it should take a work item to flow from started to finished. The SLE itself has two parts: a period of elapsed time and a probability associated with that period (e.g., '85% of work items will be finished in eight days or less')." The SLE "should be based on historical cycle time" and visualised on the DoW.
- The Guide does not mention Little's Law by name.

### 2.3 Lead time vs cycle time (naming)

Kanban community usage: **lead time** = request/arrival → delivered (customer clock); **cycle time** = started → finished (system clock); DORA's "lead time for changes" is narrower (commit → production). Vendors (LinearB) call first-commit → production "cycle time". **Pitfall:** the same word means different windows in different frameworks; every metric must state its start and stop event (this is also the explicit advice of the Kanban Guide's DoW and of the DX/Weave "time to first review" definitions, §5.5).

### 2.4 Vacanti — cycle time counting rules, percentiles, Little's Law

Sources: *Actionable Agile Metrics for Predictability* (2015), *When Will It Be Done?* (2020); Scrum.org "Getting to 85" series (https://www.scrum.org/resources/blog/getting-85-agile-metrics-actionableagile-part-1 … part-3); LEANability interview (https://www.leanability.com/en/blog/2017/08/littles-law-and-system-stability/); ProKanban.

- **Counting rule:** cycle time in whole days counts both start and finish day (finish − start + 1), so the minimum cycle time is 1 day and same-day items are not zero; **calendar** days, not business days — "flow metrics are calculated from the customer's perspective, and what customers care about is total elapsed time" (secondary: Planview/Teamhood/Scrum.org summaries of the book). **(inferred)** With hour-resolution timestamps the +1 convention is unnecessary; the principle that survives is *elapsed wall-clock, weekends included*.
- **Cycle-time scatterplot percentiles:** ActionableAgile plots each finished item's cycle time by finish date and draws **50 / 70 / 85 / 95 th** percentile lines by default; "the 85th percentile means that a typical right-sized work item entering your system has an 85% probability of being completed in less than that timeframe" (Scrum.org part 1). Illustrative: 16 days to reach P85, +7 more days to reach P95 — the *cost of confidence*.
- **Why not mean:** "an average tells the client when half the items will be done. An 85th percentile commitment means 17 out of 20 items will hit the date" (secondary summary of WWIBD). Vacanti quoting Sam Savage's flaw of averages: "plans based on averages will, on average, fail" (LEANability interview).
- **Work item age is the leading indicator**: aging items are what push P85/P95 up; compare each in-progress item's age against the SLE line (Scrum.org part 3).
- **Little's Law (flow form):** avg Cycle Time = avg WIP / avg Throughput. Vacanti's five assumptions (LEANability interview, verbatim):
  1. "The average input or arrival rate should be equal to the average output or departure rate."
  2. "Each piece of work started will be completed at some point and will also leave the system."
  3. "The Work in Progress should be the same at the beginning and at the end for the calculation of the chosen time interval."
  4. "The average age of Work in Progress neither increases nor decreases."
  5. "Cycle time, Work in Progress and throughput must be measured with consistent units."
  "Every time you act contrary to the fundamental assumptions, the process will be more unstable." And: Little's Law is "the measurement business, not the forecasting business" (Little, quoted by Vacanti) — it is a *consistency check on averages*, not a percentile forecaster.

### 2.5 Probabilistic forecasting — Monte Carlo, sample sizes

- **Two questions, two simulations** (Vacanti WWIBD; Magennis): single item → cycle-time percentile; many items → Monte Carlo over **throughput samples** ("how many by date X" / "when will N be done"). Report P50/P85/P95 of the simulated distribution.
- **Magennis sampling rule** (Troy Magennis, Focused Objective; reproduced at https://sep.com/blog/software-forecasting-my-process/ and his Medium series https://medium.com/forecasting-using-data): with *n* random samples the probability that the next value falls within the sample min–max is  n=5 → ~67 %, **7 → 75.0 %, 11 → 83.3 %, 20 → 90.5 %**. Practitioner quote: "When possible I use 20 samples (90%), but 7 samples (75%) or 11 samples (83%) will still get good results." His throughput spreadsheet uses **one week** as the sampling unit and ~500 trials; the Observable intro notebook uses 1 000 trials (page not fetchable: HTTP 429).
- **ProKanban "How much data do I need to start forecasting?"** (https://prokanban.org/blog/how-much-data-do-i-need-to-start-forecasting): "If you take a random sample of five items, there's a 93.75% chance that the median of the whole population sits between the smallest and largest of those five." Rule of thumb "around 10 to 20 data points to calculate limits with confidence"; keep "a rolling baseline of around 20 recent points"; "recency matters more than volume"; "Old data may describe a world that no longer exists."
- **Kanban pocket guide (ProKanban) on SLE**: "If historical cycle time data does not exist, a best guess will do until there is enough historical data for a proper SLE calculation."
- **Vendor tooling defaults** (secondary: ScopeCone, Expedia, Nave): ≥ 20–30 completed items of the same work type before trusting Monte Carlo; 1 000 iterations stabilise P50/P85/P95.
- **Stability prerequisite:** all of the above assume a reasonably stable process (Little's Law assumptions §2.4); a process change invalidates older samples.

### 2.6 Vendor cycle-time decompositions (PR-centric, relevant for a dispatch→merge clock)

- **LinearB** (https://linearb.helpdocs.io/article/0vif1ihmgc-how-is-cycle-time-calculated): Cycle Time = Coding Time + Pickup Time + Review Time + Deploy Time.
  - *Coding time*: "the first commit on a branch" → PR opened.
  - *Pickup time*: PR opened → "the first non-author comment" (or approval/merge if no comments).
  - *Review time*: review begins → PR merged; **PRs with no comments get review time 0**.
  - *Deploy time*: merge → release tag.
  - LinearB *averages* phase durations across all branches in the period and includes incomplete branches' finished phases (its docs state mean, not median). Its benchmark report uses **P75** for tiering (secondary: 2026 benchmarks — Elite cycle time < 25 h, Good 25–72 h, Fair 73–161 h, Needs focus > 161 h; elite pickup < 1 h, review < 3 h, deploy < 16 h — https://linearb.io/resources/software-engineering-benchmarks-report).
  - LinearB "rework rate" = share of code rewritten within 21 days of merge; "refactor rate" = rewrite of code older than 21 days (secondary; the 2025 blog page did not expose the table).
- **GitClear "code churn"** = lines reverted/rewritten within 2 weeks of authoring; reported 3.3 % (2021) → 5.7 % (2024) → 7.1 % (2025) on AI-assisted repos (secondary, via Augment/Faros summaries).

---

## 3. SPACE, DevEx, and the anti-patterns (Goodhart / Campbell)

### 3.1 SPACE (Forsgren, Storey, Maddila, Zimmermann, Houck, Butler — ACM Queue 19(1), 2021)

Primary: https://queue.acm.org/detail.cfm?id=3454124 (403 to fetch; content confirmed via CACM reprint and Microsoft Research listing https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/).

- Five dimensions: **S**atisfaction & well-being · **P**erformance (outcomes, quality, impact) · **A**ctivity (counts of actions) · **C**ommunication & collaboration · **E**fficiency & flow (ability to make progress with minimal interruptions; handoffs, time-in-process).
- Three myths the paper opens with: productivity is all about developer activity; productivity is only about individual performance; one productivity metric can tell us everything.
- Prescriptions (as summarised across secondary sources; the exact wording is in the paper): pick metrics from **at least three dimensions**; include **at least one perceptual (survey) measure** alongside system data; measure at individual, team and system levels; **don't use too many metrics**; activity metrics "should never be used in isolation" and are not performance indicators.
- Explicit Goodhart-style caution: metrics that become targets are gamed; the paper warns that "some metrics are more prone to gaming than others".

### 3.2 DevEx (Noda, Storey, Forsgren, Greiler — ACM Queue 21(2), 2023; "DevEx in Action" 21(6))

https://queue.acm.org/detail.cfm?id=3595878 and https://queue.acm.org/detail.cfm?id=3639443. Three core dimensions: **feedback loops, cognitive load, flow state**; recommends pairing perceptual measures (surveys) with workflow measures (e.g. time-to-first-review, build time). "DevEx in Action" reports quantitative links between DevEx and productivity outcomes.

### 3.3 Goodhart / Campbell and the McKinsey episode

- Goodhart (as popularised by Strathern, 1997): "When a measure becomes a target, it ceases to be a good measure." Campbell (1979): "The more any quantitative social indicator is used for social decision-making, the more subject it will be to corruption pressures…".
- 2023 McKinsey "Yes, you can measure software developer productivity" drew rebuttals from Kent Beck and Gergely Orosz (https://newsletter.pragmaticengineer.com/p/measuring-developer-productivity , part 2), Dan North (https://dannorth.net/blog/mckinsey-review/), Dave Farley (GOTO 2025 talk). Beck: "This article gets some things right about system-level metrics, but the individual metrics are dangerous." Critique line: 4 of McKinsey's 5 novel metrics measure effort/output rather than outcome; individual contribution "is like trying to measure the individual contribution of a piston in an engine".
- **Velocity/story points:** "When velocity becomes a target, teams may inflate estimates or split tasks unnaturally" (multiple secondary); Ron Jeffries (2019): "I may have invented story points, and if I did, I'm sorry now" — his objection is specifically to using them to predict finish dates and to compare teams. Story points are team-local, ordinal, and non-additive across teams.
- **Augment Code "Software factory metrics"** (https://www.augmentcode.com/guides/software-factory-metrics), for agent fleets: never route metrics to personal reviews; no token-spend leaderboards ("When a metric becomes a target, it stops being a good measure"); **do not blend agentic, AI-assisted and unassisted PRs without segmentation**; say/do ratio "degrades when used as performance target"; "P50/P85/P95 cycle time percentiles predict forecast reliability better than averages".

### 3.4 Consolidated "what NOT to do" list (all sourced above)

1. Do not use a single metric; pair throughput with a stability/quality metric (DORA) and with a perceptual one (SPACE).
2. Do not use velocity / story points as a productivity target or compare them across teams (Jeffries, SPACE, Goodhart).
3. Do not rank individuals (Beck, Farley, Augment) — for a harness, the analogue is *not ranking individual agents/roles as "productive"* **(inferred)**.
4. Do not report means of skewed durations; use median/P85 (Vacanti, Augment, LinearB P75).
5. Do not blend populations with different producers (human / assisted / agentic) (Augment, DX).
6. Do not trust self-reported speed-up (METR).
7. Do not read activity counts (LOC, suggestions, tokens) as delivery (SPACE; DX framework "deliberately excludes acceptance rates and lines of code").

---

## 4. Estimate-vs-actual practice

### 4.1 Point-estimate accuracy statistics (Conte, Dunsmore & Shen 1986; Shepperd & MacDonell 2012)

| Statistic | Definition | Notes / source |
|---|---|---|
| **MRE** | \|actual − estimate\| / actual | per item; Conte et al. |
| **MMRE** | mean of MRE over N items | classic threshold "MMRE ≤ 0.25 acceptable" (Conte); **biased toward under-estimation** and dominated by outliers — deprecated by Shepperd & MacDonell, *Evaluating prediction systems in software project estimation*, IST 54(8) 2012, https://arxiv.org/abs/2101.05426 ; see also "When should we (not) use MMRE…" IST 2021, https://www.sciencedirect.com/science/article/abs/pii/S0950584921002263 |
| **MdMRE** | median of MRE | robust variant, still asymmetric |
| **PRED(25)** | share of items with MRE ≤ 0.25 | classic threshold "PRED(25) ≥ 0.75 acceptable" (Conte) |
| **MAE** | mean \|actual − estimate\| | unbiased; the Shepperd/MacDonell recommendation |
| **SA (Standardised Accuracy)** | 1 − MAE / MAE_random-guessing | compares against a random baseline; effect size vs guessing (Shepperd & MacDonell) |
| **BRE (balanced relative error)** | \|a − e\| / min(a, e) | symmetric alternative in the same literature |
| **Estimate-to-actual ratio** | actual / estimate (or log ratio) | practitioner ratio; >1 = overrun; symmetric in log space **(inferred)** |

Aggregation guidance from this literature: use **MAE or median-based** statistics, report the *distribution* of ratios, and always compare against a naïve baseline.

### 4.2 Interval / probabilistic estimates and calibration

- **Three-point / PERT:** E = (O + 4M + P) / 6, σ ≈ (P − O) / 6 (PMI PMBOK; Wikipedia "Three-point estimation").
- **Cone of uncertainty** (McConnell, *Software Estimation: Demystifying the Black Art*, 2006; Boehm 1981): estimate error bands by phase — Initial concept **0.25×–4×**, Approved product definition 0.5×–2×, Requirements complete 0.67×–1.5×, UI design complete 0.8×–1.25×, Detailed design 0.9×–1.1×. McConnell's caveat (quoted at https://blog.codinghorror.com/the-mysterious-cone-of-uncertainty/): "The Cone of Uncertainty represents the best-case accuracy that is possible … It is easily possible to do worse." The cone narrows only through active decisions, not with time. (Laurent Bossavit's *Leprechauns of Software Engineering* disputes the empirical basis of the cone — not fetched here, noted for completeness.)
- **Hit rate of ranged estimates** (Jørgensen et al., Simula, "The Ignorance of Confidence Levels in Minimum-Maximum Effort Intervals", https://web-backend.simula.no/sites/default/files/publications/Simula.simula.2500.pdf): when professionals give a **90 % confidence min–max interval, the actual lands inside it only 60–70 %** of the time. Recommended evaluation of probabilistic estimates: **calibration** (does pX cover X %?) **and informativeness** (interval width) together (Jørgensen, IST 2019, "Evaluating probabilistic software development effort estimates: Maximizing informativeness subject to calibration"). Practical method from the same group: derive intervals from the empirical distribution of the estimator's *previous* accuracy (IST 2003, "An effort prediction interval approach based on the empirical distribution of previous estimation accuracy") — i.e. **calibrate each estimator against their own history**.
- **Reference class forecasting** (Flyvbjerg; PMI library https://www.pmi.org/learning/library/nobel-project-management-reference-class-forecasting-8068): take the *outside view* — the distribution of outcomes for a reference class of similar past items — rather than the inside view of the plan. Requires a class "broad enough to be statistically meaningful but narrow enough to be truly comparable". 2025 review of promises/problems: https://www.tandfonline.com/doi/full/10.1080/09537287.2025.2578708.
- **Calibrated probability assessment** (Wikipedia entry as pointer): a calibrated estimator's "X % confident" claims come true X % of the time; calibration is trainable and measurable.

### 4.3 #NoEstimates

Duarte / Zuill / Killick: counting stories forecasts about as well as summing story points once items are sliced to similar size; forecast with **throughput** rather than effort estimates; "#NoEstimates is not about no estimation ever, but about the minimum amount of estimates that will do" (t2informatik / InfoQ book review https://www.infoq.com/articles/book-review-noestimates). Counter-position: estimates remain useful for *decisions* (build/not build) and for calibration; the movement's real claim is that **count-based forecasting on historical throughput** outperforms effort-point arithmetic.

### 4.4 Commitment reliability measures

- **SAFe Program Predictability Measure (PPM)** (Scaled Agile Framework, "Metrics"): actual business value achieved ÷ planned business value for the PI, per team and rolled up per ART; **80–100 %** is the stated healthy range (secondary: Planview, agility-at-scale). Note it is BV-weighted, not item-count-based; "stretch objectives" are excluded from the plan denominator.
- **Say/do ratio** = items delivered ÷ items committed in a timebox. Widely used, widely gamed (under-commit). Augment: "degrades when used as performance target"; AgileSeekers distinguishes *predictability* (forecast accuracy) from *reliability* (delivering what was committed).
- **On-time delivery %** = share of items finished on or before their committed/forecast date; only meaningful when the "date" is a probabilistic SLE, in which case the *expected* on-time rate equals the SLE percentile (85 %) and observed rates far above it indicate padding, far below indicate an unstable process **(inferred from SLE definition)**.
- **Earned value (PMI PMBOK):** SPI = EV / PV (schedule efficiency; 1.0 = on plan; < 1 behind), SV = EV − PV; CPI = EV / AC. Source: https://www.pmi.org/learning/library/practical-calculation-schedule-variance-7028. Applicable only when a planned value curve exists — heavyweight for a task tracker.
- **ISO/IEC/IEEE 15939** (Measurement process) — the formal "measurement information model" (base measure → derived measure → indicator, each with a stated measurement method and decision criteria). Not fetched; cited as the standard that legitimises the "name / definition / unit / method / decision criterion" template used in this report.

---

## 5. Agentic-specific: what the tools expose (2025–2026)

### 5.1 Claude Code Analytics Admin API (Anthropic)

Docs: https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api ; endpoint `GET /v1/organizations/usage_report/claude_code`, params `starting_at` (UTC `YYYY-MM-DD`, single day), `limit` (default 20, max 1000), `page` (cursor). One record per **actor per day**. Exact fields:

- Dimensions: `date`, `actor` (`user_actor.email_address` | `api_actor.api_key_name`), `organization_id`, `customer_type` (`api` | `subscription`), `terminal_type`.
- `core_metrics`: `num_sessions`, `lines_of_code.added`, `lines_of_code.removed`, `commits_by_claude_code`, `pull_requests_by_claude_code`.
- `tool_actions`: `edit_tool.accepted/rejected`, `multi_edit_tool.accepted/rejected`, `write_tool.accepted/rejected`, `notebook_edit_tool.accepted/rejected` (acceptance rate = accepted / (accepted + rejected)).
- `model_breakdown[]`: `model`, `tokens.input/output/cache_read/cache_creation`, `estimated_cost.amount` (cents), `estimated_cost.currency`.
- Not available: anything per work item, per PR, or any duration (cycle time, time-to-merge). Data lag ≤ 1 h; daily only; OpenTelemetry integration for finer grain (https://code.claude.com/docs/en/monitoring-usage).

### 5.2 GitHub Copilot usage metrics (2026 reports)

Docs: https://docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics and REST https://docs.github.com/en/rest/copilot/copilot-metrics (the REST endpoint now returns `download_links`, `report_day` / `report_start_day` / `report_end_day`; daily and 28-day reports; history "up to 1 year"). Fields in the report files, per user-day: `day`, `user_id`, `user_login`, `ai_credits_used`, `user_initiated_interaction_count`, `code_generation_activity_count`, `code_acceptance_activity_count`, `loc_suggested_to_add_sum`, `loc_suggested_to_delete_sum`, `loc_added_sum`, `loc_deleted_sum`; feature flags `used_agent`, `used_chat`, `used_cli`, `used_copilot_app`, `used_copilot_cloud_agent`, `used_copilot_coding_agent`, `used_copilot_code_review_active/passive`; `ai_adoption_phase{phase_number, phase, version}`; breakdown dims `feature`, `ide`, `model`, `language`.
**Pull-request block (the only delivery-time fields any vendor exposes):** `total_created`, `total_reviewed`, `total_merged`, **`median_minutes_to_merge`**, `total_suggestions`, `total_applied_suggestions`, `total_created_by_copilot`, `total_reviewed_by_copilot`, `total_merged_created_by_copilot`, **`median_minutes_to_merge_copilot_authored`**, `total_copilot_suggestions`, `total_copilot_applied_suggestions`. CLI block: `session_count`, `request_count`, `prompt_count`, `output_tokens_sum`, `prompt_tokens_sum`. Older (2024) metrics API objects: `total_active_users`, `total_engaged_users`, `copilot_ide_code_completions.total_code_suggestions/acceptances/lines_suggested/lines_accepted`, `copilot_dotcom_pull_requests.total_pr_summaries_created`, `copilot_ide_chat.total_chats/total_chat_insertion_events/total_chat_copy_events` (viewer project https://github.com/github-copilot-resources/copilot-metrics-viewer).
Takeaway: GitHub already segments **agent-authored PRs** and reports **median** minutes-to-merge for them separately from human-authored — a precedent for both the segmentation and the aggregation choice.

### 5.3 Cursor Admin API

`POST https://api.cursor.com/teams/daily-usage-data` (`startDate`, `endDate`, `page`, `pageSize`): per user-day `totalLinesAdded`, `totalLinesDeleted`, `acceptedLinesAdded`, `acceptedLinesDeleted`, `totalApplies`, `totalAccepts`, `totalRejects`, `totalTabsShown`, `totalTabsAccepted`, `composerRequests`, `chatRequests`, `agentRequests` (https://cursor.com/docs/account/teams/admin-api). Community reports of acceptance rates > 100 % due to counting anomalies (forum thread 131616) — a caution about trusting vendor acceptance counters. No delivery-time fields.

### 5.4 Engineering-intelligence vendors and research reports

- **DX AI Measurement Framework** (Noda & Tacho, July 2025; https://getdx.com/research/measuring-ai-code-assistants-and-agents/): three dimensions **Utilization · Impact · Cost**; impact split into direct (time saved / dev / week) and indirect (**PR throughput**, perceived delivery rate, Developer Experience Index, change failure rate, maintainability); cost = spend per developer. It "deliberately excludes acceptance rates and lines of code". On agents: measure them "as extensions of the developers and teams that oversee their work" and include agent-authored PRs in team throughput.
- **Jellyfish 2025 AI metrics in review** (https://jellyfish.co/blog/2025-ai-metrics-in-review/): metrics = PR throughput (weekly merged PRs per engineer, 3-month average), median cycle time (hours), **review rounds on AI-assisted PRs**, AI code % (share of merged additions that were AI-assisted), **autonomous agent activity** (% of PRs whose opening user id is an agent), bug-fix share of PRs. Findings: PRs/engineer 1.36 → 2.9 at full adoption (+113 %); median cycle time 16.7 → 12.7 h (−24 %); bug-fix PRs 7.5 % → 9.5 %.
- **Faros AI 2026 "Acceleration Whiplash"** (22 000 devs / 4 000 teams; https://www.faros.ai/blog/ai-acceleration-whiplash-takeaways ; PDF https://pages.faros.ai/hubfs/AI_Engineering_Report_2026_The_Acceleration_Whiplash_Faros.pdf): task throughput per developer +33.7 %, epics completed per developer +66 %, PR merge rate per developer +16.2 %; **median time in code review +441.5 %**; bugs per developer +54 %; incidents per PR +243 %; code churn +861 %; no-review merges +31 %; AI-assisted PRs ~2.5× larger; first-reviewer wait ~16 h vs ~200 min for human-authored (secondary summaries; the PDF is the primary).
- **LinearB 2026 benchmarks** (8.1 M PRs): AI-assisted PRs wait ~5× longer for pickup (secondary).
- **Augment Code "Software factory metrics"** (§3.3): proposes **PR yield** = share of opened PRs merged within 30 days (top decile: 79 % of agent-opened vs 92 % human-only), *reviewed changes per reviewer per period* as the binding-constraint metric, *code turnover ratio* (post-acceptance rewrite of AI code; "no published benchmarks yet"), segmentation by producer.
- **Anthropic 2026 Agentic Coding Trends Report** (early 2026; secondary coverage https://dev.to/amitba/... and others): reports session volumes, multi-agent share of complex tasks, share of merged code authored by Claude — usage/adoption framing; it does **not** publish a cycle-time or estimate-accuracy methodology.

### 5.5 Definitions used for PR-level agent metrics (converging vendor vocabulary)

| Metric | Start → stop | Aggregation seen in the wild | Source |
|---|---|---|---|
| Time to first review / pickup time | PR opened → first non-author review or comment | median; LinearB elite < 1 h | LinearB docs; Code Climate Velocity; Weave glossary ("most useful when the team states the unit of analysis, the start event, the completion event, and the population") |
| Review time | first review → merge | median / P75 | LinearB |
| Time to merge | PR opened → merged | **median** (`median_minutes_to_merge`) | GitHub Copilot metrics |
| Review rounds | count of review→re-request cycles before merge | count per PR; distribution | Jellyfish |
| First-pass acceptance | share of agent PRs merged without a rework cycle | % (32.7 % cited for AI PRs, secondary) | Augment / LinearB |
| PR yield | share of opened PRs merged within 30 d | % | Augment |
| Revert rate | merged PRs reverted within 30 / 90 d ÷ merged PRs | % | Larridin, GitKraken, minware |
| Rework / churn | lines rewritten within 14 d (GitClear) or 21 d (LinearB) of merge | % of lines | GitClear, LinearB |
| Deployment rework rate | unplanned deployments to fix user-facing bug ÷ deployments | % | DORA 2024 |

---

## 6. Cadence: throughput per week, windows, zero weeks, sample sizes

- **Unit of throughput** is the *count* of finished items per period (Kanban Guide: "the exact count of work items"). Period = whatever the DoW says; practitioners default to **per week** "to simplify communication" (Magennis via sep.com) and because weekly buckets damp the day-of-week signal.
- **Whole-period rule**: only complete periods enter a throughput sample; the current partial week is excluded from forecasting (Nave / ActionableAgile throughput-histogram docs; the tools let you *uncheck* weeks that "do not reflect your team throughput", e.g. holiday weeks). **(inferred)** For a report this means: show the partial current week but flag it and exclude it from percentiles.
- **Zero-filling**: throughput histograms include zero-throughput periods by default; ActionableAgile/Nave offer excluding zero *days* caused by non-work days, and explicitly note that averages with and without weekend zeros differ. For Monte Carlo, zero weeks are real samples and should be kept unless the team was genuinely absent (they lower the forecast, correctly, when the harness was idle for a week) **(inferred from the tool documentation)**.
- **Rolling window / recency**: ProKanban — ~20 recent points as a rolling baseline; "15 fresh data points outperform 150 old ones". Vendors (Jellyfish) use a 3-month rolling average for PRs/engineer/week. A process change (new model, new review policy) resets the reference class.
- **Minimum sample thresholds (collected)**:
  - Magennis: 5 minimum, 7 ≈ 75 %, 11 ≈ 83 %, 20 ≈ 90 % coverage of next value by sample range.
  - ProKanban: 5 items already brackets the population median with 93.75 % probability; 10–20 for limits; 20 rolling.
  - Tool defaults: ≥ 20–30 completed items of the same type for Monte Carlo; 1 000 trials.
  - GitHub Copilot metrics: **5-member minimum** before per-team data is exposed (privacy floor, secondary) — a precedent for suppressing small-n slices.
- **Percentile reporting floor** **(inferred from the above)**: P50 needs ~5–7 items to be stated at all; P85 needs ≥ 20 (with 7 items the 85th percentile is the max or second-max value); P95 needs ≥ 20–30. Below the floor, report the range (min–max) and n instead of a percentile.

---

## 7. Metric cards (consolidated)

Each card: name · definition (start→stop) · unit · aggregation · min sample · pitfalls · source.

1. **Cycle time (item)** — started → finished per DoW · elapsed calendar time (h or d, +1-day rule when day-resolution) · **median and P85** on a scatterplot; never mean · P50 ≥ 5–7, P85 ≥ 20 · start/stop drift, mixing item types, mean on skewed data · Kanban Guide 2025; Vacanti.
2. **Work item age** — started → now for unfinished items · elapsed · per item vs SLE line · n/a · only leading indicator available for WIP · Kanban Guide; Vacanti.
3. **Throughput** — count finished per whole period · items/week · per-period count, then percentiles of the series · ≥ 7–11 periods (Magennis), 20 preferred · partial periods, points instead of counts, mixing types · Kanban Guide; Magennis.
4. **WIP / Flow Load** — started-not-finished at time t · items · point-in-time series · n/a · Little's Law check: WIP ≈ throughput × cycle time only under stability · Kanban Guide; Flow Framework; Vacanti.
5. **Flow distribution** — share of finished items by type per period · % · ratio · n/a · type taxonomy must be fixed · Flow Framework.
6. **Flow efficiency** — active ÷ (active + wait) inside cycle time · % · ratio · n/a · active-time capture unreliable; gameable · Flow Framework; TechTarget/Nave.
7. **SLE** — "X % of items finish in ≤ D" · (percentile, duration) pair · from historical cycle-time percentile · "best guess" until data exists · quoting an average as a promise · Kanban Guide 2025.
8. **Lead time for changes (DORA)** — commit → running in production · duration; DORA reports buckets (< 1 h … > 6 mo) · vendors: median/P75 · n/a · "commit" of what? first commit vs merge commit · dora.dev.
9. **Deployment frequency** — deploys to production per period · deploys/period · count · n/a · batching · dora.dev.
10. **Change fail rate** — % of changes causing degraded service needing remediation · % · ratio over window · needs ≥ tens of changes · defining "failure" · dora.dev.
11. **Failed deployment recovery time** — degraded service after a change → restored · duration · median (vendors) · rare events → tiny n · exclude non-change incidents · dora.dev (2023 rename).
12. **Deployment rework rate** — unplanned bug-fix deployments ÷ deployments (6-month window in the survey) · % · ratio · window ≥ dozens of deploys · classifying "unplanned" · dora.dev (2024).
13. **Time to first review / pickup** — PR opened → first non-author review/comment · duration · median · n/a · bots as "reviewers"; no-review merges count as 0 in LinearB · LinearB; Weave.
14. **Review rounds** — count of review cycles before merge · count · distribution/median · n/a · what counts as a round must be explicit · Jellyfish.
15. **First-pass merge rate / PR yield** — merged with 0 rework rounds ÷ opened; merged within 30 d ÷ opened · % · ratio · ≥ 20 PRs · segment by producer (agent/human) · Augment; LinearB.
16. **Revert rate** — merged PRs reverted within 30/90 d ÷ merged · % · ratio · rare events · attribution of the revert to the PR · Larridin/GitKraken.
17. **Estimate accuracy (point)** — per item MRE, or actual/estimate ratio · dimensionless · **MdMRE, PRED(25), MAE** rather than MMRE · ≥ 20 items · MMRE bias to under-estimation · Conte 1986; Shepperd & MacDonell 2012.
18. **Estimate calibration (interval)** — hit rate of pX intervals vs X · % · hit rate + interval width · ≥ 20 items · overconfidence (90 % → 60–70 % observed) · Jørgensen.
19. **Commitment reliability (say/do, PPM, on-time %)** — delivered ÷ committed per timebox; finished on/before SLE date · % · ratio · per timebox, trend over ≥ 5 timeboxes · sandbagging when targeted; healthy range 80–100 % (SAFe) · SAFe; Augment.

---

## 8. Implications for the spec (facts → constraints; not a design)

Given the harness clock is **dispatch → merge** and the workers are AI agents:

1. **Declare the Definition of Workflow explicitly.** Every metric needs a named start and stop event on the harness's own items (campaign / mission / task / case). The industry-consistent mapping is: *started* = dispatch of the item to an agent; *finished* = merge of the item's branch (or the case's PASS receipt). Anything else (created→dispatch backlog wait, merge→deploy) is a **different** metric and must be named as such (Kanban Guide DoW; DORA commit→production is *not* what the harness measures unless it also observes deploys).
2. **Minimal defensible set** (each one has a primary-source definition and a non-mean aggregation): (a) **cycle time** per item type, reported as **median and P85** with n, plus min–max when n < 20; (b) **work item age** for in-flight items against the P85 SLE line; (c) **throughput** as *counts* per whole ISO week, per item type, zero weeks included, current partial week flagged; (d) **WIP** as a point-in-time series (enables the Little's Law sanity check); (e) **rework signal** appropriate to the clock — *review rounds* and *first-pass merge rate* on the item's PR, and *revert within 30 d* if merges are observable; (f) **estimate-vs-actual** as the per-item **actual/estimate ratio** distribution (median, PRED(25), MAE), never MMRE alone; (g) if ranged estimates exist, the **hit rate** of the stated confidence.
3. **Aggregation rules the sources agree on:** medians/percentiles for durations; counts for throughput; ratios for rates; never report a percentile whose rank exceeds the sample (P85 with n < 7 is the max). Suppress or annotate small-n slices (GitHub's 5-member floor is precedent).
4. **Segmentation is mandatory, ranking is prohibited.** Segment by item type (campaign/mission/task/case ≈ Flow Distribution types), by producer (agent role / model), and by reference class for estimates — but the SPACE/Beck/Augment guidance says not to turn per-role or per-agent numbers into leaderboards. Cost-per-item already lives in `tokenomics`; the new tracker should join on the same item ids rather than re-derive cost **(inferred; tokenomics SKILL.md keys its receipts by batch/case id)**.
5. **Calibrate estimators against their own history** (Jørgensen; reference-class forecasting). The tracker's estimate data becomes valuable only when the *same estimator* (the harness's planning role) is compared to its own past ratios per item type; a rolling reference window (~20 recent items) is the published default.
6. **Forecasting is a derived feature, not a metric.** Once ≥ 11–20 weekly throughput samples exist, a Monte Carlo "when will the campaign finish" at P50/P85/P95 is the standard next step; below that threshold the sources say to show the range and say "not enough data".
7. **Do not** ship: mean cycle time as the headline, story-point velocity, per-agent productivity scores, flow efficiency without a defined active-time signal, LOC/token counts presented as delivery, or self-assessed speed-ups.

---

## Sources (primary first)

- DORA metrics history — https://dora.dev/insights/dora-metrics-history/
- DORA 2024 survey questions — https://dora.dev/research/2024/questions/
- DORA 2024 report — https://dora.dev/research/2024/dora-report/
- DORA 2025 report — https://dora.dev/dora-report-2025/ ; PDF https://services.google.com/fh/files/misc/2025_state_of_ai_assisted_software_development.pdf
- DORA AI Capabilities Model — https://dora.dev/ai/capabilities-model/report/ ; https://cloud.google.com/blog/products/ai-machine-learning/introducing-doras-inaugural-ai-capabilities-model
- RedMonk on DORA 2024 / 2025 — https://redmonk.com/rstephens/2024/11/26/dora2024/ ; https://redmonk.com/rstephens/2025/12/18/dora2025/
- METR early-2025 RCT — https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ ; https://arxiv.org/abs/2507.09089
- Flow Framework — https://flowframework.org/ffc-discover/
- The Kanban Guide (May 2025) — https://kanbanguides.org/the-kanban-guide/2025.5/
- ProKanban, "How much data do I need to start forecasting?" — https://prokanban.org/blog/how-much-data-do-i-need-to-start-forecasting
- ProKanban Kanban Pocket Guide ch. 2 (SLE) — https://www.prokanban.org/blog/https-prokanban-org-blog-the-kanban-pocket-guide-chapter-2-the-service-level-expectation
- Scrum.org "Getting to 85" parts 1–3 — https://www.scrum.org/resources/blog/getting-85-agile-metrics-actionableagile-part-1
- LEANability interview with Vacanti (Little's Law) — https://www.leanability.com/en/blog/2017/08/littles-law-and-system-stability/
- Magennis, Observable intro — https://observablehq.com/@troymagennis/introduction-to-monte-carlo-forecasting ; sampling rule reproduced at https://sep.com/blog/software-forecasting-my-process/
- Nave throughput histogram — https://getnave.com/throughput-histogram ; ActionableAgile docs https://55degrees.atlassian.net/wiki/spaces/AAS/pages/717291773/Throughput+Histogram
- SPACE (ACM Queue 2021) — https://queue.acm.org/detail.cfm?id=3454124
- DevEx (ACM Queue 2023) — https://queue.acm.org/detail.cfm?id=3595878 ; https://queue.acm.org/detail.cfm?id=3639443
- Beck / Orosz McKinsey response — https://newsletter.pragmaticengineer.com/p/measuring-developer-productivity ; Dan North — https://dannorth.net/blog/mckinsey-review/
- Shepperd & MacDonell 2012 — https://arxiv.org/abs/2101.05426 ; MMRE critique 2021 — https://www.sciencedirect.com/science/article/abs/pii/S0950584921002263
- Jørgensen, Ignorance of confidence levels — https://web-backend.simula.no/sites/default/files/publications/Simula.simula.2500.pdf ; calibration/informativeness — https://www.sciencedirect.com/science/article/abs/pii/S0950584919301703
- Cone of uncertainty (McConnell via Atwood) — https://blog.codinghorror.com/the-mysterious-cone-of-uncertainty/
- Reference class forecasting — https://www.pmi.org/learning/library/nobel-project-management-reference-class-forecasting-8068 ; https://www.tandfonline.com/doi/full/10.1080/09537287.2025.2578708
- PMI schedule variance / SPI — https://www.pmi.org/learning/library/practical-calculation-schedule-variance-7028
- #NoEstimates — https://www.infoq.com/articles/book-review-noestimates
- SAFe PPM (secondary) — https://blog.planview.com/reignite-your-safe-journey-with-flow-metrics/
- Claude Code Analytics API — https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api
- GitHub Copilot usage metrics — https://docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics ; REST https://docs.github.com/en/rest/copilot/copilot-metrics
- Cursor Admin API — https://cursor.com/docs/account/teams/admin-api
- DX AI Measurement Framework — https://getdx.com/research/measuring-ai-code-assistants-and-agents/
- Jellyfish 2025 AI metrics — https://jellyfish.co/blog/2025-ai-metrics-in-review/
- Faros AI 2026 report — https://www.faros.ai/blog/ai-acceleration-whiplash-takeaways
- LinearB cycle-time calculation — https://linearb.helpdocs.io/article/0vif1ihmgc-how-is-cycle-time-calculated ; benchmarks https://linearb.io/resources/software-engineering-benchmarks-report
- Augment Code, Software factory metrics — https://www.augmentcode.com/guides/software-factory-metrics
- Time-to-first-review / revert-rate glossaries — https://docs.velocity.codeclimate.com/en/articles/2913584-time-to-first-review ; https://weaveos.com/glossary/time-to-first-review ; https://larridin.com/blog/ai-code-quality-revert-rate
