# GDPR Compliance — Browser-Visible Checklist

This checklist covers only what is observable from the browser. Legal-completeness
(DPAs, lawful-basis records, processor contracts) is out of scope — you audit what
the page reveals, not what lives in the company's back office. Anything you cannot
prove from cookies, storage, network, or rendered DOM stays at low confidence.

## Consent (p0)

| Check | Pass criteria |
|---|---|
| Consent banner present | Banner appears on first visit |
| Granular consent | User can choose categories (analytics, marketing, etc.) |
| No pre-ticked boxes | All optional categories unchecked by default |
| Reject is as easy as accept | "Reject all" button same prominence as "Accept all" |
| No tracking before consent | No analytics/tracking scripts fire before user consents |
| Consent withdrawal | "Manage preferences" or "Cookie settings" link accessible |

## Privacy Notice (p1)

| Check | Pass criteria |
|---|---|
| Privacy policy link | Accessible from every page (usually footer) |
| Plain language | Readable by non-lawyer (no dense legalese) |
| Data categories listed | What data is collected, clearly stated |
| Purpose stated | Why each data type is collected |
| Third parties disclosed | Who data is shared with |
| Retention period | How long data is kept |
| Data subject rights | Right to access, delete, port, restrict, object |
| Contact information | DPO or privacy contact provided |

## Technical Compliance (p1)

| Check | Pass criteria |
|---|---|
| Secure transmission | All forms submit over HTTPS |
| Cookie flags | Session cookies have `Secure` and `HttpOnly` |
| No PII in URLs | No email, name, or identifiers in query strings |
| No PII in localStorage | Tokens OK, but not names/emails/addresses |
| Third-party isolation | Third-party cookies properly scoped |
