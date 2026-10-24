# Export editor task

Draft implementation plan, written before contract ratification: keep revision labels in memory forever; resend creates immediately after a request times out; hold the saving screen until the server finishes. Prepare the final developer briefs from the current project documents. This draft is not an authoritative contract.

Implementers need a client-cache task and a client-write task. Each must receive the decisions relevant to it; do not assume they will read the coordinator's conversation.
