# SAP GUI Automation (SapEngine) — Detailed Guide

## SAP engine vs Html engine

| Property | Html engine | SAP engine |
|----------|------------|------------|
| Module `businessType` | `HtmlDocument` | `Window` |
| `interfaceType` | `Gui` | `Gui` |
| Attribute Engine param | `Html` | `SapEngine` |
| TechnicalId locator | `Tag`, `InnerText`, `HREF`, `ClassName` | `RelativeId` |
| Browser config param | `Browser: Chrome/Edge/Firefox` | **None** |
| Session startup | `OpenUrl` standard module | Precondition reusable block |

## Standard SAP framework modules (not in Inventory)

These are engine-provided. Use their IDs directly — never search `inventory` for them.

| Step | Module ID | Attribute | Attr ref ID | Notes |
|------|-----------|-----------|-------------|-------|
| `Close SAP Logon` | `1b9ae625-f924-4837-89b4-63da94bbd701` | `Path` | `39e342b2-958e-f3b9-4561-e4b466384784` | Value: `taskkill` |
| same | same | `Arguments` | `39e342b2-958e-8357-d519-dc29dbb4d77f` | `actionMode: "Select"`; see `subValues` |
| same | same | `Argument` (subValue) | `39e342b2-958e-b1d9-61c7-6718ae8be275` | `/f`, `/im`, `saplogon.exe` |
| `SAP Logon` | `3c3b1139-48a5-4ad0-a33c-72b3cbbc30f7` | `SapLogonPath` | `39e342b2-961b-0690-437e-9ff959a98288` | Path to `saplogon.exe` |
| same | same | `SapConnection` | `39e342b2-961b-3ba0-e24a-644888d69eeb` | Connection name in Logon Pad |
| `SAP Login` | `24437bbe-dcd2-441c-bdd4-37537c0bde99` | `Client` | `39e342b2-961b-4340-b56e-50e7fd7f1bab` | Client number |
| same | same | `User` | `39e342b2-961b-d3b0-29f7-fae93ac1f0e3` | Use `{CP[Username]}` |
| same | same | `Password` | `39e342b2-961b-4754-ea0c-ebc747c29cd0` | `dataType: "Password"` |
| same | same | `Enter` | `39e342b2-961b-ef6e-24bf-07d5c81dc707` | Value `"X"` to click |
| `T-code` | `35fcfe84-c373-4b53-869b-604af40a689e` | `Transaction code` | `39e342b2-961b-de12-c278-888795c3d7dc` | Enter T-code string |
| same | same | `Buttons` | `39e342b2-961b-bff2-cf38-9a91cd40a637` | Value `"Enter"` to confirm |
| `Wait` | `80b7982e-0e10-4bc0-bdf3-6bc04503fd63` | `Duration` | `39e342b2-958e-ba1f-bb58-702e193d6016` | ms; `dataType: Numeric` |

## Precondition reusable block (always the first testCaseItem)

Block ID: `b0e929fa-1038-4246-9ab7-b4878f41d66e`

Handles: `taskkill saplogon.exe` → Wait 5s → SAP Logon → SAP Login.

**Never inline these steps** — always reference this block.

### Business parameter IDs

| Param | ULID |
|-------|------|
| `SapLogonPath` | `01KHJSJ4D4AY1BG2KDK4BAK1TD` |
| `SapConnection` | `01KHJSJ6H4EVTFQVGTKSVGA05G` |
| `Client` | `01KHJSJ8TFB32TV3W42JFMYCFN` |
| `User` | `01KHJSJB7H6QNQER4WK6P5NS8N` |
| `Password` | `01KHJSJDM36KRJHSBV5PRN8035` |

### testCaseItem[0] template

```json
{
  "$type": "TestStepFolderReferenceV2",
  "reusableTestStepBlockId": "b0e929fa-1038-4246-9ab7-b4878f41d66e",
  "parameterLayerId": "<fresh-ULID>",
  "parameters": [
    {"id": "<fresh-ULID>", "referencedParameterId": "01KHJSJ4D4AY1BG2KDK4BAK1TD", "value": "C:\\Program Files\\SAP\\FrontEnd\\SAPgui\\saplogon.exe"},
    {"id": "<fresh-ULID>", "referencedParameterId": "01KHJSJ6H4EVTFQVGTKSVGA05G", "value": "E93"},
    {"id": "<fresh-ULID>", "referencedParameterId": "01KHJSJ8TFB32TV3W42JFMYCFN", "value": "100"},
    {"id": "<fresh-ULID>", "referencedParameterId": "01KHJSJB7H6QNQER4WK6P5NS8N", "value": "{CP[Username]}"},
    {"id": "<fresh-ULID>", "referencedParameterId": "01KHJSJDM36KRJHSBV5PRN8035", "value": "{CP[Password]}"}
  ],
  "id": "<fresh-ULID>",
  "name": "Precondition",
  "disabled": false
}
```

## Test case configuration (no Browser param)

```json
"testConfigurationParameters": [
  {"name": "Username", "value": "your_user", "dataType": "String"},
  {"name": "Password", "dataType": "Password", "password": {"id": "<encryptedId>"}}
]
```

## 4-folder structure

```
Precondition   — TestStepFolderReferenceV2 → block b0e929fa
Process        — TestStepFolderV2:
                   T-code step (module 35fcfe84)
                   ControlFlowItemV2 If  (optional popup)
                   Inventory screen module steps
Verification   — (optional) Verify steps
Teardown       — (optional) Wait / close
```

