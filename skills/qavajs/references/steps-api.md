# steps-api — literal Gherkin step catalog

Auto-extracted from `https://github.com/qavajs/steps-api` source.

Total: **33 step definitions**

## `steps-api/src/apiActionSteps.ts`

### `When` `I send {string} request to {value} and save response as {value}`
Examples:
- `* I send "GET" request to "$BASE_API_URL" and save response as "response"`

### `When` `I send {string} request to {value} with headers {value} and save response as {value}`
Examples:
- `* I send "GET" request to "$BASE_API_URL" with headers "$headers" and save response as "response"`

### `When` `I send {string} request to {value} with qs {value} and save response as {value}`
Examples:
- `* I send "GET" request to "https://www.some_service.com/some_endpoint" with qs "?category=HR&name=test" and save response as "response"`

### `When` `I send {string} request to {value} with headers {value} with qs {value} and save response as {value}`
Examples:
- `* I send "GET" request to "https://www.some_service.com/some_endpoint" with qs "?category=HR&name=test" and save response as "response"`

### `When` `I send {string} request to {value} with body {value} and save response as {value}`
Examples:
- `* I send "POST" request to "$BASE_API_URL" with body "$textFile('test_data_file.json')" and save response as "response"`

### `When` `I send {string} request to {value} with headers {value} with body {value} and save response as {value}`
Examples:
- `* I send "POST" request to "$BASE_API_URL" with headers "$json('headers.json')" with body "$textFile('test_data_file.json')" and save response as "response"`

### `When` `I send {string} request to {string} with qs {string} and body {string} and save response as {string}`
Examples:
- `* I send "PUT" request to "https://www.some_service.com/some_endpoint/" with qs "?category=HR&name=test" and body "test_data_file.json" and save response as "response"`

### `When` `I send {string} request to {string} with headers {string} with qs {string} and body {string} and save response as {string}`
Examples:
- `* I send "PUT" request to "https://www.some_service.com/some_endpoint/" with qs "?category=HR&name=test" and body "test_data_file.json" and save response as "response"`

### `When` `I send {string} request and save response as {value} to {value} with body:`
Examples:
- `* I send "POST" request and save response as "response" to "$BASE_API_URL" with body:`

### `When` `I send {string} request and save response as {value} to {value} with headers {value} with body:`
Examples:
- `* I send "POST" request and save response as "response" to "$BASE_API_URL" with body:`

### `When` `I parse {value} body as {bodyParsingType}`
Examples:
- `* I parse "$response" body as json`

### `When` `I parse {value} body as {value}`
Examples:
- `* I parse "$response" body as "$soap"`
- `* import { XMLParser } from 'fast-xml-parser';`

### `When` `I clone/copy {value} response as {value}`
Examples:
- `* I clone '$response' response as 'copiedResponse'`

## `steps-api/src/apiConstructionSteps.ts`

### `When` `I create {string} request {value}`
Examples:
- `* When I create 'GET' request 'request'`

### `When` `I create GraphQL request {value}`
Examples:
- `* When I create GraphQL request 'request'`

### `When` `I add headers to {value}:`
Examples:
- `* When I add headers to '$request':`

### `When` `I add {value} headers to {value}`
Examples:
- `* When I add '$headers' headers to '$request'`

### `When` `I add body to {value}:`
Examples:
- `* When I add body to '$request':`

### `When` `I add {gqlRequestProperty} to GraphQL {value}:`
Examples:
- `* When I add query to GraphQL '$request':`

### `When` `I add form data body to {value}:`
Examples:
- `* When I add body to '$request':`

### `When` `I add {value} body to {value}`
Examples:
- `* When I add '$body' body to '$request'`

### `When` `I add {value} url to {value}`
Examples:
- `* When I add 'https://qavajs.github.io/' url to '$request'`

### `When` `I send {value} request and save response as {value}`
Examples:
- `* When I send '$request' request and save response as 'response'`

## `steps-api/src/apiVerificationSteps.ts`

### `Then` `Response {value} contains:`
Examples:
- `* Response "$response.payload.data.items" contains:`

### `Then` `Response type {value} {validation} {value}`
Examples:
- `* Response type "$response.payload.data.items" equals to "array"`

### `Then` `Response {value} size {validation} {value}`
Examples:
- `* Response "$response.payload.data.items" size to be above "0"`

### `Then` `Response {value} {validation} {value}`
Examples:
- `* I verify response "$response.payload.data.items[0].title" equals to "TEST"`

## `steps-api/src/websocket.ts`

### `When` `I connect to {value} ws endpoint {value}`

### `When` `I save message from {value} ws endpoint as {value}`

### `When` `I save message matching {value} from {value} ws endpoint as {value}`

### `When` `I send {value} message to {value} ws endpoint`

### `When` `I send message to {value} ws endpoint:`

### `When` `I close {value} ws connection`

