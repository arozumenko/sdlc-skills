# Acceptance criteria — theinternet-entry-ad-ac-holdout

## Feature: Entry Ad Modal

As a first-time visitor, I want an entry promo modal to show once and stay
dismissed once I close it, so that it doesn't keep interrupting me on later
visits.

Acceptance Criteria:
- On a fresh visit, an entry ad modal appears shortly after the page loads.
- Closing the modal dismisses it, and the modal does not reappear on a
  subsequent reload during the same visit.
- Known issue, already tracked, not something to re-test as new: the page
  also has a "click here" link intended to reset the dismissal and bring
  the modal back. This reset is currently unreliable — it sometimes works
  and sometimes doesn't, due to a race condition on the backend. Until
  that's fixed, don't treat an inconsistent reset result as a new defect.