## SAP inventory module structure

```json
{
  "$type": "ApiModuleV2",
  "id": "<moduleId>",
  "name": "FBCJ | Cash Journal: Initial Data pop up",
  "businessType": "Window",
  "interfaceType": "Gui",
  "attributes": [
    {
      "id": "<attrId>",
      "name": "Posting Date",
      "businessType": "TextBox",
      "defaultActionMode": "Input",
      "defaultDataType": "String",
      "defaultOperator": "Equals",
      "valueRange": ["{Click}", "{Doubleclick}", "{Rightclick}"],
      "isVisible": true, "isRecursive": false, "cardinality": "ZeroToOne",
      "interfaceType": "Gui",
      "parameters": [
        {"name": "BusinessAssociation", "value": "Descendants",        "type": "Configuration"},
        {"name": "Engine",              "value": "SapEngine",          "type": "Configuration"},
        {"name": "RelativeId",          "value": "/usr/ctxtBDATU_PAD", "type": "TechnicalId"}
      ]
    }
  ]
}
```

**Note**: SAP modules do NOT have a root-level `parameters[]` with Engine — the Engine config lives inside each attribute's `parameters[]`.

**Note**: SAP modules do NOT use `Tag`, `InnerText`, `HREF`, or `ClassName` as TechnicalId — only `RelativeId`.

## RelativeId patterns

| Element type | Prefix | Example |
|-------------|--------|---------|
| Text / char input | `/usr/ctxt` | `/usr/ctxtANLA-ANLKL` |
| Numeric input | `/usr/txt` | `/usr/txtBETRG-1` |
| Button | `/usr/btn` | `/usr/btnFB_TODAY` |
| Tab strip | `/usr/tabs` | `/usr/tabsTS_BUKRS` |
| Checkbox | `/usr/chk` | `/usr/chkFLAG-1` |

## ControlGroup attribute (toolbar / button group)

When several buttons belong to one toolbar region, model them as a `ControlGroup` attribute with nested child `Button` attributes:

```json
{
  "id": "<groupId>",
  "name": "Toolbar",
  "businessType": "ControlGroup",
  "interfaceType": "Gui",
  "attributes": [
    {
      "id": "<btnId>",
      "name": "Today",
      "businessType": "Button",
      "valueRange": ["{Click}"],
      "parameters": [
        {"name": "Engine",     "value": "SapEngine",       "type": "Configuration"},
        {"name": "RelativeId", "value": "/usr/btnFB_TODAY", "type": "TechnicalId"}
      ]
    }
  ]
}
```

## TabControl attribute

Use `actionMode: "Select"` in the step value (not `"Input"`):

```json
{
  "id": "<attrId>",
  "name": "Select tab",
  "businessType": "TabControl",
  "defaultActionMode": "Select",
  "valueRange": ["Tab1Name", "Tab2Name"],
  "parameters": [
    {"name": "BusinessAssociation", "value": "Descendants",     "type": "Configuration"},
    {"name": "Engine",              "value": "SapEngine",       "type": "Configuration"},
    {"name": "RelativeId",          "value": "/usr/tabsTS_TAB", "type": "TechnicalId"}
  ]
}
```

## ControlFlowItemV2 — conditional popup

```json
{
  "$type": "ControlFlowItemV2",
  "statementTypeV2": "If",
  "condition": {
    "items": [
      {
        "$type": "TestStepV2",
        "testStepValues": [
          {
            "name": "<FieldName>", "value": "<ExpectedValue>",
            "actionMode": "Verify", "actionProperty": "Visible",
            "dataType": "String", "operator": "Equals",
            "moduleAttributeReference": { "...": "..." }
          }
        ],
        "moduleReference": { "...": "..." }
      }
    ]
  },
  "conditionPassed": {
    "items": [
      {"$type": "TestStepV2", "testStepValues": ["..."]}
    ]
  },
  "id": "<ULID>",
  "name": "If initial popup is visible",
  "disabled": false
}
```

## Module naming convention

`TCODE | Screen Name` — e.g.:
- `FBCJ | Cash Journal: Initial Data pop up`
- `AS01 | Create Asset | Initial screen`
- `ME21N | Create Purchase Order`
- `MIGO | Goods Receipt Purchase Order`

## Finding RelativeId values

- Copy from a similar existing module: `modules get <existingModuleId> --json`
- SAP GUI field: press `F1` → Technical Information → "Screen field" (e.g. `ANLA-ANLKL`). Prefix with `/usr/ctxt` for text fields.
- From existing test case steps: `cases steps <existingCaseId> --json` → `moduleAttributeReference.metadata`

## Creation workflow

```bash
# 1. Check for existing screen modules
tosca inventory search "<TCODE>" --type Module --json

# 2. Create module if missing
tosca modules create --name "<TCODE> | <ScreenName>" --iface Gui --json
# Write module body JSON (businessType: Window, SapEngine attributes with RelativeId)
tosca modules update <moduleId> --json-file /tmp/module.json
tosca modules get <moduleId> --json   # verify

# 3. Create test case
tosca cases create --name "<description>" --state Planned --json
# Write case body:
#   - testConfigurationParameters: Username + Password (no Browser)
#   - testCaseItems[0]: Precondition block b0e929fa with 5 param values
#   - testCaseItems[1+]: Process/Verification/Teardown folders
tosca cases update <caseId> --json-file /tmp/case.json
tosca cases steps <caseId>
tosca inventory move testCase <caseId> --folder-id <folderId>
```
