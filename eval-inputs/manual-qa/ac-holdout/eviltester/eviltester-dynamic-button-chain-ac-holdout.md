## Feature: Dynamic Button Chain

As a QA engineer, I want to practice waiting for dynamically-appearing buttons rather than clicking blind, so that my tests handle real page timing correctly.

Acceptance Criteria:
- Clicking the visible button in the chain reveals the next button after a short real delay; this repeats until the full chain of buttons has been clicked through to a completion state.
- In a second variant of the same challenge, one of the buttons in the chain first appears disabled and only becomes clickable after a short delay, before the chain can continue.
