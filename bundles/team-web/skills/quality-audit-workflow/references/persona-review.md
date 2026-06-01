# Persona Review

Evaluate a page or feature through the eyes of diverse, realistic users.
Each persona brings a different background, tech literacy, and set of expectations —
surfacing issues that a single-perspective review would miss.

---

## When to Use

| Trigger | What happens |
|---------|--------------|
| "persona analysis", "user feedback", "what would users think" | Full review: 6 personas, scored, reported |
| During any specialist pass | Quick lens: 4 archetypes inform priority adjustments |

---

## Quick Persona Lens (for specialists)

Every specialist should consider findings through these 4 user archetypes
when evaluating impact. Ask: "Who does this hurt most?"

| Archetype | Characteristics | Ask yourself |
|---|---|---|
| **Novice** | 50+, low tech literacy, cautious | Would they notice? Would they get stuck? |
| **Power user** | 25-35, expert, impatient | Would they be frustrated? Would it slow them? |
| **Accessibility** | Screen reader, keyboard-only, low vision | Can they use this at all? |
| **Mobile** | Phone, slow connection, distracted | Does this work on the go? |

Adjust finding **priority** up if an issue disproportionately affects vulnerable users
(novice, accessibility). An issue that only affects power users is typically lower priority
than one that blocks novice users entirely.

---

## Full Persona Review

### Step 1: Collect Page Data

Same as Bug Audit Step 1 — screenshot (to `/tmp`), meta, performance, via the
`browser-verify` skill. Read the screenshot to understand the page's purpose,
layout, content, and interaction model.

### Step 2: Generate Personas

Create 6 diverse personas. Each is a realistic person with a name, background,
and specific reason for visiting this page.

**Diversity requirements:**
- At least 2 genders
- At least 3 age groups (20s, 30s-40s, 50s+)
- At least 3 ethnic/cultural backgrounds
- Mix of tech literacy (tech-savvy, average, novice)
- At least 1 skeptic and 1 enthusiast

If a product quality profile exists, tailor personas to the product's actual
user base. Read `.agents/profile.md` (§ Project systems) and `.agents/quality.md`
if present — a B2B SaaS gets different personas than a consumer e-commerce site.

### Step 3: Evaluate Through Each Persona

For each persona, authentically adopt their perspective and evaluate the page.
A novice user genuinely struggles with complexity. A skeptic genuinely questions
claims. Don't just vary the scores — vary what they notice, what confuses them,
what they trust.

### Per-Persona Schema

```json
{
  "name": "Maria Santos",
  "age": 58,
  "gender": "Female",
  "background": "Retired teacher, occasional online shopper",
  "biography": "Maria taught school for 30 years...",
  "emoji": "👩‍🏫",
  "purpose_of_page": "What Maria thinks this page is for",
  "overall_score": 6,
  "feedback_summary": "Overall impression in 2 sentences",
  "visual_score": 7,
  "visual_feedback": "How the design looks to Maria",
  "usability_score": 5,
  "usability_feedback": "How easy it is for Maria to use",
  "content_score": 6,
  "content_feedback": "Whether the content makes sense to Maria",
  "nps_score": 6,
  "appealing_features": "What Maria likes",
  "lacking_aspects": "What Maria wishes were different"
}
```

### Step 4: Score and Report

Average each dimension across all 6 personas (round to 1 decimal).

Use the persona feedback report template from
[`report-templates.md`](report-templates.md).

**Save to `/tmp`** (ephemeral): e.g. `/tmp/audit-<site>-persona-feedback-<YYYY-MM-DD>.html`.
Never write into the consumer's project tree.

### Step 5: Synthesize Insights

After individual persona evaluations, identify:
- **Consensus issues** — problems most personas noticed (highest priority)
- **Segment-specific gaps** — issues only novice or only accessibility users hit
- **Strengths** — what consistently scored well across personas
- **Actionable improvements** — ranked by how many personas would benefit
