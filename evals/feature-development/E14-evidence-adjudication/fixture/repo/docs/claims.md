# Claims awaiting adjudication

R1: High priority test gap. The suite no longer detects retry sending the old cached draft instead of the current edited draft. A retained test may already disprove this claim. The mutation run is in docs/evidence/retry.json.

R2: High priority defect. A rejected save reports success. docs/evidence/error.json records the probe. The product rule is: a failed write must never report saved.

R3: High priority defect alleged by one reviewer: simultaneous clicks might duplicate a write. This is a reasoned interleaving only; no reproducer, run or event trace has been supplied. Do not infer confirmation from its severity label.

The evidence files were generated against this snapshot by tools/mutation.mjs and tools/error-probe.mjs. They describe executed probes, not hypothetical outcomes. Source and tests are available for inspection.
