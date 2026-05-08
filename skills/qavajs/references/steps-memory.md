# steps-memory — literal Gherkin step catalog

Auto-extracted from `https://github.com/qavajs/steps-memory` source.

Total: **15 step definitions**

## `steps-memory/src/memory.ts`

### `When` `I save result of math expression {value} as {value}`
Examples:
- `When I save result of math expression '{$variable} + 42' as 'result'`
- `When I save result of math expression '{$random()} * 100' as 'result'`

### `When` `I save {value} to memory as {value}`
Examples:
- `I save 'value' to memory as 'key'`
- `I save '$getRandomUser()' to memory as 'user'`

### `When` `I save multiline string to memory as {value}:`

### `When` `I set {value} = {value}`
Examples:
- `I set 'key' = 'value'`

### `When` `I save json to memory as {value}:`
Examples:
- `I save json to memory as 'key':`

### `When` `I save key-value pairs to memory as {value}:`
Examples:
- `I save key-value pairs to memory as 'key':`

## `steps-memory/src/validation.ts`

### `Then` `I expect {value} {validation} {value}`
Examples:
- `I expect '$value' equals to '$anotherValue'`
- `I expect '$value' does not contain '56'`

### `Then` `I expect at least {int} element(s) in {value} array {validation} {value}`
Examples:
- `I expect at least 1 element in '$arr' array to be above '$expectedValue'`
- `I expect at least 2 elements in '$arr' array to be above '50'`

### `Then` `I expect every element in {value} array {validation} {value}`
Examples:
- `I expect every element in '$arr' array to be above '$expectedValue'`
- `I expect every element in '$arr' array to be above '50'`

### `Then` `I expect {value} array to be sorted by {value}`
Examples:
- `I expect '$arr' array to be sorted by '$ascending'`

### `Then` `I expect {value} array {validation}:`
Examples:
- `* When I expect '$arr' array to have members:`

### `Then` `I expect {value} {validation} at least one of {value}`
Examples:
- `* When I expect '$text' to equal at least one of '$js(["free", "11.99"])'`

### `Then` `I expect {value} {validation} at least one of:`
Examples:
- `* When I expect '$text' to equal at least one of:`

### `Then` `I expect {value} {validation} all of {value}`
Examples:
- `* When I expect '$text' not to equal all of '$js(["free", "10.00"])'`

### `Then` `I expect {value} {validation} all of:`
Examples:
- `* When I expect '$text' not to equal all of:`

