# JQL Patterns — EPAM TM Plugin

Replace `<PROJECT>` with your Jira project key, `<RUN_ID>` with
the TM test-run ID resolved from step 1 of the SKILL.md
workflow, and `<FOLDER_ID>` with the leaf folder ID you're
targeting.

---

## Automation-oriented queries (status + type filtering)

These are the most common patterns for test automation work —
filter by folder, exclude out-of-scope tests, and narrow by
test type.

### All manual tests in a folder, excluding Out of Scope (primary automation recipe)

```jql
project = <PROJECT>
AND issuetype = Test
AND "test run id" = "<RUN_ID>"
AND Folder = "Smoke/Regression"
AND "Test Status" not in ("Out of Scope")
AND "Test Type" = Manual
```

### Automated tests not yet run — find what's pending automation coverage

```jql
project = <PROJECT>
AND issuetype = Test
AND "test run id" = "<RUN_ID>"
AND "Test Type" = "Automated"
AND "Test Status" in ("Not Run", "Untested")
```

### Failed tests in a specific folder — automation triage

```jql
project = <PROJECT>
AND issuetype = Test
AND "test run id" = "<RUN_ID>"
AND cf[23101] = "<FOLDER_ID>"
AND cf[31501] = "Failed"
ORDER BY created ASC
```

### All non-passing tests across an entire run

```jql
project = <PROJECT>
AND issuetype = Test
AND cf[23100] = "<RUN_ID>"
AND "Test Status" not in ("Passed", "Out of Scope", "Skipped")
```

---

## Standard queries

### All tests in a run (by run ID)

```jql
project = <PROJECT> AND issuetype = Test AND cf[23100] = "<RUN_ID>"
```

### All tests in a run (by run name)

```jql
project = <PROJECT> AND issuetype = Test AND cf[24000] = "Test Library"
```

> `"Test Library"` is the common default run name — substitute
> whatever your project uses.

### Tests in a folder by ID (reliable, use when you have the ID)

```jql
project = <PROJECT>
AND issuetype = Test
AND cf[23100] = "<RUN_ID>"
AND cf[23101] = "<FOLDER_ID>"
```

### Tests in a folder by path (exact match only)

```jql
project = <PROJECT>
AND issuetype = Test
AND cf[23100] = "<RUN_ID>"
AND cf[24001] = "Smoke/Regression"
```

### Tests across a subtree (collect exact paths from a folder-tree sweep first)

```jql
project = <PROJECT>
AND issuetype = Test
AND cf[23100] = "<RUN_ID>"
AND (cf[24001] = "Smoke/Regression"
     OR cf[24001] = "Smoke/Regression/SubA"
     OR cf[24001] = "Smoke/Regression/SubA/Leaf")
```

### Root-level tests only

```jql
project = <PROJECT>
AND issuetype = Test
AND cf[23100] = "<RUN_ID>"
AND cf[23101] = "<RUN_ID>"
```

(Root tests have `cf[23101] == cf[23100]`.)

---

## Notes on JQL field aliases

The TM plugin registers human-readable aliases for its fields.
Both forms work:

| Alias (human-readable) | ID form |
|---|---|
| `"test run id"` | `cf[23100]` |
| `Folder` | `cf[24001]` |
| `"Test Status"` | `cf[31501]` |
| `"Test Type"` | `cf[31500]` |

For `Folder` (`cf[24001]`): only `=` is supported — **no `~`,
`LIKE`, or `startsWith`**.

For `"Test Status"` with `not in`: use parentheses —
`"Test Status" not in ("Out of Scope", "Skipped")`.

---

## Lean folder-tree sweep (for building a folder hierarchy from JQL)

Request only the two folder fields to keep each page response
tiny — useful when the TM Plugin `/rest/tm/1.0/folder/list` API
isn't reachable for some reason and you have to reconstruct the
tree from test data:

```json
POST /rest/api/2/search
{
  "jql": "project = <PROJECT> AND issuetype = Test AND cf[23100] = \"<RUN_ID>\" ORDER BY cf[23101] ASC",
  "maxResults": 100,
  "startAt": 0,
  "fields": ["customfield_23101", "customfield_24001"]
}
```

Paginate until exhaustion, then collect unique
`(cf[23101], cf[24001])` pairs. Empty folders (those with no
direct tests) won't appear — for a complete hierarchy use the
folder-list API instead.
