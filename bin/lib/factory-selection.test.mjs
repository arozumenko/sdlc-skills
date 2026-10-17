import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activePlatforms,
  resolveSelection,
  implicitSelectionWarning,
  mergeCoreOverlay,
  buildOverlays,
  buildBriefingPlan,
  composeBriefing,
  briefingDescription,
} from "./factory-selection.mjs";
import { parseArgs } from "../init.mjs";

test("--bundle is a silent alias for --factory", () => {
  const viaFactory = parseArgs(["init", "--factory", "manual-qa"]);
  const viaBundle = parseArgs(["init", "--bundle", "manual-qa"]);
  assert.equal(viaBundle.factory, "manual-qa");
  assert.equal(viaBundle.factory, viaFactory.factory);
});

const FACTORY = {
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
  assert.deepEqual(activePlatforms(FACTORY.devRoles, ["js-dev", "python-dev"]), ["web"]);
  assert.deepEqual(activePlatforms(FACTORY.devRoles, ["js-dev", "ios-dev"]), ["web", "ios"]);
  assert.deepEqual(activePlatforms(FACTORY.devRoles, []), []);
});

test("resolveSelection: explicit splits known/unknown", () => {
  const r = resolveSelection({ explicit: ["ios-dev", "nope"], devRoleNames: Object.keys(FACTORY.devRoles), yes: false, isTTY: true });
  assert.deepEqual(r, { mode: "explicit", roles: ["ios-dev"], unknown: ["nope"], implicit: false });
});

test("resolveSelection: --yes or no TTY => all", () => {
  const names = Object.keys(FACTORY.devRoles);
  assert.equal(resolveSelection({ explicit: null, devRoleNames: names, yes: true, isTTY: true }).mode, "all");
  assert.equal(resolveSelection({ explicit: null, devRoleNames: names, yes: false, isTTY: false }).mode, "all");
});

test("resolveSelection: TTY, no flags => picker", () => {
  const r = resolveSelection({ explicit: null, devRoleNames: Object.keys(FACTORY.devRoles), yes: false, isTTY: true });
  assert.equal(r.mode, "picker");
  assert.equal(r.roles, null);
});

test("mergeCoreOverlay: single platform applies remove verbatim", () => {
  assert.deepEqual(mergeCoreOverlay(FACTORY.platforms, ["ios"], "qa-engineer"), {
    add: ["xcuitest-real-device-config"],
    remove: ["playwright-testing", "browser-verify"],
  });
});

test("mergeCoreOverlay: web has no qa overlay => empty", () => {
  assert.deepEqual(mergeCoreOverlay(FACTORY.platforms, ["web"], "qa-engineer"), { add: [], remove: [] });
});

test("mergeCoreOverlay: web+ios unions adds, suppresses removes (web contributes none)", () => {
  assert.deepEqual(mergeCoreOverlay(FACTORY.platforms, ["web", "ios"], "qa-engineer"), {
    add: ["xcuitest-real-device-config"],
    remove: [],
  });
});

test("mergeCoreOverlay: tech-lead unions adds across platforms (deduped)", () => {
  assert.deepEqual(mergeCoreOverlay(FACTORY.platforms, ["web", "ios"], "tech-lead"), {
    add: ["fastapi", "vercel-react-best-practices", "swiftui-pro"],
    remove: [],
  });
});

test("buildOverlays: dev-role own overlays + core platform overlays", () => {
  const ov = buildOverlays(FACTORY, ["js-dev", "ios-dev"]);
  assert.deepEqual(ov["js-dev"], { add: ["vercel-react-best-practices"] });
  // Core-role tuning is platform-level union: tech-lead gets the full web
  // overlay (incl. fastapi) because the web platform is active, regardless of
  // which web dev role was picked — plus the active iOS platform's add.
  assert.deepEqual(ov["tech-lead"], { add: ["fastapi", "vercel-react-best-practices", "swiftui-pro"], remove: [] });
  assert.deepEqual(ov["qa-engineer"], { add: ["xcuitest-real-device-config"], remove: [] });
  assert.ok(!("scout" in ov)); // scout has no skillOverlay anywhere
});

test("buildBriefingPlan: one platform => single entry; two => concatenated entries", () => {
  const one = buildBriefingPlan(FACTORY, ["python-dev"]);
  assert.deepEqual(one["scout"], [{ label: "Web", path: "briefings/web/scout.md" }]);
  const two = buildBriefingPlan(FACTORY, ["js-dev", "ios-dev"]);
  assert.deepEqual(two["scout"], [
    { label: "Web", path: "briefings/web/scout.md" },
    { label: "iOS", path: "briefings/ios/scout.md" },
  ]);
});

test("buildBriefingPlan: a dev role's own briefing is included under its label", () => {
  const b = {
    coreAgents: [],
    devRoles: { "python-dev": { label: "Python backend", platform: "web", briefing: "briefings/roles/python-dev.md" } },
    platforms: { web: { label: "Web", briefings: {} } },
  };
  assert.deepEqual(buildBriefingPlan(b, ["python-dev"]), {
    "python-dev": [{ label: "Python backend", path: "briefings/roles/python-dev.md" }],
  });
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

test('resolveSelection: --agents all selects every dev role explicitly, no implicit flag', () => {
  const r = resolveSelection({ explicit: ['all'], devRoleNames: ['js-dev', 'ios-dev'], yes: true, isTTY: false });
  assert.deepEqual(r, { mode: 'explicit', roles: ['js-dev', 'ios-dev'], unknown: [], implicit: false });
});

test('resolveSelection: non-interactive with no --agents is still all roles, flagged implicit', () => {
  const r = resolveSelection({ explicit: null, devRoleNames: ['js-dev', 'ios-dev'], yes: false, isTTY: false });
  assert.deepEqual(r, { mode: 'all', roles: ['js-dev', 'ios-dev'], unknown: [], implicit: true });
  const y = resolveSelection({ explicit: [], devRoleNames: ['js-dev'], yes: true, isTTY: true });
  assert.equal(y.implicit, true);
});

test('resolveSelection: a nonempty explicit list wins over --yes and is never implicit', () => {
  const r = resolveSelection({ explicit: ['js-dev', 'nope'], devRoleNames: ['js-dev', 'ios-dev'], yes: true, isTTY: false });
  assert.deepEqual(r, { mode: 'explicit', roles: ['js-dev'], unknown: ['nope'], implicit: false });
});

test('implicitSelectionWarning names platforms, the narrowing command, and that installed files stay', () => {
  const factory = {
    id: 'feature-development',
    devRoles: { 'python-dev': { platform: 'web' }, 'ios-dev': { platform: 'ios' }, 'android-dev': { platform: 'android' } },
    platforms: { web: { label: 'Web' }, ios: { label: 'iOS' }, android: { label: 'Android' } },
  };
  const text = implicitSelectionWarning(factory, ['python-dev', 'ios-dev', 'android-dev']);
  assert.match(text, /^  ! No --agents given in non-interactive mode, so all 3 developer roles were selected/);
  assert.match(text, /\(Web, iOS and Android overlays applied to the core roles they target\)/);
  assert.match(text, /init --factory feature-development --agents python-dev,ios-dev --update/);
  assert.match(text, /Roles and skills already installed stay on disk\./);
});
