# steps-wdio — literal Gherkin step catalog

Auto-extracted from `https://github.com/qavajs/steps-wdio` source.

Total: **111 step definitions**

## `steps-wdio/src/actions.ts`

### `When` `I open {value} url`
Examples:
- `I open 'https://google.com'`

### `When` `I type {value} (in)to {wdioLocator}`
Examples:
- `I type 'wikipedia' to 'Google Input'`
- `I type 'wikipedia' into 'Google Input'`

### `When` `I type {value} chars (in)to {wdioLocator}`
Examples:
- `I type 'wikipedia' chars to 'Google Input'`
- `I type 'wikipedia' chars into 'Google Input'`

### `When` `I click {wdioLocator}`
Examples:
- `I click 'Google Button'`

### `When` `I double click {wdioLocator}`
Examples:
- `I double click 'Google Button'`

### `When` `I right click {wdioLocator}`
Examples:
- `I right click 'Google Button'`

### `When` `I force click {wdioLocator}`
Examples:
- `I force click 'Google Button'`

### `When` `I clear {wdioLocator}`
Examples:
- `I clear 'Google Input'`

### `When` `I click {value} text in {wdioLocator} collection`
Examples:
- `I click 'google' text in 'Search Engines' collection`

### `When` `I switch to parent frame`
Examples:
- `I switch to parent frame`

### `When` `I switch to {int} frame`
Examples:
- `I switch to 2 frame`

### `When` `I switch to {wdioLocator} frame`
Examples:
- `I switch to 'Checkout Iframe' frame`

### `When` `I switch to {int} window`
Examples:
- `I switch to 2 window`

### `When` `I switch to {value} window`
Examples:
- `I switch to 'google.com' window`

### `When` `I refresh page`
Examples:
- `I refresh page`

### `When` `I press {value} key(s)`
Examples:
- `I press 'Enter' key`
- `I press 'Ctrl+C' keys`

### `When` `I press {value} key(s) {int} time(s)`
Examples:
- `I press 'Enter' key 5 times`
- `I press 'Ctrl+V' keys 4 times`

### `When` `I select {value} option from {wdioLocator} dropdown`
Examples:
- `I select '1900' option from 'Registration Form > Date Of Birth'`
- `I select '$dateOfBirth' option from 'Registration Form > Date Of Birth' dropdown`

### `When` `I select {int}(st|nd|rd|th) option from {wdioLocator} dropdown`
Examples:
- `I select 1 option from 'Registration Form > Date Of Birth' dropdown`

### `When` `I scroll to {wdioLocator}`
Examples:
- `I scroll to 'Element'`

### `When` `I click {wdioBrowserButton} button`
Examples:
- `I click back button`
- `I click forward button`

### `When` `I scroll by {value}`
Examples:
- `* When I scroll by '0, 100'`

### `When` `I scroll by {value} in {wdioLocator}`
Examples:
- `* When I scroll by '0, 100' in 'Overflow Container'`

### `When` `I scroll until {wdioLocator} to be visible`
Examples:
- `* When I scroll until 'Row 99' becomes visible`

### `When` `I scroll in {wdioLocator} until {wdioLocator} to be visible`
Examples:
- `* When I scroll in 'List' until 'Row 99' to be visible`

### `When` `I upload {value} file to {wdioLocator}`
Examples:
- `I upload '/folder/file.txt' to 'File Input'`

### `When` `I drag and drop {wdioLocator} to {wdioLocator}`
Examples:
- `I drag and drop 'Bishop' to 'E4'`

### `When` `I open new tab`
Examples:
- `I open new tab`

### `When` `I click {value} coordinates in {wdioLocator}`
Examples:
- `When I click '0, 20' coordinates in 'Element'`
- `When I click '0, 20' coordinates in 'Element' (disable actionability wait)`

### `When` `I set window size {value}`
Examples:
- `I set window size '1366,768'`

### `When` `I close current tab`
Examples:
- `I close current tab`

## `steps-wdio/src/cookies.ts`

### `When` `I set {value} cookie as {value}`
Examples:
- `I set 'userID' cookie 'user1'`
- `I set 'userID' cookie '$userIdCookie'`

