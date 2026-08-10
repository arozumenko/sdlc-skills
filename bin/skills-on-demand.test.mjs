// skills-on-demand.test.mjs — the preload/on-demand frontmatter split.
//
// `skills:` installs AND preloads (on Claude); `skills-on-demand:` installs
// but never preloads. The installer resolves the UNION, the non-Claude body
// inventory advertises the union, and overlays remove from both lines but
// add to the on-demand line when one exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAgentSkillSplit,
  parseSkillsFromFrontmatter,
  injectSkillsSection,
  applySkillOverlayToText,
} from "./init.mjs";

const AGENT = `---
name: sample
description: sample agent
model: sonnet
skills: [core-skill, memory]
skills-on-demand: [rare-skill, "quoted-skill"]
---

## Session Start

Do the thing.

## Role

Work.
`;

test("parseAgentSkillSplit separates preload from on-demand", () => {
  const { preload, onDemand } = parseAgentSkillSplit(AGENT);
  assert.deepEqual(preload, ["core-skill", "memory"]);
  assert.deepEqual(onDemand, ["rare-skill", "quoted-skill"]);
});

test("parseSkillsFromFrontmatter returns the union (install set)", () => {
  assert.deepEqual(parseSkillsFromFrontmatter(AGENT), [
    "core-skill",
    "memory",
    "rare-skill",
    "quoted-skill",
  ]);
});

test("agents without the on-demand key behave as before", () => {
  const legacy = AGENT.replace(/^skills-on-demand:.*\n/m, "");
  const { preload, onDemand } = parseAgentSkillSplit(legacy);
  assert.deepEqual(preload, ["core-skill", "memory"]);
  assert.deepEqual(onDemand, []);
  assert.deepEqual(parseSkillsFromFrontmatter(legacy), ["core-skill", "memory"]);
});

test("block-form skills: still parses (legacy authoring)", () => {
  const block = `---
name: sample
skills:
  - a-skill
  - b-skill
skills-on-demand: [c-skill]
---
Body.
`;
  const { preload, onDemand } = parseAgentSkillSplit(block);
  assert.deepEqual(preload, ["a-skill", "b-skill"]);
  assert.deepEqual(onDemand, ["c-skill"]);
});

test("injected inventory (non-Claude hosts) lists skills: only — on-demand stays out of every body", () => {
  const registry = {
    skills: [
      { id: "core-skill", description: "the core" },
      { id: "rare-skill", description: "the rare one" },
    ],
  };
  const out = injectSkillsSection(AGENT, "sample", registry);
  assert.match(out, /## Skills/);
  assert.match(out, /`core-skill`/);
  assert.doesNotMatch(out, /`rare-skill`/);
  // idempotent on re-run
  const again = injectSkillsSection(out, "sample", registry);
  assert.equal((again.match(/## Skills/g) || []).length, 1);
});

test("overlay: remove drops from both lines, add lands on-demand", () => {
  const out = applySkillOverlayToText(AGENT, {
    remove: ["memory", "rare-skill"],
    add: ["stack-skill"],
  });
  assert.match(out, /^skills: \[core-skill\]$/m);
  assert.match(out, /^skills-on-demand: \[quoted-skill, stack-skill\]$/m);
});

test("overlay on a legacy single-line agent adds to skills:", () => {
  const legacy = AGENT.replace(/^skills-on-demand:.*\n/m, "");
  const out = applySkillOverlayToText(legacy, { add: ["stack-skill"], remove: [] });
  assert.match(out, /^skills: \[core-skill, memory, stack-skill\]$/m);
});

test("overlay add already present anywhere is not duplicated", () => {
  const out = applySkillOverlayToText(AGENT, { add: ["rare-skill", "core-skill"] });
  assert.match(out, /^skills: \[core-skill, memory\]$/m);
  assert.match(out, /^skills-on-demand: \[rare-skill, quoted-skill\]$/m);
});

test("no inline skills line -> null (nothing to rewrite)", () => {
  assert.equal(applySkillOverlayToText("---\nname: x\n---\nBody.", { add: ["a"] }), null);
});
