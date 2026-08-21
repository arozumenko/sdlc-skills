# Notice

The discovery skills and pipeline in this factory are adapted from
[PetroczyP/PO-RnD](https://github.com/PetroczyP/PO-RnD), licensed under the
MIT License.

This is a **native adaptation**, not a port. The upstream project's Obsidian
vault, Python validators (`validate_vault.py`), and git hooks (`.githooks/`,
PreToolUse guards) were intentionally not carried over — those enforce
structure through vault- and hook-specific machinery that doesn't fit this
repo's overlay model. Likewise, upstream's `product-constitution.md` and
`domain-vocabulary.md` were not ported.

The underlying discovery loop — problems, personas, journeys, hypotheses,
outcomes, decisions, and evidence — has been re-expressed as plain markdown
records and agent/skill personas native to `sdlc-skills`, installed via
`bin/init.mjs` and tuned per team through the standard `factory.json`
overlay mechanism.

## Additional acknowledgements

Much of the product-management thinking behind this factory draws on
[mattpocock/skills](https://github.com/mattpocock/skills) ("Skills for Real
Engineers", MIT) — its skill-design patterns and insights informed how these
discovery skills are framed and composed.

Individual skills also carry provenance footers crediting further upstream
craft (e.g. `phuryn/pm-skills` and `shinpr/claude-code-discover`, both MIT)
where specific methods were adapted.