### `When` `I save value of {value} cookie as {value}`
Examples:
- `I save value of 'auth' cookie as 'authCookie'`

## `steps-wdio/src/dialog.ts`

### `When` `I will wait for alert/dialog`
Examples:
- `I will wait for dialog`

### `When` `I accept alert/dialog`
Examples:
- `I accept alert`

### `When` `I dismiss alert`
Examples:
- `I dismiss alert`

### `When` `I type {value} to alert`
Examples:
- `I type 'coffee' to alert`

### `Then` `I expect text of alert {validation} {value}`
Examples:
- `I expect text of alert does not contain 'coffee'`

## `steps-wdio/src/execute.ts`

### `When` `I execute {value} function/script`
Examples:
- `I execute '$fn' function // fn is function reference`
- `I execute 'window.scrollBy(0, 100)' function`

### `When` `I execute {value} function/script and save result as {value}`
Examples:
- `I execute '$fn' function and save result as 'result' // fn is function reference`
- `I execute 'window.scrollY' function and save result as 'scroll'`

### `When` `I execute {value} function/script on {wdioLocator}`
Examples:
- `I execute '$fn' function on 'Component > Element' // fn is function reference`
- `I execute 'arguments[0].scrollIntoView()' function on 'Component > Element'`

### `When` `I execute {value} function/script on {wdioLocator} and save result as {value}`
Examples:
- `I execute '$fn' function on 'Component > Element' and save result as 'innerText' // fn is function reference`
- `I execute 'arguments[0].innerText' function on 'Component > Element' and save result as 'innerText'`

## `steps-wdio/src/intercept.ts`

### `When` `I create interception for {value} as {value}`
Examples:
- `I create interception for '**\/api/qavajs' as 'intercept'`

### `When` `I wait for {value} response`
Examples:
- `I wait for '$interception' response`

### `When` `I save {value} response as {value}`
Examples:
- `* When I save '$interception' response as 'response'`

## `steps-wdio/src/keyboardActions.ts`

### `When` `I hold down {string} key`
Examples:
- `When I hold down 'Q' key`

### `When` `I release {string} key`
Examples:
- `When I release 'A' key`

## `steps-wdio/src/localSessionStorage.ts`

### `When` `I set {value} {word} storage value as {value}`
Examples:
- `I set 'username' local storage value as 'user1'`
- `I set '$sessionStorageKey' session storage value as '$sessionStorageValue'`

### `When` `I save value of {value} {word} storage as {value}`
Examples:
- `I save value of 'username' local storage as 'localStorageValue'`
- `I save value of '$sessionStorageKey' session storage value as 'sessionStorageValue'`

## `steps-wdio/src/memory.ts`

### `When` `I save text of {wdioLocator} as {value}`
Examples:
- `I save text of 'Search Result (1)' as 'firstSearchResult'`

### `When` `I save value of {wdioLocator} as {value}`
Examples:
- `I save text of 'Search Result (1)' as 'firstSearchResult'`

### `When` `I save {value} property of {wdioLocator} as {value}`
Examples:
- `I save 'checked' property of 'Checkbox' as 'checked'`
- `I save '$prop' property of 'Checkbox' as 'checked'`

### `When` `I save {value} attribute of {wdioLocator} as {value}`
Examples:
- `I save 'href' attribute of 'Link' as 'linkHref'`
- `I save '$prop' attribute of 'Link' as 'linkHref'`

### `When` `I save number of elements in {wdioLocator} collection as {value}`
Examples:
- `I save number of elements in 'Search Results' as 'numberOfSearchResults'`

### `When` `I save text of every element of {wdioLocator} collection as {value}`
Examples:
- `I save text of every element of 'Search Results' collection as 'searchResults'`

### `When` `I save {value} attribute of every element of {wdioLocator} collection as {value}`
Examples:
- `I save 'checked' attribute of every element of 'Search > Checkboxes' collection as 'checkboxes'`

### `When` `I save {value} property of every element of {wdioLocator} collection as {value}`
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

### `When` `I save screenshot of {wdioLocator} as {value}`
Examples:
- `I save screenshot of 'Header > Logo' as 'screenshot'`

