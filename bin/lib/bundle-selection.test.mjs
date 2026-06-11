import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activePlatforms,
  resolveSelection,
  mergeCoreOverlay,
  buildOverlays,
  buildBriefingPlan,
  composeBriefing,
  briefingDescription,
} from "./bundle-selection.mjs";

const BUNDLE = {
  coreAgents: ["scout", "tech-lead", "qa-engineer"],
  devRoles: {
    "python-dev": { label: "Python backend", platform: "web", skillOverlay: { add: ["fastapi"] } },
    "js-dev": { label: "JS/TS frontend", platform: "web", skillOverlay: { add: ["vercel-react-best-practices"] } },
    "ios-dev": { label: "iOS", platform: "ios" },
  },
  platforms: {
    web: {
      label: "Web",
      briefings: { scout: "briefings/web/scout.md", "qa-engineer": "briefings/web/qa-engineer.md" },
      skillOverlays: { "tech-lead": { add: ["fastapi", "vercel-react-best-practices"] } },
    },
    ios: {
      label: "iOS",
      briefings: { scout: "briefings/ios/scout.md", "qa-engineer": "briefings/ios/qa-engineer.md" },
      skillOverlays: {
        "tech-lead": { add: ["swiftui-pro"] },
        "qa-engineer": { add: ["xcuitest-real-device-config"], remove: ["playwright-testing", "browser-verify"] },
      },
    },
  },
};

test("activePlatforms is unique and order-preserving", () => {
  assert.deepEqual(activePlatforms(BUNDLE.devRoles, ["js-dev", "python-dev"]), ["web"]);
  assert.deepEqual(activePlatforms(BUNDLE.devRoles, ["js-dev", "ios-dev"]), ["web", "ios"]);
  assert.deepEqual(activePlatforms(BUNDLE.devRoles, []), []);
});

test("resolveSelection: explicit splits known/unknown", () => {
  const r = resolveSelection({ explicit: ["ios-dev", "nope"], devRoleNames: Object.keys(BUNDLE.devRoles), yes: false, isTTY: true });
  assert.deepEqual(r, { mode: "explicit", roles: ["ios-dev"], unknown: ["nope"] });
});

test("resolveSelection: --yes or no TTY => all", () => {
  const names = Object.keys(BUNDLE.devRoles);
  assert.equal(resolveSelection({ explicit: null, devRoleNames: names, yes: true, isTTY: true }).mode, "all");
  assert.equal(resolveSelection({ explicit: null, devRoleNames: names, yes: false, isTTY: false }).mode, "all");
});

test("resolveSelection: TTY, no flags => picker", () => {
  const r = resolveSelection({ explicit: null, devRoleNames: Object.keys(BUNDLE.devRoles), yes: false, isTTY: true });
  assert.equal(r.mode, "picker");
  assert.equal(r.roles, null);
});

test("mergeCoreOverlay: single platform applies remove verbatim", () => {
  assert.deepEqual(mergeCoreOverlay(BUNDLE.platforms, ["ios"], "qa-engineer"), {
    add: ["xcuitest-real-device-config"],
    remove: ["playwright-testing", "browser-verify"],
  });
});

test("mergeCoreOverlay: web has no qa overlay => empty", () => {
  assert.deepEqual(mergeCoreOverlay(BUNDLE.platforms, ["web"], "qa-engineer"), { add: [], remove: [] });
});

test("mergeCoreOverlay: web+ios unions adds, suppresses removes (web contributes none)", () => {
  assert.deepEqual(mergeCoreOverlay(BUNDLE.platforms, ["web", "ios"], "qa-engineer"), {
    add: ["xcuitest-real-device-config"],
    remove: [],
  });
});

test("mergeCoreOverlay: tech-lead unions adds across platforms (deduped)", () => {
  assert.deepEqual(mergeCoreOverlay(BUNDLE.platforms, ["web", "ios"], "tech-lead"), {
    add: ["fastapi", "vercel-react-best-practices", "swiftui-pro"],
    remove: [],
  });
});

test("buildOverlays: dev-role own overlays + core platform overlays", () => {
  const ov = buildOverlays(BUNDLE, ["js-dev", "ios-dev"]);
  assert.deepEqual(ov["js-dev"], { add: ["vercel-react-best-practices"] });
  // Core-role tuning is platform-level union: tech-lead gets the full web
  // overlay (incl. fastapi) because the web platform is active, regardless of
  // which web dev role was picked — plus the active iOS platform's add.
  assert.deepEqual(ov["tech-lead"], { add: ["fastapi", "vercel-react-best-practices", "swiftui-pro"], remove: [] });
  assert.deepEqual(ov["qa-engineer"], { add: ["xcuitest-real-device-config"], remove: [] });
  assert.ok(!("scout" in ov)); // scout has no skillOverlay anywhere
});

test("buildBriefingPlan: one platform => single entry; two => concatenated entries", () => {
  const one = buildBriefingPlan(BUNDLE, ["python-dev"]);
  assert.deepEqual(one["scout"], [{ label: "Web", path: "briefings/web/scout.md" }]);
  const two = buildBriefingPlan(BUNDLE, ["js-dev", "ios-dev"]);
  assert.deepEqual(two["scout"], [
    { label: "Web", path: "briefings/web/scout.md" },
    { label: "iOS", path: "briefings/ios/scout.md" },
  ]);
});

test("composeBriefing: single => as-is; many => headered", () => {
  assert.equal(composeBriefing([{ label: "Web", content: "body" }]), "body");
  assert.equal(
    composeBriefing([{ label: "Web", content: "a" }, { label: "iOS", content: "b" }]),
    "## Web stack\n\na\n\n## iOS stack\n\nb"
  );
});

test("briefingDescription: first frontmatter description wins", () => {
  assert.equal(
    briefingDescription([{ label: "Web", content: "---\ndescription: web focus\n---\nbody" }]),
    "web focus"
  );
  assert.equal(briefingDescription([{ label: "Web", content: "no fm" }]), "Project overview and this role's focus");
});
