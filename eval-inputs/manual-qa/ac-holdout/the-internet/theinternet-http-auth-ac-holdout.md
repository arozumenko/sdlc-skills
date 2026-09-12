# Acceptance criteria — theinternet-http-auth-ac-holdout

## Feature: HTTP Authentication Challenges

As a user, I want to access pages protected by standard HTTP authentication
(both Basic and Digest schemes), so that only someone with the right
credentials can reach the protected content.

Acceptance Criteria:
- On the Basic Auth page, providing the correct username and password loads
  the protected page successfully, with content confirming the credentials
  were accepted. No error page appears.
- On the Digest Auth page, providing the correct username and password loads
  the protected page successfully, with content confirming the credentials
  were accepted. No error page appears.
