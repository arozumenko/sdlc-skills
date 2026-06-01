# Filing Audit Findings as Issues

How to turn a `quality-architect` (Quinn) dimensional-audit finding into a
tracker issue. The finding schema is owned by `quality-audit-workflow` (the
`p0–p3` finding shape); this reference maps that shape onto a tracker issue
**tracker-agnostically** — read `.agents/profile.md` § Project systems §
Issue tracker (per the SKILL's Step 0) to pick the destination, then apply
the mappings below.

This is the audit-findings counterpart to the generic
[`templates.md`](templates.md) bodies. A finding is a defect-with-fix, so it
files like a Bug Report — but it carries extra audit metadata (dimension,
confidence, suggested fix, fix prompt, evidence path) that the body template
below preserves.

## Priority p0–p3 → label / field (tracker-aware)

Quinn's findings carry a priority `p0`–`p3`. `p0` blocks ship; `p3` is
tracked polish. Map it to whatever the tracker uses for priority — a label on
GitHub/GitLab/Linear, a native priority field on Jira/Azure DevOps. Read the
tracker from `.agents/profile.md` first; the right priority in the wrong field
is still wrong.

| Quinn | github-issues | gitlab-issues | jira (Priority field) | azure-devops (Priority) | linear (Priority) |
|---|---|---|---|---|---|
| `p0` | `priority:p0` + `bug` | `priority::p0` + `bug` | `Highest` (Blocker) | `1` | `Urgent` |
| `p1` | `priority:p1` + `bug` | `priority::p1` + `bug` | `High` | `2` | `High` |
| `p2` | `priority:p2` + `bug` | `priority::p2` + `bug` | `Medium` | `3` | `Medium` |
| `p3` | `priority:p3` + `improvement` | `priority::p3` + `improvement` | `Low` | `4` | `Low` |

On GitHub, ensure the priority labels exist before the first batch (idempotent
— ignore "already exists"):

```bash
gh label create "priority:p0" --color "f44336" --description "Blocks ship" 2>/dev/null
gh label create "priority:p1" --color "ff9800" --description "High — degrades experience" 2>/dev/null
gh label create "priority:p2" --color "9e9e9e" --description "Medium — workaround exists" 2>/dev/null
gh label create "priority:p3" --color "2196f3" --description "Low — minor polish" 2>/dev/null
gh label create "quality-audit" --color "4F7CFF" --description "Found by a dimensional quality audit" 2>/dev/null
```

GitLab uses the same shape (`glab label create --name "priority::p0" --color
"#f44336"`). Jira / Azure DevOps set the native Priority field per the table
rather than a label; Linear sets the built-in Priority. For
`gitlab`/`jira`/`ado`/`linear`, drive the create through the wired CLI/MCP
exactly as in the SKILL's *Create issue* section.

### Cross-walk to qa-engineer's Critical/Major/Minor/Info

So the two severity schemes agree, Quinn's `p0–p3` maps onto qa-engineer's
`[SEVERITY]` vocabulary (the `[SEVERITY]` slug used in the
[Bug Report template](templates.md#bug-report)):

| Quinn priority | qa-engineer severity | Meaning |
|---|---|---|
| `p0` | `Critical` | Data loss, security breach, complete feature failure — blocks ship |
| `p1` | `Major` | Feature partially broken / degrades experience for many; painful workaround |
| `p2` | `Minor` | Noticeable, edge case, workaround exists — non-blocking |
| `p3` | `Info` | Observation / minor polish / improvement suggestion |

When a finding is filed into a tracker a qa-engineer also uses, render the
Bug Report `[SEVERITY]` slug from the right-hand column so both audiences read
the same severity.

## Dimension → category label

Quinn sweeps dimension by dimension; each finding names its dimension (the
`specialist`/`specialist_specialty` it came from). Tag the issue with a
category label so findings stay groupable by dimension. Dimension names match
`quality-audit-workflow`'s specialist routing.

| Dimension | Specialist skill | Icon | Category label |
|---|---|---|---|
| accessibility | `accessibility-audit` | ♿ | `accessibility` |
| security | `security-audit` | 🔒 | `security` |
| privacy | `privacy-audit` | 🍪 | `privacy` |
| performance | `performance-audit` | 📡 | `performance` |
| responsive | `responsive-audit` | 📱 | `responsive` |
| content-seo | `content-seo-audit` | ✍️ | `content-seo` |
| ux | `ux-audit` | 🎨 | `ux` |

On GitHub/GitLab/Linear the category is a label; on Jira/Azure DevOps use a
component (or a label, per project convention). The final GitHub label set on
an issue is `{priority_label},{category_label},quality-audit` plus `bug` (p0–p2)
or `improvement` (p3).

## Issue body template

Tracker-agnostic markdown. Convert to ADF for Jira / Azure DevOps via the
agent's wired ADF-authoring capability (same rule as the SKILL's *Create
issue* section). Placeholders come straight from the finding schema in
`quality-audit-workflow` (`title`, `priority`, `confidence`, `reasoning`,
`suggested_fix`, `fix_prompt`, `specialist_icon`, `specialist_specialty`).

````markdown
## {specialist_icon} {specialist_specialty}

**Priority:** {priority}  (qa-engineer severity: {Critical|Major|Minor|Info})
**Confidence:** {confidence}/10
**Dimension:** {dimension}

### Description
{reasoning}

### Suggested Fix
{suggested_fix}

### Fix Prompt
```
{fix_prompt}
```

### Evidence
- Audit report: `{report_path}`   (e.g. `/tmp/audit-<site>-<YYYY-MM-DD>.html`)
- Screenshot / trace: `{evidence_path}`
- Date: {date}

---
*Filed from a dimensional quality audit*
````

GitHub create call (substitute per tracker — see the SKILL's *Create issue*):

```bash
gh issue create \
  --title "{title}" \
  --label "{priority_label},{category_label},quality-audit" \
  --body "$(cat <<'BODY'
<body rendered from the template above>
BODY
)"
```

The `fix_prompt` is a ready-to-paste prompt; keep it in its own fenced block
so a developer (or an agent) can lift it verbatim. The `confidence` is the
audit's own 1–10 score — carry it through so triagers can weight it (8–10 =
direct proof, 5–7 = strong indirect, 1–4 = educated guess). Never raise a
finding's confidence just to make the issue look stronger.

## Batch behavior

- **One issue per finding.** Do not roll several findings into one ticket —
  each defect-with-fix is independently triageable and closable.
- **Default to filing `p0` and `p1`.** These block or degrade ship; they earn
  a tracker issue automatically.
- **List `p2`/`p3` in the audit report, don't auto-file them.** Surface them in
  the report's findings list and offer: "Want me to file the p2/p3 findings
  too?" — file them only if the operator asks.
- **Dedup before filing.** The workflow already merges duplicate findings
  (higher priority/confidence wins) before this step; don't re-file a finding
  that matches an existing open issue — comment on the existing one instead
  (see the SKILL's *Update issues*).
- **Report after the batch:** "Filed {N} issues — {P0_COUNT} p0, {P1_COUNT} p1.
  {P2_COUNT} p2 / {P3_COUNT} p3 listed in the report, not filed."
- **Audit-trail comment** the filing on each issue per the SKILL's *Work log*
  (`🐛 **Bug**: …`) when filing into a tracker that the team actively works.
