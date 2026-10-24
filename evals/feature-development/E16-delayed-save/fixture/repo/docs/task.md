# Editor save ordering

The prepare adapter may return a value immediately or a Promise that settles later. saveAs and retryAs must each return a Promise, wait for preparation before calling write, write the prepared value exactly once, and settle only after write settles. If preparation rejects, reject the operation without writing. If writing rejects, propagate that rejection. Calls are sequential; overlapping calls are outside this task's contract.

Reported symptom: with a genuinely delayed prepare adapter, saveAs writes the old draft. The existing test uses an immediate adapter and is green. Repair the class of failure and add regression tests for both public entry paths. Tests must fail promptly and diagnostically, not wait indefinitely when the implementation is broken.
