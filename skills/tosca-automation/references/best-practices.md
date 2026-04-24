# Tosca Best Practices — Condensed Reference

Summary of the 10 Tricentis-published "Tosca Best Practices" KB articles (KB0014209,
KB0014210, KB0014226-0014233). This file captures every rule in each article
verbatim-in-intent and flags the ones that directly govern **how we build
artifacts via the CLI / MBT**.

> Whenever the agent proposes a naming, structure, identification, or action
> choice that contradicts a rule below, it must either (a) follow the rule or
> (b) explicitly state why deviating. Prefer (a).

## 1. General (KB0014209)

1. **Uniform naming conventions** across Modules, TestCases, Folders.
2. **Four-eyes repository structure**: `Component`(templates/refs) + `Component`(shared libs/modules) + one Component per project, each with `Requirements / TestCaseDesign / TestCases / Execution / Modules`, each split into `In Work → Ready for Review → Approved`.
3. **Approval stages**: create in `In Work`, move to `Ready for Review`, then `Approved`. Only use Approved artifacts in runs. `In Work` and `Ready for Review` have one subfolder per user.
4. **No empty folders.** Delete any folder not part of the approval staging.
5. **Create Reusable TestStepBlocks only when actually reused** — never pre-emptively; they clutter the repo.
6. **Test Configuration Parameters for everything shared** (browser, base URL). Per-TC data lives in the TestSheet, not in TCPs.

## 2. Requirements (KB0014210)

1. Group Requirements by business functionality (Functional / Non-Functional / User-Story).
2. One RequirementSet per business unit / application.
3. **Weight every Requirement** (top-down or bottom-up). Unweighted = wrong coverage math.
4. Link every TestCase to the Requirement it proves.
5. Link **logical** TestCases (TestCaseDesign) to Requirements too — gives coverage forecast before automation exists.
6. Link ExecutionLists and ExecutionEntries to RequirementSets / Requirements for execution coverage.
7. Keep the tree shallow enough to read at a glance. Detail ≠ readability.
8. **No more than 7 siblings** at any one Requirements-tree level.

## 3. TestCaseDesign (KB0014226)

1. One uniform TestSheet structure across the portfolio.
2. Pick the right **combinatorial method** when generating Instances (avoid exploding TC count).
3. Rename auto-generated Instances to something business-meaningful.
4. **Use Classes** for reusable data (like customer records). Edit the Class, not the ClassReference.
5. Link TestSheets to TestCase **Templates**; don't hardcode values in automated TCs.
6. **One TestSheet per leaf Requirement**; one TestSheet = one business theme; don't bloat.
7. Mark every Instance with a classification: **StraightThrough / Valid / Invalid**.
8. Mark boundary values.
9. Adequate but not excessive TestCase count (coverage vs runtime vs maintenance).
10. **Equivalence partitioning** — model attributes that actually matter for the test.
11. Concrete values in TestSheet can differ from SUT values (`Low/Medium/High` vs `1/2/3`) — keep the readable one in the sheet, map via a "Value" attribute.
12. Cluster Attributes in logical segments / groups inside a TestSheet.
13. Assign **business relevance** per Attribute: Administration / Precondition / Process / Verification (red / pink / green).
14. **One TestSheet per Template.** Don't share a TestSheet across multiple Templates — use Classes instead.

## 4. Modules (KB0014227)

1. **One Module per functional section of a page** (title bar, nav, content). Big page → multiple modules; small page → one.
2. No duplicate Modules. Every control appears as a ModuleAttribute exactly once.
3. Rename auto-scanned Modules: `Application | Section`. Don't trust XScan's window-caption name.
4. Each Module should hold multiple ModuleAttributes (not 1-attribute modules).
5. **Avoid mixed execution** (TBox + Classic in one TC). Stick to TBox.
6. Delete Modules with no `usages` hits.
7. **Identify by stable, unique properties**: `id`, `name`, `InnerText` (when stable). Not dynamic class fragments, not indices.
8. **ComboBoxes**: identify by `id`, NOT `InnerText` (inner text reflects the current selection and changes).
9. **Avoid `Index`** — use anchor properties; `Index` is the last resort.
10. **Avoid image-based identification** — resolution/anti-aliasing/DEX-hostile.
11. For groups of links/buttons/radios, use a **ControlGroup** ModuleAttribute so they appear as a dropdown in TestStep values.
12. Business-readable ModuleAttribute names.
13. **Cardinality `0-n`** when the same ModuleAttribute is used more than once in a single TestStep.

## 5. TestCases (KB0014228)

