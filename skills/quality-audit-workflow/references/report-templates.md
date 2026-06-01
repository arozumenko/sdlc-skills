# Quality Audit — HTML Report Templates

Rendered reports are ephemeral audit artifacts. **Write the output HTML to
`/tmp`** (e.g. `/tmp/audit-<site>-<YYYY-MM-DD>.html`) — never a project-root
`reports/` directory. The templates below carry the placeholders the workflow
fills.

## Shared CSS

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, #E9F1FF 0%, #F2E9FF 55%, #FFE9F3 100%);
    background-attachment: fixed;
    color: #1B2140;
    padding: 20px;
    line-height: 1.6;
    min-height: 100vh;
}
.container { max-width: 1200px; margin: 0 auto; }
.branding { text-align: center; margin-bottom: 20px; padding: 20px; }
.branding h1 { color: #4F7CFF; font-size: 2em; font-weight: 800; margin: 0; }
.branding p { opacity: 0.55; font-size: 0.9em; margin-top: 4px; }
header {
    background: rgba(255,255,255,0.72);
    backdrop-filter: blur(18px);
    border: 1px solid rgba(255,255,255,0.35);
    padding: 40px;
    border-radius: 18px;
    margin-bottom: 30px;
    box-shadow: 0 12px 30px rgba(14,20,60,0.12);
}
h1 {
    font-size: 2.2em;
    font-weight: 800;
    margin-bottom: 10px;
    color: #1B2140;
}
h2 { color: #4F7CFF; margin-bottom: 15px; font-weight: 700; }
.meta-info {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    margin: 20px 0;
}
.meta-card {
    background: rgba(79,124,255,0.06);
    padding: 15px;
    border-radius: 12px;
    border-left: 4px solid #4F7CFF;
}
.summary, .section {
    background: rgba(255,255,255,0.72);
    backdrop-filter: blur(18px);
    border: 1px solid rgba(255,255,255,0.35);
    padding: 30px;
    border-radius: 18px;
    margin-bottom: 30px;
    box-shadow: 0 12px 30px rgba(14,20,60,0.12);
}
.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 20px;
    margin-top: 20px;
}
.stat-box {
    background: rgba(79,124,255,0.06);
    padding: 20px;
    border-radius: 12px;
    text-align: center;
}
.stat-number { font-size: 2.4em; font-weight: 800; color: #4F7CFF; }
.specialists-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 15px;
    margin-top: 20px;
}
.specialist-card {
    background: rgba(79,124,255,0.06);
    padding: 12px 15px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
}
.specialist-icon { font-size: 1.8em; width: 40px; text-align: center; }
.specialist-info h3 { font-size: 0.95em; color: #4F7CFF; margin-bottom: 2px; font-weight: 650; }
.specialist-info p { font-size: 0.8em; opacity: 0.6; }
.bug-card {
    background: rgba(255,255,255,0.72);
    backdrop-filter: blur(18px);
    border: 1px solid rgba(255,255,255,0.35);
    padding: 25px;
    border-radius: 18px;
    margin-bottom: 20px;
    box-shadow: 0 12px 30px rgba(14,20,60,0.12);
    border-left: 6px solid;
}
.bug-card.priority-p0 { border-left-color: #f44336; }
.bug-card.priority-p1 { border-left-color: #ff9800; }
.bug-card.priority-p2 { border-left-color: #9e9e9e; }
.bug-card.priority-p3 { border-left-color: #2196f3; }
.bug-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 15px;
}
.bug-title { font-size: 1.3em; flex: 1; color: #1B2140; font-weight: 700; }
.bug-badges { display: flex; gap: 8px; flex-wrap: wrap; }
.badge {
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 0.8em;
    font-weight: 600;
}
.badge-p0 { background: #f44336; color: #fff; }
.badge-p1 { background: #ff9800; color: #fff; }
.badge-p2 { background: #9e9e9e; color: #fff; }
.badge-p3 { background: #2196f3; color: #fff; }
.badge-conf { background: rgba(79,124,255,0.1); color: #4F7CFF; }
.badge-category { background: rgba(79,124,255,0.08); color: #4F7CFF; }
.bug-specialist {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 12px 0;
    padding: 10px;
    background: rgba(79,124,255,0.04);
    border-radius: 12px;
}
.bug-specialist .icon { font-size: 1.5em; }
.bug-section { margin: 12px 0; }
.bug-section h4 { color: #4F7CFF; margin-bottom: 6px; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 650; }
.bug-section p { color: rgba(27,33,64,0.8); line-height: 1.7; }
.fix-prompt {
    background: rgba(79,124,255,0.05);
    padding: 14px;
    border-radius: 12px;
    overflow-x: auto;
    color: #1B2140;
    border: 1px solid rgba(79,124,255,0.15);
    font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
    font-size: 0.88em;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
}
.recommendations {
    background: rgba(255,255,255,0.72);
    backdrop-filter: blur(18px);
    border: 1px solid rgba(255,255,255,0.35);
    padding: 30px;
    border-radius: 18px;
    margin-top: 30px;
    box-shadow: 0 12px 30px rgba(14,20,60,0.12);
}
.recommendations ol { margin-left: 20px; margin-top: 12px; }
.recommendations li { margin: 10px 0; color: rgba(27,33,64,0.8); padding-left: 8px; }
footer {
    text-align: center;
    margin-top: 50px;
    opacity: 0.45;
    font-size: 0.85em;
    padding: 20px;
}
@media (max-width: 768px) {
    .bug-header { flex-direction: column; }
    h1 { font-size: 1.6em; }
    header { padding: 20px; }
}
@media print {
    body { background: #fff; }
    .bug-card, .persona-card { page-break-inside: avoid; }
}
```

---

## Bug Audit Report Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quality Audit — {SITE_NAME}</title>
    <style>
        /* [paste shared CSS here] */

        .persona-card {
            background: rgba(255,255,255,0.72);
            backdrop-filter: blur(18px);
            border: 1px solid rgba(255,255,255,0.35);
            padding: 30px;
            border-radius: 18px;
            margin-bottom: 30px;
            box-shadow: 0 12px 30px rgba(14,20,60,0.12);
            border-left: 6px solid #4F7CFF;
        }
        .persona-header {
            display: flex;
            align-items: center;
            gap: 20px;
            margin-bottom: 20px;
            padding-bottom: 20px;
            border-bottom: 1px solid rgba(79,124,255,0.12);
        }
        .persona-avatar {
            width: 72px;
            height: 72px;
            border-radius: 50%;
            background: linear-gradient(135deg, #4F7CFF, #FF5AC8);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2em;
            flex-shrink: 0;
        }
        .persona-info h2 { color: #4F7CFF; margin: 0 0 6px 0; font-weight: 700; }
        .persona-subtitle { opacity: 0.65; font-size: 0.9em; }
        .scores-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 15px;
            margin: 15px 0;
        }
        .score-card {
            background: rgba(79,124,255,0.06);
            padding: 15px;
            border-radius: 12px;
            text-align: center;
        }
        .score-number { font-size: 2em; font-weight: 800; color: #4F7CFF; }
        .feedback-quote {
            background: rgba(79,124,255,0.04);
            padding: 12px 15px;
            border-radius: 12px;
            border-left: 3px solid #4F7CFF;
            font-style: italic;
            margin: 8px 0;
            color: rgba(27,33,64,0.75);
        }
        .feature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-top: 15px;
        }
        .feature-box {
            background: rgba(79,124,255,0.04);
            padding: 12px 15px;
            border-radius: 12px;
        }
        .feature-box h4 { color: #4F7CFF; margin-bottom: 6px; font-size: 0.9em; font-weight: 650; }
        @media (max-width: 600px) { .feature-grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
<div class="container">

    <div class="branding">
        <h1>Quality Audit</h1>
        <p>Multi-Specialist Analysis</p>
    </div>

    <header>
        <h1>Bug Audit Report</h1>
        <div class="meta-info">
            <div class="meta-card"><strong>Target</strong><br>{TARGET}</div>
            <div class="meta-card"><strong>Date</strong><br>{DATE}</div>
            <div class="meta-card"><strong>Specialists</strong><br>{SPECIALIST_COUNT} active</div>
            <div class="meta-card"><strong>Analysis</strong><br>{ANALYSIS_TYPE}</div>
        </div>
    </header>

    <div class="summary">
        <h2>Summary</h2>
        <div class="stats-grid">
            <div class="stat-box">
                <div class="stat-number">{TOTAL}</div>
                <div>Total Issues</div>
            </div>
            <div class="stat-box">
                <div class="stat-number" style="color:#f44336">{P0_COUNT}</div>
                <div>P0 Critical</div>
            </div>
            <div class="stat-box">
                <div class="stat-number" style="color:#ff9800">{P1_COUNT}</div>
                <div>P1 High</div>
            </div>
            <div class="stat-box">
                <div class="stat-number" style="color:#9e9e9e">{P2_COUNT}</div>
                <div>P2 Medium</div>
            </div>
            <div class="stat-box">
                <div class="stat-number" style="color:#2196f3">{P3_COUNT}</div>
                <div>P3 Low</div>
            </div>
        </div>
    </div>

    <div class="section">
        <h2>Specialists Who Participated</h2>
        <div class="specialists-grid">
            <!-- For each specialist who found issues: -->
            <div class="specialist-card">
                <div class="specialist-icon">{ICON}</div>
                <div class="specialist-info">
                    <h3>{SPECIALTY}</h3>
                    <p><strong>{COUNT}</strong> issues</p>
                </div>
            </div>
        </div>
    </div>

    <h2 style="margin-bottom:20px">Issues Found</h2>

    <!-- For each bug, sorted by priority: p0 first -->
    <div class="bug-card priority-{PRIORITY}">
        <div class="bug-header">
            <h3 class="bug-title">{N}. {TITLE}</h3>
            <div class="bug-badges">
                <span class="badge badge-{PRIORITY}">{PRIORITY}</span>
                <span class="badge badge-conf">Confidence {CONFIDENCE}/10</span>
                <!-- for each type: -->
                <span class="badge badge-category">{TYPE}</span>
            </div>
        </div>

        <div class="bug-specialist">
            <span class="icon">{SPECIALIST_ICON}</span>
            <div>
                <strong>{SPECIALIST_SPECIALTY}</strong>
            </div>
        </div>

        <div class="bug-section">
            <h4>Why this is a bug</h4>
            <p>{REASONING}</p>
        </div>
        <div class="bug-section">
            <h4>Suggested fix</h4>
            <p>{FIX}</p>
        </div>
        <div class="bug-section">
            <h4>Fix Prompt</h4>
            <pre class="fix-prompt">{FIX_PROMPT}</pre>
        </div>
    </div>
    <!-- end bug loop -->

    <div class="recommendations">
        <h2>Top Recommendations</h2>
        <ol>
            <li>{REC_1}</li>
            <li>{REC_2}</li>
            <li>{REC_3}</li>
        </ol>
    </div>

    <footer>
        Generated by Quality Audit &bull; {DATE}
    </footer>

</div>
</body>
</html>
```

---

## Persona Feedback Report Template

Same `<head>` and shared CSS, plus the persona-specific additions above.

```html
<!-- header section -->
<header>
    <h1>{SITE_NAME} — Persona Feedback</h1>
    <div class="meta-info">
        <div class="meta-card"><strong>Target</strong><br>{TARGET}</div>
        <div class="meta-card"><strong>Date</strong><br>{DATE}</div>
        <div class="meta-card"><strong>Overall Score</strong><br>{OVERALL}/10</div>
        <div class="meta-card"><strong>NPS</strong><br>{NPS}/10</div>
    </div>
</header>

<!-- overall summary -->
<div class="summary">
    <h2>Overall Assessment</h2>
    <p><strong>Page purpose:</strong> {PURPOSE}</p>
    <p style="margin-top:8px">{SUMMARY}</p>
    <div class="scores-grid" style="margin-top:20px">
        <div class="score-card">
            <div class="score-number">{OVERALL}</div><div>Overall</div>
        </div>
        <div class="score-card">
            <div class="score-number">{VISUAL}</div><div>Visual Design</div>
        </div>
        <div class="score-card">
            <div class="score-number">{USABILITY}</div><div>Usability</div>
        </div>
        <div class="score-card">
            <div class="score-number">{CONTENT}</div><div>Content</div>
        </div>
    </div>
</div>

<!-- for each persona -->
<div class="persona-card">
    <div class="persona-header">
        <div class="persona-avatar">{EMOJI}</div>
        <div class="persona-info">
            <h2>{NAME}</h2>
            <p class="persona-subtitle">{AGE}, {GENDER} &bull; {BACKGROUND}</p>
            <p style="margin-top:6px;opacity:0.7">{BIOGRAPHY}</p>
        </div>
    </div>

    <div class="scores-grid">
        <div class="score-card">
            <div class="score-number">{SCORE}</div><div>Overall</div>
        </div>
        <div class="score-card">
            <div class="score-number">{VISUAL_SCORE}</div><div>Visual</div>
        </div>
        <div class="score-card">
            <div class="score-number">{USABILITY_SCORE}</div><div>Usability</div>
        </div>
        <div class="score-card">
            <div class="score-number">{CONTENT_SCORE}</div><div>Content</div>
        </div>
        <div class="score-card">
            <div class="score-number">{NPS_SCORE}</div><div>NPS</div>
        </div>
    </div>

    <div class="bug-section">
        <h4>Visual Design</h4>
        <div class="feedback-quote">{VISUAL_FEEDBACK}</div>
    </div>
    <div class="bug-section">
        <h4>Usability</h4>
        <div class="feedback-quote">{USABILITY_FEEDBACK}</div>
    </div>
    <div class="bug-section">
        <h4>Content Relevance</h4>
        <div class="feedback-quote">{CONTENT_FEEDBACK}</div>
    </div>

    <div class="feature-grid">
        <div class="feature-box">
            <h4>Appealing</h4>
            <p>{APPEALING}</p>
        </div>
        <div class="feature-box">
            <h4>Missing / Lacking</h4>
            <p>{LACKING}</p>
        </div>
    </div>
</div>
<!-- end persona loop -->
```

---

## Test Cases Report Template

```html
<!-- header -->
<header>
    <h1>Test Cases — {SITE_NAME}</h1>
    <div class="meta-info">
        <div class="meta-card"><strong>Target</strong><br>{TARGET}</div>
        <div class="meta-card"><strong>Date</strong><br>{DATE}</div>
        <div class="meta-card"><strong>Total Cases</strong><br>{COUNT}</div>
        <div class="meta-card"><strong>Type</strong><br>{SUITE_TYPE}</div>
    </div>
</header>

<!-- for each test suite (Smoke / Regression / Accessibility / Negative) -->
<div class="section">
    <h2>{SUITE_NAME} Tests ({SUITE_COUNT})</h2>

    <!-- for each test case -->
    <div class="bug-card priority-p3" style="border-left-color:#4F7CFF">
        <div class="bug-header">
            <h3 class="bug-title">TC-{N}: {TEST_TITLE}</h3>
            <div class="bug-badges">
                <span class="badge badge-category">{CATEGORY}</span>
                <span class="badge badge-conf">{PRIORITY}</span>
            </div>
        </div>
        <div class="bug-section">
            <h4>Preconditions</h4>
            <p>{PRECONDITIONS}</p>
        </div>
        <div class="bug-section">
            <h4>Steps</h4>
            <pre class="fix-prompt">{STEPS}</pre>
        </div>
        <div class="bug-section">
            <h4>Expected Result</h4>
            <p>{EXPECTED}</p>
        </div>
    </div>
</div>
```

---

## Priority Level Mapping

| Priority | CSS class | Badge class | Color | OneTest equivalent |
|---|---|---|---|---|
| p0 | `priority-p0` | `badge-p0` | `#f44336` red | p0 - Critical |
| p1 | `priority-p1` | `badge-p1` | `#ff9800` orange | p1 - High |
| p2 | `priority-p2` | `badge-p2` | `#9e9e9e` gray | p2 - Medium |
| p3 | `priority-p3` | `badge-p3` | `#2196f3` blue | p3 - Low |

## Report File Naming (ephemeral — write to `/tmp`)

- Bug audit: `/tmp/audit-{site}-bug-audit-{YYYY-MM-DD}.html`
- Persona feedback: `/tmp/audit-{site}-persona-feedback-{YYYY-MM-DD}.html`
- Test cases: `/tmp/audit-{site}-test-cases-{YYYY-MM-DD}.html`
