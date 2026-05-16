# recipes.md — common qavajs patterns, ready to adapt

These are paste-and-adjust scenarios for the most common UI / API / test-management tasks. They use steps that **actually exist** in the upstream packages — verify against the relevant `references/steps-*.md` if anything looks off.

## UI — log in via locators and memory

```gherkin
Feature: Auth
  Background:
    Given I open '$baseUrl' url

  Scenario: Successful login
    When I type '$user.username' to 'Login Form > Username'
    And  I type '$user.password' to 'Login Form > Password'
    And  I click 'Login Form > Submit'
    Then I expect 'Header > Avatar' to be visible
    And  I expect text of 'Header > Username' to equal '$user.username'
```

Where `user` is supplied by a memory map (see [`memory.md`](memory.md)).

## UI — collection assertions

```gherkin
Scenario: Cart shows 3 items
  Given I open '$cartUrl' url
  Then I expect element count of 'Cart Items collection' to be 3
  And  I expect text of '#1 of Cart Items > Name' to equal '$lastAdded.name'
  And  I expect every element in 'Cart Items collection' to be visible
```

## UI — file upload

```gherkin
Scenario: Upload an avatar
  Given I open '$baseUrl/profile' url
  When I upload '$file("fixtures/avatar.png")' file to 'Profile > Avatar Input'
  And  I click 'Profile > Save Button'
  Then I expect 'Profile > Avatar Preview' to be visible
```

## UI — switch frame / iframe (Playwright)

Define the frame as a native locator in your page object:

```typescript
import { locator, NativeSelector } from '@qavajs/steps-playwright/po';

class CheckoutPage {
    PaymentFrame = locator(NativeSelector((_, parent) => parent.frameLocator('#payment')));
    CardNumber  = locator(NativeSelector((_, parent) => parent.frameLocator('#payment').locator('#card')));
}
```

Then operate as normal: `When I type '$card.number' to 'Card Number'`.

## UI — waiting on dynamic content (polling)

```gherkin
Scenario: Background job completes
  Given I trigger 'job-1234'
  When I refresh page until 'Job > Status' to have text 'completed'
  Then I expect text of 'Job > Result' to contain 'success'
```

The `I refresh page until …` step polls using `browser.timeout.pageRefreshInterval`.

## UI — mock an XHR response (Playwright)

```gherkin
Scenario: Empty cart state
  Given I create mock for '$apiBase/cart' as 'cartMock'
  And   I set 'cartMock' mock to respond '200' with:
        """
        { "items": [] }
        """
  When  I open '$baseUrl/cart' url
  Then  I expect text of 'Cart > Empty State' to equal 'Your cart is empty'
  And   I restore all mocks
```

## UI — soft assertions for a form audit

```gherkin
Scenario: Login form looks right
  Given I open '$baseUrl/login' url
  Then I expect 'Logo' to be visible
  And  I expect text of 'Title' to softly equal 'Sign in'
  And  I expect 'Username Input' to softly be enabled
  And  I expect 'Password Input' to softly be enabled
  And  I expect 'Submit Button' to softly be visible
  And  I expect 'Submit Button' to softly be disabled
```

## API — JSON happy path

```gherkin
Scenario: GET a known resource
  When I send "GET" request to "$BASE/users/1" and save response as "r"
  And  I parse "$r" body as json
  Then I expect "$r.status" to equal "200"
  And  I expect "$r.payload.id" to equal "1"
  And  I expect "$r.payload.email" to match "@.+\\..+"
```

## API — auth + builder

```gherkin
Background:
  Given I create "POST" request "auth"
  And   I add "$BASE/auth/token" url to "$auth"
  And   I add body to "$auth":
        """
        { "user": "$apiUser.username", "pass": "$apiUser.password" }
        """
  When  I send "$auth" request and save response as "tokenRes"
  And   I parse "$tokenRes" body as json
  And   I save "$tokenRes.payload.token" to memory as "token"

Scenario: Authenticated GET
  Given I create "GET" request "req"
  And   I add "$BASE/me" url to "$req"
  And   I add headers to "$req":
        | Authorization | Bearer $token |
  When  I send "$req" request and save response as "r"
  And   I parse "$r" body as json
  Then  I expect "$r.status" to equal "200"
```

## Data — drive scenarios from a table

```gherkin
Scenario Outline: Search returns the title
  Given I open '$wikipediaUrl' url
  When I type '<term>' to 'Wikipedia > Search Input'
  And  I click 'Wikipedia > Search Button'
  Then I expect text of 'Wikipedia Article > Title' to equal '<term>'

  Examples:
    | term       |
    | JavaScript |
    | Java       |
    | TypeScript |
```

## Test composition — login via fixture

```typescript
// hooks.ts
import { Fixture } from '@qavajs/core';

Fixture({ name: 'auth', tags: '@authed' }, async function () {
    await this.executeStep(`I open '$baseUrl/login' url`);
    await this.executeStep(`I type '$user.username' to 'Login > Username'`);
    await this.executeStep(`I type '$user.password' to 'Login > Password'`);
    await this.executeStep(`I click 'Login > Submit'`);
});
```

```gherkin
@authed
Scenario: Profile loads
  Given I open '$baseUrl/profile' url
  Then I expect 'Profile > Avatar' to be visible
```

## Custom step that reuses existing ones

```typescript
import { When, IQavajsWorld } from '@qavajs/core';

When('I add {string} to cart', async function (this: IQavajsWorld, productName: string) {
    await this.executeStep(`I click 'Product (${productName}) > Add to Cart'`);
    await this.executeStep(`I expect 'Cart Badge' to be visible`);
});
```

## Live links

- Demos directory (every recipe has a richer demo): <https://github.com/qavajs/demo>
- Docs — writing tests: <https://qavajs.github.io/docs/Commons/writing-tests>