### `When` `I save {value} css property of {wdioLocator} as {value}`
Examples:
- `I save 'color' css property of 'Checkbox' as 'checkboxColor'`
- `I save '$propertyName' property of 'Checkbox' as 'checkboxColor'`

### `When` `I save bounding rect of {wdioLocator} as {value}`
Examples:
- `* When I save bounding rect of 'Node' as 'boundingRect'`

### `When` `I save {value} custom property of {wdioLocator} as {value}`
Examples:
- `I save '$shadowText' custom property of 'Checkbox' as 'text'`
- `I save '$js(element => element.shadowRoot.textContent)' property of 'Checkbox' as 'text'`

### `When` `I save {value} custom property of every element of {wdioLocator} collection as {value}`
Examples:
- `I save 'href' property of every element of 'Search > Links' collection as 'hrefs'`

## `steps-wdio/src/mobile.ts`

### `When` `I tap {wdioLocator}`
Examples:
- `I tap 'Google Button'`

### `When` `I shake device`
Examples:
- `I shake device`

### `When` `I lock device`
Examples:
- `I lock device`

### `When` `I unlock device`
Examples:
- `I unlock device`

### `When` `I lock device for {int} sec`
Examples:
- `I lock device for 2 sec`

### `When` `I send sms to {value} with {value} message`
Examples:
- `I send sms to '5551234567' with 'some text' message`

### `When` `I call to {value}`
Examples:
- `I call to '5551234567'`

### `When` `I perform touch action:`
Examples:
- `* When I perform touch action:`

### `When` `I perform touch action {value}`
Examples:
- `* When I perform touch action '$actions'`

### `When` `I push {value} file as {value}`
Examples:
- `* When I push '$fileData' file as '/data/local/tmp/foo.bar'`

### `When` `I pull {value} file as {value}`
Examples:
- `* When I pull '/data/local/tmp/foo.bar' file as 'fileData'`

### `When` `I hide keyboard`
Examples:
- `* When I hide keyboard`

### `When` `I hide keyboard pressing {value}`
Examples:
- `* When I hide keyboard pressing 'Return'`

## `steps-wdio/src/mock.ts`

### `When` `I create mock for {value} as {value}`
Examples:
- `When I create mock for '/yourservice/**' as 'mock1'`
- `When I create mock for '$mockUrlTemplate' as 'mock1'`

### `When` `I set {value} mock to respond {value} with:`
Examples:
- `* When I create mock for '/yourservice/**' as 'myServiceMock'`

### `When` `I set {value} mock to respond {value} with {value}`
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

## `steps-wdio/src/mouseActions.ts`

### `When` `I hover over {wdioLocator}`
Examples:
- `I hover over 'Google Button'`

### `When` `I press {wdioMouseButton} mouse button`
Examples:
- `When I press left mouse button`

### `When` `I release {wdioMouseButton} mouse button`
Examples:
- `When I release left mouse button`

### `When` `I move mouse to {value}`
Examples:
- `When I move mouse to '10, 15'`

### `When` `I scroll mouse wheel by {value}`
Examples:
- `When I scroll mouse wheel by '0, 15'`

## `steps-wdio/src/poDefine.ts`

### `When` `I define {value} as {value} locator`
Examples:
- `* When I define '#someId' as 'My Button' locator`

## `steps-wdio/src/validations.ts`

### `Then` `I expect {wdioLocator} {wdioCondition}`
Examples:
- `I expect 'Header' to be visible`
- `I expect 'Loading' not to be present`
- `I expect 'Search Bar > Submit Button' to be clickable`

### `Then` `I expect text of {wdioLocator} {validation} {value}`
Examples:
- `I expect text of 'Search Result (1)' equals to 'google'`
- `I expect text of 'Search Result (2)' does not contain 'duckduckgo'`

### `Then` `I expect number of elements in {wdioLocator} collection {validation} {value}`
Examples:
- `I expect number of elements in 'Search Results' collection to be equal '50'`
- `I expect number of elements in 'Search Results' collection to be above '49'`
- `I expect number of elements in 'Search Results' collection to be below '51'`

### `Then` `I expect value of {wdioLocator} {validation} {value}`
Examples:
- `I expect value of 'Search Input' to be equal 'text'`
- `I expect value of 'Label' to contain '<b>'`

