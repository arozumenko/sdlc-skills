## Feature: XHTTP Message Processing

As a user, I want the page's background message-processing sequence to run automatically and finish cleanly, so that I don't need to manually manage it.

Acceptance Criteria:
- As soon as the page loads, a message counter and a message list begin updating on their own, with no action required from me.
- The sequence eventually finishes, with the counter reaching zero outstanding requests and messages, and the message list populated with no error state shown.
