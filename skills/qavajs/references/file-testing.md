# file-testing.md — `@qavajs/steps-files` for filesystem verification

Wait for files to appear, validate text content, and load PDFs / Word / Excel / CSV / arbitrary binaries into memory for downstream assertions. Pairs with `@qavajs/steps-memory` for shape checks.

Source of truth: <https://qavajs.github.io/docs/Steps/files>, <https://github.com/qavajs/steps-files>

## Installation

```bash
npm install @qavajs/steps-files
```

## Configuration

```typescript
export default {
    require: ['node_modules/@qavajs/steps-files/index.js'],
    // Optional: tune the polling for the wait-for-file steps.
    fileTimeout: {
        interval: 1000,  // ms between checks
        timeout:  10000, // ms before giving up
    },
};
```

## Step categories (9 total)

| Category | Patterns |
|---|---|
| **Wait** | `I expect file matching '<regex>' regexp appears in '<dir>'` · `I expect '<path>' file appears` |
| **Validate** | `I expect '<path>' text file content {validation} '<expected>'` |
| **Memory snapshot** | save as buffer / text / Excel / PDF / Word / CSV |

Full literal patterns → [`steps-files.md`](steps-files.md).

## Common shapes

### Wait for a download

```gherkin
Scenario: Export downloads
  When I click 'Export Button'
  Then I expect file matching 'export-\\d+\\.csv' regexp appears in '$downloadDir'
```

### Verify a generated text/HTML file

```gherkin
Scenario: Email template was rendered
  When I trigger 'send notification'
  And  I expect '$tmpDir/last-email.html' file appears
  And  I expect '$tmpDir/last-email.html' text file content to contain '$user.firstName'
  And  I expect '$tmpDir/last-email.html' text file content to match 'unsubscribe'
```

### Load Excel and assert by sheet/cell

```gherkin
Scenario: Report has the right total
  When I save '$reportPath' Excel file content as 'report'
  Then I expect '$report.Sheets.Summary.B2.v' to equal '$expectedTotal'
  And  I expect '$report.SheetNames' to have member 'Summary'
```

The package wraps `xlsx`; `report` is the parsed workbook object — `Sheets`, `SheetNames`, plus the usual cell objects.

### Load a PDF and assert content

```gherkin
Scenario: Invoice PDF mentions the order ID
  When I save '$pdfPath' pdf file content as 'invoice'
  Then I expect '$invoice.textSingleLine' to contain '$orderId'
  And  I expect '$invoice.textSingleLine' to match 'Total:\\s+\\$\\d+\\.\\d{2}'
```

`invoice` exposes `textSingleLine`, `textMultiLine`, and `metadata` (PDF metadata dictionary).

### Load a CSV and assert by row/column

```gherkin
Scenario: CSV export header and row count
  When I save '$exportPath' csv file content as 'export'
  Then I expect '$js($export.length)' to equal '$expectedRows'
  And  I expect '$export[0].customer_id' to equal '$customer.id'
```

The first CSV row is treated as the header — subsequent rows are objects keyed by column name.

### Load a Word document

```gherkin
When I save '$docPath' Word file content as 'doc'
Then I expect '$doc.textMultiLine' to contain 'Confidential'
```

`doc.textSingleLine` and `doc.textMultiLine` mirror the PDF API.

## Memory + buffer interplay

- `I save '$path' file content as 'k'` — saves a `Buffer`. Useful for hashing or streaming on to another step (e.g. uploading via API).
- `I save '$path' text file content as 'k'` — saves a UTF-8 string.
- All loaders accept either a path or a buffer (e.g. you can save a PDF via API into memory, then re-parse it as text without writing to disk).

## Caveats

- **Paths are resolved against the cucumber worker's cwd**, not the feature file's directory. In CI, set `process.chdir(...)` in a `BeforeExecution` hook or use absolute paths from memory.
- **`fileTimeout.interval` / `timeout` apply only to the two wait steps.** They have no effect on the loader steps — those fail immediately if the file isn't present.
- **The Excel and PDF loaders are blocking and synchronous.** For large files (>10 MB), spawn a worker thread instead.
- **`text file content` validation uses the `{validation}` parameter type.** All natural-language phrases work — `to be equal`, `to contain`, `to match`, `to softly contain`, etc.

## Live links

- Step catalog: [`steps-files.md`](steps-files.md)
- Source: <https://github.com/qavajs/steps-files>
- Docs: <https://qavajs.github.io/docs/Steps/files>
