# steps-files — literal Gherkin step catalog

Auto-extracted from `https://github.com/qavajs/steps-files` source.

Total: **9 step definitions**

## `steps-files/src/memory.ts`

### `When` `I save {value} file content as {value}`
Examples:
- `* When I save './folder/file.txt' file content as 'fileContent'`

### `When` `I save {value} text file content as {value}`
Examples:
- `* When I save './folder/file.txt' text file content as 'fileContent'`

### `When` `I save {value} Excel file content as {value}`
Examples:
- `* When I save './folder/file.xls' Excel file content as 'excelContent'`

### `When` `I save {value} pdf file content as {value}`
Examples:
- `* When I save './folder/file.pdf' pdf file content as 'pdfContent'`

### `When` `I save {value} Word file content as {value}`
Examples:
- `* When I save './folder/file.docx' Word file content as 'wordContent'`

### `When` `I save {value} csv file content as {value}`
Examples:
- `* When I save './folder/file.csv' csv file content as 'excelContent'`

## `steps-files/src/validation.ts`

### `When` `I expect {value} text file content {validation} {value}`
Examples:
- `* When I expect './folder/file.txt' text file content to be equal 'file content'`

### `When` `I expect file matching {value} regexp exists in {value}`
Examples:
- `* When I expect file matching 'f.+\.txt' regexp exists in './test-e2e/folder'`

### `When` `I expect {value} file exists`
Examples:
- `* When I expect './test-e2e/folder/file.txt' file exists`