### `Then` `I expect {value} property of {wdioLocator} {validation} {value}`
Examples:
- `I expect 'value' property of 'Search Input' to be equal 'text'`
- `I expect 'innerHTML' property of 'Label' to contain '<b>'`

### `Then` `I expect {value} attribute of {wdioLocator} {validation} {value}`
Examples:
- `I expect 'href' attribute of 'Home Link' to contain '/home'`

### `Then` `I expect current url {validation} {value}`
Examples:
- `I expect current url contains 'wikipedia'`
- `I expect current url equals 'https://wikipedia.org'`

### `Then` `I expect page title {validation} {value}`
Examples:
- `I expect page title equals 'Wikipedia'`

### `Then` `I expect text of every element in {wdioLocator} collection {validation} {value}`
Examples:
- `I expect text of every element in 'Search Results' collection equals to 'google'`
- `I expect text of every element in 'Search Results' collection does not contain 'duckduckgo'`

### `Then` `I expect every element in {wdioLocator} collection {wdioCondition}`
Examples:
- `I expect every element in 'Header > Links' collection to be visible`
- `I expect every element in 'Loading Bars' collection not to be present`

### `Then` `I expect {value} attribute of every element in {wdioLocator} collection {validation} {value}`
Examples:
- `I expect 'href' attribute of every element in 'Search Results' collection to contain 'google'`

### `Then` `I expect {value} property of every element in {wdioLocator} collection {validation} {value}`
Examples:
- `I expect 'href' property of every element in 'Search Results' collection to contain 'google'`

### `Then` `I expect {value} css property of {wdioLocator} {validation} {value}`
Examples:
- `I expect 'color' css property of 'Search Input' to be equal 'rgb(42, 42, 42)'`
- `I expect 'font-family' css property of 'Label' to contain 'Fira'`

### `Then` `I expect {value} css property of every element in {wdioLocator} collection {validation} {value}`
Examples:
- `I expect 'color' css property of every element in 'Table > Rows' collection to be equal 'rgb(42, 42, 42)'`
- `I expect 'font-family' css property of every element in 'Labels' to contain 'Fira'`

### `Then` `I expect {value} custom property of {wdioLocator} {validation} {value}`
Examples:
- `I expect '$shadowText' custom property of 'Search Input' to be equal 'text'`
- `I expect '$js(element => element.shadowRoot.textContent)' custom property of 'Label' to contain 'text'`

### `Then` `I expect {value} custom property of every element in {wdioLocator} collection {validation} {value}`
Examples:
- `I expect 'color' custom property of every element in 'Table > Rows' collection to be equal 'text'`
- `I expect 'font-family' custom property of every element in 'Labels' to contain 'text'`

## `steps-wdio/src/waits.ts`

### `When` `I wait {int} ms`
Examples:
- `I wait 1000 ms`

### `When` `I refresh page until {wdioLocator} {wdioCondition}( ){wdioTimeout}`
Examples:
- `I refresh page until 'Internal Server Error Box' to be visible`
- `I refresh page until 'Submit Button' to be enabled`
- `I refresh page until 'Place Order Button' to be clickable (timeout: 3000)`

### `When` `I refresh page until text of {wdioLocator} {validation} {value}( ){wdioTimeout}`
Examples:
- `I refresh page until text of 'Order Status' to be equal 'Processing'`
- `I refresh page until text of 'Currency' not contain '$'`
- `I refresh page until text of 'My Salary' to match '/5\d{3,}/' (timeout: 3000)`

### `When` `I click {wdioLocator} until text of {wdioLocator} {validation} {value}( ){wdioTimeout}`
Examples:
- `I click 'Send Message Button' until text of 'Information Alert' to be equal 'Your account has been banned'`
- `I click 'Add To Cart Button' until text of 'Shopping Cart Total' to match '/\$5\d{3,}/' (timeout: 3000)`

### `When` `I click {wdioLocator} until value of {wdioLocator} {validation} {value}( ){wdioTimeout}`
Examples:
- `I click 'Plus Button' until value of 'Quantity Input' to be equal '9'`
- `I click 'Suggest Button' until value of 'Repository Name Input' to match '/\w{5,}/' (timeout: 30000)`

