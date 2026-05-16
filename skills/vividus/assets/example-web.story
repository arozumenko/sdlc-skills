Description: Web smoke — login flow against the demo site

Meta:
    @feature login
    @priority 1

Scenario: Sign in with valid credentials
Given I am on main application page
When I go to relative URL `/login`
When I enter `tomsmith` in field located by `id(username)`
When I enter `SuperSecretPassword!` in field located by `id(password)`
When I click on element located by `cssSelector(button[type='submit'])`
Then text `You logged into a secure area!` exists
Then page title is equal to `The Internet`

Scenario: Reject invalid password
Given I am on main application page
When I go to relative URL `/login`
When I enter `tomsmith` in field located by `id(username)`
When I enter `wrong` in field located by `id(password)`
When I click on element located by `cssSelector(button[type='submit'])`
Then text matches `Your password is invalid.*`

Scenario: Iterate over invalid usernames
Given I am on main application page
When I go to relative URL `/login`
When I enter `<user>` in field located by `id(username)`
When I enter `whatever` in field located by `id(password)`
When I click on element located by `cssSelector(button[type='submit'])`
Then text matches `Your (username|password) is invalid.*`
Examples:
|user      |
|nobody    |
|guest     |
|#{generate(Internet.username)}|
