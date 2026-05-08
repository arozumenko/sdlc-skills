# steps-gmail — literal Gherkin step catalog

Auto-extracted from `https://github.com/qavajs/steps-gmail` source.

Total: **4 step definitions**

## `steps-gmail/src/gmail.ts`

### `When` `I log in to gmail as {value}`
Examples:
- `* When I log in to gmail as '$gmailUser'`

### `When` `I wait email matching {value}`
Examples:
- `* When I wait email matching 'subject:some subject'`

### `When` `I save email matching {value} as {value}`
Examples:
- `* When I save email matching 'subject:some subject' as 'email'`

### `When` `I {gmailAction} {string} label to email(s) matching {value}`
Examples:
- `* When I remove "UNREAD" label to email matching 'is:unread'`

