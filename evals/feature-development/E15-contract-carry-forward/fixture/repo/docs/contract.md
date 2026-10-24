# Ratified service contract

C1: Revision identifiers are stable, but their labels can be redacted. An explicit Reload must fetch current labels; a process-lifetime cache is not authoritative.
C2: A create may finish after the caller times out. Creates have no idempotency key. After an ambiguous timeout, reconcile the operation before allowing another create; an empty immediate listing does not prove the first operation failed.
C3: The server can take 45 seconds. Transport timeout is not evidence of rollback.