1. Every TestCase is split into **Precondition / Process / Postcondition** folders (we use `Precondition / Process / Verification / Teardown` which maps 1-1 with Postcondition ≈ Teardown + extra Verification folder).
2. **Every TestCase has a Verify step** (unless it's a fragment of a BusinessTestCase chain).
3. Use Workstates: `PLANNED (20%) / INWORK (50%) / COMPLETED (100%)`.
4. Name TestSteps `<Action> <Location/Target>` ("Go to home page", "Enter Customer Details").
5. **Avoid static waits** (the `Wait` Timing module). Use **`ActionMode = WaitOn`** on the target element.
6. Group TestSteps in folders. But no folders that hold a single step.
7. **Avoid `If` statements.** Use TestCaseDesign + Conditions instead. Exception: Cleanup preparation.
8. **Avoid `Do` / `While` loops.** Use the Repetition property or Constraint.
9. TestCases must be **self-contained** — no dependencies on another TC having run first. Exception: BusinessTestCase chains that explicitly share TDS state.
10. No single-step TestCases. Every TC has Precondition + Process + Verification + Postcondition content.
11. Use the **Repetition** property on a folder to avoid copy-paste repeats.
12. **Avoid `{CLICK}` / `{SENDKEYS}` keyboard/mouse emulation. Use `X` (direct click) instead.** Emulation is slower, less stable, and breaks when the machine is locked / unattended.
13. Unique TestCase names within a project/component.
14. Drag-and-drop TestSheet values into Template cells (don't hand-type XL references).
15. Drag-and-drop Attributes/Instances to build Conditions.
16. Every Template has a linked TestSheet AND a TestCase TemplateInstance folder — otherwise no executable TCs.
17. Only edit the Template, not the TemplateInstance (changes to instances are lost on re-instantiate).
18. Add **Recovery Scenarios** for anticipated pop-ups/consent banners/crashes. Only fire inside ExecutionLists.
19. Add **Clean-Up Scenarios** so a failed TC resets the SUT before the next TC starts. Only fire inside ExecutionLists.
20. Set the correct **RetryLevel** on Recovery Scenarios (default is TestCase-wide restart, which is often wrong).

## 6. Execution (KB0014229)

1. Every completed TestCase must live in an ExecutionList (never Scratchbook for real runs).
2. Every `COMPLETED` TestCase must have **passed** at least once in an ExecutionList (not just Scratchbook).
3. Group ExecutionLists by test type (smoke / regression / …) in ExecutionList folders.
4. Link ExecutionLists to RequirementSets for execution-vs-coverage reporting.
5. Only put `COMPLETED` TestCases into ExecutionLists.
6. Use the Repetition property on a TestCase inside an ExecutionList to re-run it N times (e.g., create N users with one TC).
7. Configure DEX agent parameters (`OS`, `RAM`, `CPU`) so TestEvents can target the right machine.
8. Use TestEvents (agents + ExecutionLists) for unattended runs.

## 7. Reporting (KB0014230)

1. Import Tricentis default reports (from `Standard.tsu`) into the root Reporting folder — don't build from scratch.

## 8. Test Data Management (KB0014231)

1. Use **TDM** or **TDS** for dynamic test data (data created during or between runs).
2. Add a **`Status` column** in TDM/TDS so you don't reuse consumed data.
3. Keep TDS data fresh during execution — especially for multi-day end-to-end chains. Combine dependent TCs into BusinessTestCases.

## 9. Multi-User Workspace (KB0014233)

1. Every user gets their own login credentials (never share).
2. Separate **regular users** from **administrators** — don't make everyone admin.
3. Use **user groups** for viewing / owning rights.
4. Set viewing/owning groups on folders to enforce access.

## 10. Variables (KB0014232)

1. Put TestConfigurationParameters at the **highest possible level**. Children inherit; override per-level only when needed.
2. **Buffer lifetime = single TestCase.** Buffers live on the executing machine; cross-TC usage breaks on DEX.
3. Store shared settings in the **project** settings, not workspace — project settings sync to agents via the common repo.
4. Same configuration (screen resolution, RAM, OS) across all machines in the test farm.

---

## Agent checklist — quickest-to-violate items

When you build or edit a TestCase/Module via the CLI, apply these before pushing:

- [ ] **TestCase structure** = `Precondition → Process → Verification → Teardown` folders.
- [ ] **No static `Wait` module step** in Process. Use `ActionMode = WaitOn` on the target ModuleAttribute instead.
- [ ] **No `{CLICK}` / `{SENDKEYS}` anywhere.** For Link/Button, use `X` (direct click) as the ActionMode=Input value, not `{Click}` / `{LEFTCLICK}` / etc.
- [ ] **Every Verify step** has a real check — not just `True == True`.
- [ ] **Every TestCase** has ≥ 1 real Verify step (unless documented Business-TC fragment).
- [ ] **Module identification**: `id` > `Name` > `InnerText` > `HREF` (stable URL fragment) > `Tag + Parent` > `Index` (last resort).
- [ ] **No invisible/duplicate-target attributes**: `IgnoreInvisibleHtmlElements=False` does include invisible elements — if an invisible clone exists, your click lands on the wrong node.
- [ ] **Cardinality `0-n`** if the same ModuleAttribute is used twice in one TestStep.
- [ ] **Unique, business-readable names** for TestCase, TestStep, Module, ModuleAttribute.
- [ ] **No empty folders.**
- [ ] **No Modules without `usages`.** Delete before committing.

---

## Reference artifacts

- Original KB articles (KB0014209 — KB0014233) on the Tricentis support portal. PDF versions linked at the bottom of each KB article — fetch on demand, not mirrored here.
- Our skill's existing references (`web-automation.md`, `sap-automation.md`, `blocks.md`) contain the mechanical "how" — **this file is the "whether/why"**.
