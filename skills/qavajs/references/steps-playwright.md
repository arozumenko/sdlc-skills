# steps-playwright — literal Gherkin step catalog

Auto-extracted from `https://github.com/qavajs/steps-playwright` source.

Total: **107 step definitions**

## `steps-playwright/src/actions.ts`

### `When` `I open {value} url`
Examples:
- `I open 'https://google.com'`

### `When` `I type {value} (in)to {playwrightLocator}`
Examples:
- `I type 'wikipedia' to 'Google Input'`
- `I type 'wikipedia' into 'Google Input'`

### `When` `I type {value} chars (in)to {playwrightLocator}`
Examples:
- `I type 'wikipedia' chars to 'Google Input'`
- `I type 'wikipedia' chars into 'Google Input'`

### `When` `I click {playwrightLocator}`
Examples:
- `I click 'Google Button'`

### `When` `I force click {playwrightLocator}`
Examples:
- `I force click 'Google Button'`

### `When` `I right click {playwrightLocator}`
Examples:
- `I right click 'Google Button'`

### `When` `I double click {playwrightLocator}`
Examples:
- `I double click 'Google Button'`

### `When` `I clear {playwrightLocator}`
Examples:
- `I clear 'Google Input'`

### `When` `I switch to {int} window`
Examples:
- `I switch to 2 window`

### `When` `I switch to {value} window`
Examples:
- `I switch to 'google' window`

### `When` `I refresh page`
Examples:
- `I refresh page`

### `When` `I press {string} key(s)`
Examples:
- `I press 'Enter' key`
- `I press 'Control+C' keys`

### `When` `I press {string} key(s) {int} time(s)`
Examples:
- `I press 'Enter' key 5 times`
- `I press 'Control+V' keys 5 times`

### `When` `I hover over {playwrightLocator}`
Examples:
- `I hover over 'Google Button'`

### `When` `I select {value} option from {playwrightLocator} dropdown`
Examples:
- `I select '1900' option from 'Registration Form > Date Of Birth'`
- `I select '$dateOfBirth' option from 'Registration Form > Date Of Birth' dropdown`

### `When` `I select {int}(st|nd|rd|th) option from {playwrightLocator} dropdown`
Examples:
- `I select 1 option from 'Registration Form > Date Of Birth' dropdown`

### `When` `I click {value} text in {playwrightLocator} collection`
Examples:
- `I click 'google' text in 'Search Engines' collection`
- `I click '$someVarWithText' text in 'Search Engines' collection`

### `When` `I scroll by {value}`
Examples:
- `* When I scroll by '0, 100'`

### `When` `I scroll to {playwrightLocator}`
Examples:
- `I scroll to 'Element'`

### `When` `I scroll by {value} in {playwrightLocator}`
Examples:
- `* When I scroll by '0, 100' in 'Overflow Container'`

### `When` `I scroll until {playwrightLocator} to be visible`
Examples:
- `* When I scroll until 'Row 99' to be visible`

### `When` `I scroll in {playwrightLocator} until {playwrightLocator} to be visible`
Examples:
- `* When I scroll in 'List' until 'Row 99' to be visible`

### `When` `I save file to {value} by clicking {playwrightLocator}`
Examples:
- `I save file to './folder/file.pdf' by clicking 'Download Button'`

### `When` `I upload {value} file to {playwrightLocator}`
Examples:
- `I upload '/folder/file.txt' to 'File Input'`

### `When` `I upload files by clicking {playwrightLocator}:`
Examples:
- `I upload files by clicking 'Upload Button':`

### `When` `I upload {value} file by clicking {playwrightLocator}`
Examples:
- `I upload '/folder/file.txt' by clicking 'Upload Button'`

### `When` `I drag and drop {playwrightLocator} to {playwrightLocator}`
Examples:
- `I drag and drop 'Bishop' to 'E4'`

### `When` `I open new tab`
Examples:
- `I open new tab`

### `When` `I close current tab`
Examples:
- `* Then I close current tab`

### `When` `I click {value} coordinates in {playwrightLocator}`
Examples:
- `When I click '0, 20' coordinates in 'Element'`

### `When` `I set window size {value}`
Examples:
- `I set window size '1366,768'`

### `When` `I click {playwrightBrowserButton} button`
Examples:
- `I click back button`
- `I click forward button`

### `When` `I tap {playwrightLocator}`
Examples:
- `I tap 'Google Button'`

### `When` `I grant {value} permission`
Examples:
- `I grant 'geolocation' permission`

