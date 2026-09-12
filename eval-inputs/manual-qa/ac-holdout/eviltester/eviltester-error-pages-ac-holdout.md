## Feature: Error Demonstration Pages

As a QA engineer, I want a set of reference pages that intentionally demonstrate common web errors, so that I can verify our tooling correctly recognizes deliberate, by-design breakage instead of misreporting it as a real defect.

Acceptance Criteria:
- Known issue (by design, not a defect): the HTML Errors page intentionally contains malformed markup, and the page still renders some content despite it.
- Known issue (by design, not a defect): the Broken Images page intentionally has at least one image that fails to load.
- Known issue (by design, not a defect): the JavaScript Errors page intentionally triggers a console error for a missing script resource.
- Known issue (by design, not a defect): the Broken Links page intentionally contains at least one link that leads to a dead destination.
