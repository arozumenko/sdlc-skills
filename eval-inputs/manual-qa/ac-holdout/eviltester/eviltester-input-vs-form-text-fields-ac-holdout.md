## Feature: Text Input Field Behavior — Standalone vs. Inside a Form

As a QA engineer, I want to distinguish between a plain text input that just logs events and an identical-looking one that's wrapped in a real submittable form, so that I don't confuse the two when they share the same page name.

Acceptance Criteria:
- On the standalone Input Elements version of the text-inputs page, typing into the field is reflected live in an event log, and there is no form to submit — no navigation ever occurs from this page.
- On the Forms version of the text-inputs page (same field type, different section), the field is wrapped in a real form: filling it in and clicking the submit control causes the form to submit and shows a result reflecting the submitted value.