### `When` `I revoke browser permissions`

### `When` `I set {value} geolocation`
Examples:
- `I set '$minsk' geolocation`

## `steps-playwright/src/cookies.ts`

### `When` `I set {value} cookie as {value}`
Examples:
- `I set 'userID' cookie 'user1'`
- `I set 'userID' cookie '$userIdCookie'`

### `When` `I save value of {value} cookie as {value}`
Examples:
- `I save value of 'auth' cookie as 'authCookie'`

## `steps-playwright/src/dialog.ts`

### `When` `I will wait for alert/dialog`
Examples:
- `I will wait for dialog`

### `When` `I accept alert/dialog`
Examples:
- `I accept alert`

### `When` `I dismiss alert/dialog`
Examples:
- `I dismiss alert`

### `When` `I type {value} to alert/dialog`
Examples:
- `I type 'coffee' to alert`

### `Then` `I expect text of alert/dialog {validation} {value}`
Examples:
- `I expect text of alert does not contain 'coffee'`

## `steps-playwright/src/electron.ts`

### `When` `I execute {value} function/script on electron app`
Examples:
- `I execute '$fn' function and save result as 'result' // fn is function reference`
- `I execute '$js(async ({ app }) => app.getAppPath())' function and save result as 'scroll'`

### `When` `I execute {value} function/script on electron app and save result as {value}`
Examples:
- `I execute '$fn' function and save result as 'result' // fn is function reference`
- `I execute '$js(async ({ app }) => app.getAppPath())' function on electron app and save result as 'result'`

### `When` `I click {value} electron menu`
Examples:
- `I click 'File > Edit' electron menu`

## `steps-playwright/src/execute.ts`

### `When` `I execute {value} function/script`
Examples:
- `I execute '$fn' function // fn is function reference`
- `I execute 'window.scrollBy(0, 100)' function`

### `When` `I execute {value} function/script and save result as {value}`
Examples:
- `I execute '$fn' function and save result as 'result' // fn is function reference`
- `I execute 'window.scrollY' function and save result as 'scroll'`

### `When` `I execute {value} function/script on {playwrightLocator}`
Examples:
- `I execute '$fn' function on 'Component > Element' // fn is function reference`
- `I execute 'arguments[0].scrollIntoView()' function on 'Component > Element'`

### `When` `I execute {value} function/script on {playwrightLocator} and save result as {value}`
Examples:
- `I execute '$fn' function on 'Component > Element' and save result as 'innerText' // fn is function reference`
- `I execute 'arguments[0].innerText' function on 'Component > Element' and save result as 'innerText'`

## `steps-playwright/src/intercept.ts`

### `When` `I create interception for {value} as {value}`
Examples:
- `I create interception for '**\/api/qavajs' as 'intercept'`
- `I create interception for '$interceptHandler' as 'intercept' // if you need to pass function as interception handler`

### `When` `I wait for {value} response`
Examples:
- `I wait for '$interception' response`

### `When` `I save {value} response as {value}`
Examples:
- `I save '$interception' response as 'response'`

## `steps-playwright/src/keyboardActions.ts`

### `When` `I hold down {string} key`
Examples:
- `When I hold down 'Q' key`

### `When` `I release {string} key`
Examples:
- `When I release 'A' key`

## `steps-playwright/src/localSessionStorage.ts`

### `When` `I set {value} {word} storage value as {value}`
Examples:
- `I set 'username' local storage value as 'user1'`
- `I set '$sessionStorageKey' session storage value as '$sessionStorageValue'`

### `When` `I save value of {value} {word} storage as {value}`
Examples:
- `I save value of 'username' local storage as 'localStorageValue'`
- `I save value of '$sessionStorageKey' session storage value as 'sessionStorageValue'`

## `steps-playwright/src/memory.ts`

### `When` `I save text of {playwrightLocator} as {value}`
Examples:
- `I save text of 'Search Results (1)' as 'firstSearchResult'`

### `When` `I save value of {playwrightLocator} as {value}`
Examples:
- `I save value of 'Search Input' as 'searchInput'`

### `When` `I save {value} property of {playwrightLocator} as {value}`
Examples:
- `I save 'checked' property of 'Checkbox' as 'checked'`
- `I save '$prop' property of 'Checkbox' as 'checked'`

### `When` `I save {value} attribute of {playwrightLocator} as {value}`
Examples:
- `I save 'href' attribute of 'Link' as 'linkHref'`
- `I save '$prop' attribute of 'Link' as 'linkHref'`

