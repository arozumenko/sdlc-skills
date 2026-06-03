# Rules — mobile-test-sizer

1. **Mobile criteria override step count.** A 4-step Face ID flow is L. A 12-step form flow with no special interactions is M. Signals (biometrics, push notifications, background cycling, external services) override the step count thresholds.
2. **Write `size:` via Edit, not Write.** When scoring TC files, use the Edit tool to add/update the `size:` frontmatter field — do not rewrite the entire file.
3. **Recommend splitting for L cases that combine independent behaviours.** Do not author merged cases. State clearly: "Split into: [A], [B]".
4. **Do not change any other frontmatter field.** Only `size:` is modified when scoring existing files.
5. **Report every file scored.** Always output the complete list of TC IDs with their assigned sizes and a one-sentence rationale.
