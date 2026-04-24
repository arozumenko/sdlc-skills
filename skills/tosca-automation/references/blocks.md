# Reusable Test Step Blocks — Deep Dive

## What blocks are

Blocks (`reuseableTestStepBlocks`) are reusable step sequences with a typed parameter interface. They are the primary way to build **data-driven test matrices** in TOSCA Cloud — one block defines the steps, many test cases supply different parameter values.

## Block endpoint (note the Tricentis typo: `reuseable`)

```
GET/PUT/PATCH/DELETE /{spaceId}/_mbt/api/v2/builder/reuseableTestStepBlocks/{id}
```

## How blocks connect to test cases

```
ReuseableTestStepBlock
  └── businessParameters[]
        ├── { id: "ULID", name: "Material1",         valueRange: [] }
        ├── { id: "ULID", name: "Material2",         valueRange: [] }
        └── { id: "ULID", name: "NumberOfMaterials", valueRange: ["1","2","3"] }

TestCaseV2.testCaseItems[]
  └── TestStepFolderReferenceV2
        ├── reusableTestStepBlockId: "b0e929fa-..."   ← the block's UUID
        ├── parameterLayerId: "<fresh-ULID>"          ← REQUIRED: links this usage to its param values
        └── parameters[]
              ├── { id: "<fresh-ULID>", referencedParameterId: "<block-param-id>", value: "YSD_HAWA230" }
              └── { id: "<fresh-ULID>", referencedParameterId: "<count-param-id>", value: "3" }
```

**Key rule**: every `referencedParameterId` must match an `id` in the block's `businessParameters[]`. Use `blocks get <blockId> --json` to get those IDs.

## CLI commands

```bash
tosca blocks get <blockId>                              # show block + businessParameters table
tosca blocks add-param <blockId> --name <name>          # add param, prints new ULID
tosca blocks add-param <blockId> --name <name> --value-range '1,2,3'
tosca blocks set-value-range <blockId> <paramName> --values '1,2,3,4'
tosca blocks delete <blockId> --force
```

## Workflow: extend a block for a new data row (e.g. add 4th Material)

```bash
# 1. Inspect the block
tosca blocks get <blockId> --json

# 2. Add the new parameter — CLI generates a ULID and prints it
tosca blocks add-param <blockId> --name Material4
# Output: New parameter Id: 01KKKF297AAQB3K3WQSMQE2WPQ  ← save this

# 3. Extend a count/enum parameter's valueRange if needed
tosca blocks set-value-range <blockId> NumberOfMaterials --values '1,2,3,4'

# 4. Build the new test case JSON (clone existing case body, change values)
#    - Fresh parameterLayerId (ULID) for the TestStepFolderReferenceV2
#    - Fresh id (ULID) for each parameter entry
#    - referencedParameterId = the block param ULID from step 2

# 5. PUT the case
tosca cases update <caseId> --json-file updated_case.json
```

## TestStepFolderReferenceV2 template

```json
{
  "$type": "TestStepFolderReferenceV2",
  "reusableTestStepBlockId": "<blockId>",
  "parameterLayerId": "<fresh-ULID>",
  "parameters": [
    { "id": "<fresh-ULID>", "referencedParameterId": "<block-param-id-1>", "value": "value1" },
    { "id": "<fresh-ULID>", "referencedParameterId": "<block-param-id-2>", "value": "value2" }
  ],
  "id": "<fresh-ULID>",
  "name": "BlockName",
  "disabled": false
}
```

## ULID rules

Generate a **fresh** ULID for each:
- `parameterLayerId` in every `TestStepFolderReferenceV2`
- Each parameter `id` inside that reference's `parameters[]`
- Each new `businessParameter.id` when adding a param to a block

**Never reuse** ULIDs across different cases or parameter slots — the server may silently ignore duplicates.

## Common pitfalls

| Situation | What to do |
|-----------|-----------|
| `parameterLayerId` missing | All parameter values silently ignored — always include it |
| `referencedParameterId` wrong | Use `blocks get <blockId> --json` to get exact param IDs from `businessParameters[].id` |
| Block PUT rejects `version` field | The CLI strips it automatically — never include it manually |
| Block PUT rejects entry without `id` | Every `businessParameters` entry needs a ULID `id` — use `blocks add-param` which generates one |
| Block ID not found via `inventory search` | Block IDs come from test cases, not inventory: `cases get --json <caseId>` → `testCaseItems[].reusableTestStepBlockId` where `$type == "TestStepFolderReferenceV2"` |