### `When` `I save {value} custom property of {playwrightLocator} as {value}`
Examples:
- `I save 'checked' property of 'Checkbox' as 'checked'`
- `I save '$prop' property of 'Checkbox' as 'checked'`

### `When` `I save number of elements in {playwrightLocator} collection as {value}`
Examples:
- `I save number of elements in 'Search Results' as 'numberOfSearchResults'`

### `When` `I save text of every element of {playwrightLocator} collection as {value}`
Examples:
- `I save text of every element of 'Search Results' collection as 'searchResults'`

### `When` `I save {value} attribute of every element of {playwrightLocator} collection as {value}`
Examples:
- `I save 'checked' attribute of every element of 'Search > Checkboxes' collection as 'checkboxes'`

### `When` `I save {value} property of every element of {playwrightLocator} collection as {value}`
Examples:
- `I save 'href' property of every element of 'Search > Links' collection as 'hrefs'`

### `When` `I save {value} custom property of every element of {playwrightLocator} collection as {value}`
Examples:
- `I save 'href' property of every element of 'Search > Links' collection as 'hrefs'`

### `When` `I save current url as {value}`
Examples:
- `I save current url as 'currentUrl'`

### `When` `I save page title as {value}`
Examples:
- `I save page title as 'currentTitle'`

### `When` `I save screenshot as {value}`
Examples:
- `I save screenshot as 'screenshot'`

### `When` `I save full page screenshot as {value}`
Examples:
- `I save full page screenshot as 'screenshot'`

### `When` `I save screenshot of {playwrightLocator} as {value}`
Examples:
- `I save screenshot of 'Header > Logo' as 'screenshot'`

### `When` `I save {value} css property of {playwrightLocator} as {value}`
Examples:
- `I save 'color' css property of 'Checkbox' as 'checkboxColor'`
- `I save '$propertyName' property of 'Checkbox' as 'checkboxColor'`

### `When` `I save bounding rect of {playwrightLocator} as {value}`
Examples:
- `* When I save bounding rect of 'Node' as 'boundingRect'`

## `steps-playwright/src/mock.ts`

### `When` `I create mock for {value} as {value}`
Examples:
- `When I create mock for '/yourservice/**' as 'mock1'`
- `When I create mock for '$mockUrlTemplate' as 'mock1'`

### `When` `I set {value} mock to respond {value} with:`
Examples:
- `* When I create mock for '/yourservice/**' as 'myServiceMock'`

### `When` `I set {value} mock to respond {value} with {string}`
Examples:
- `* When I create mock for '/yourservice/**' as 'myServiceMock'`

### `When` `I set {value} mock to abort with {value} reason`
Examples:
- `* When I create mock for '/yourservice/**' as 'myServiceMock'`

### `When` `I restore {value} mock`
Examples:
- `When I restore '$myServiceMock'`

### `When` `I restore all mocks`
Examples:
- `When I restore all mocks`

## `steps-playwright/src/mouseActions.ts`

### `When` `I press {playwrightMouseButton} mouse button`
Examples:
- `When I press left mouse button`

### `When` `I release {playwrightMouseButton} mouse button`
Examples:
- `When I release left mouse button`

### `When` `I move mouse to {value}`
Examples:
- `When I move mouse to '10, 15'`

### `When` `I scroll mouse wheel by {value}`
Examples:
- `When I scroll mouse wheel by '0, 15'`

## `steps-playwright/src/poDefine.ts`

### `When` `I define {value} as {value} locator`
Examples:
- `* When I define '#someId' as 'My Button' locator`

## `steps-playwright/src/validations.ts`

### `Then` `I expect {playwrightLocator} {playwrightCondition}`
Examples:
- `I expect 'Header' to be visible`
- `I expect 'Loading' not to be present`
- `I expect 'Search Bar > Submit Button' to be clickable`

### `Then` `I expect text of {playwrightLocator} {validation} {value}`
Examples:
- `I expect text of 'Search Results (1)' equals to 'google'`

### `Then` `I expect value of {playwrightLocator} {validation} {value}`
Examples:
- `I expect value of 'Search Input' to be equal 'text'`

### `Then` `I expect {value} property of {playwrightLocator} {validation} {value}`
Examples:
- `I expect 'value' property of 'Search Input' to be equal 'text'`
- `I expect 'innerHTML' property of 'Label' to contain '<b>'`

### `Then` `I expect {value} attribute of {playwrightLocator} {validation} {value}`
Examples:
- `I expect 'href' attribute of 'Home Link' to contain '/home'`

### `Then` `I expect {value} custom property of {playwrightLocator} {validation} {value}`
Examples:
- `I expect '$shadowText' custom property of 'Search Input' to be equal 'text'`
- `I expect '$js(node => node.shadowRoot.textContent)' custom property of 'Label' to contain '<b>'`

### `Then` `I expect current url {validation} {value}`
Examples:
- `I expect current url contains 'wikipedia'`
- `I expect current url equals 'https://wikipedia.org'`

### `Then` `I expect number of elements in {playwrightLocator} collection {validation} {value}`
Examples:
- `I expect number of elements in 'Search Results' collection to be equal '50'`
- `I expect number of elements in 'Search Results' collection to be above '49'`
- `I expect number of elements in 'Search Results' collection to be below '51'`

### `Then` `I expect page title {validation} {value}`
Examples:
- `I expect page title equals 'Wikipedia'`

### `Then` `I expect every element in {playwrightLocator} collection {playwrightCondition}`
Examples:
- `I expect every element in 'Header > Links' collection to be visible`
- `I expect every element in 'Loading Bars' collection not to be present`

### `Then` `I expect text of every element in {playwrightLocator} collection {validation} {value}`
Examples:
- `I expect text of every element in 'Search Results' collection equals to 'google'`
- `I expect text of every element in 'Search Results' collection does not contain 'google'`

### `Then` `I expect {value} attribute of every element in {playwrightLocator} collection {validation} {value}`
Examples:
- `I expect 'href' attribute of every element in 'Search Results' collection to contain 'google'`

### `Then` `I expect {value} property of every element in {playwrightLocator} collection {validation} {value}`
Examples:
- `I expect 'href' property of every element in 'Search Results' collection to contain 'google'`

### `Then` `I expect {value} custom property of every element in {playwrightLocator} collection {validation} {value}`
Examples:
- `I expect '$shadowText' custom property of every element in 'Search Results' collection to contain 'google'`

### `Then` `I expect {value} css property of {playwrightLocator} {validation} {value}`
Examples:
- `I expect 'color' css property of 'Search Input' to be equal 'rgb(42, 42, 42)'`
- `I expect 'font-family' css property of 'Label' to contain 'Fira'`

### `Then` `I expect {value} css property of every element in {playwrightLocator} collection {validation} {value}`
Examples:
- `I expect 'color' css property of every element in 'Table > Rows' collection to be equal 'rgb(42, 42, 42)'`
- `I expect 'font-family' css property of every element in 'Labels' to contain 'Fira'`

## `steps-playwright/src/waits.ts`

### `When` `I refresh page until {playwrightLocator} {playwrightCondition}( ){playwrightTimeout}`
Examples:
- `I refresh page until 'Internal Server Error Box' to be visible`
- `I refresh page until 'Submit Button' to be enabled`
- `I refresh page until 'Place Order Button' to be clickable (timeout: 3000)`

### `When` `I refresh page until text of {playwrightLocator} {validation} {value}( ){playwrightTimeout}`
Examples:
- `I refresh page until text of 'Order Status' to be equal 'Processing'`
- `I refresh page until text of 'Currency' not contain '$'`
- `I refresh page until text of 'My Salary' to match '/5\d{3,}/' (timeout: 3000)`

### `When` `I click {playwrightLocator} until text of {playwrightLocator} {validation} {value}( ){playwrightTimeout}`
Examples:
- `I click 'Send Message Button' until text of 'Information Alert' to be equal 'Your account has been banned'`
- `I click 'Add To Cart Button' until text of 'Shopping Cart Total' to match '/\$5\d{3,}/' (timeout: 3000)`

### `When` `I click {playwrightLocator} until value of {playwrightLocator} {validation} {value}( ){playwrightTimeout}`
Examples:
- `I click 'Plus Button' until value of 'Quantity Input' to be equal '9'`
- `I click 'Suggest Button' until value of 'Repository Name Input' to match '/\w{5,}/' (timeout: 30000)`

### `When` `I wait {int} ms`
Examples:
- `I wait 1000 ms`

### `When` `I wait for network idle {playwrightTimeout}`
Examples:
- `I wait for network idle (timeout: 1000)` — waits up to 1000 ms of network inactivity (required; omitting `(timeout: N)` leaves a dangling space and causes an undefined-step error)

