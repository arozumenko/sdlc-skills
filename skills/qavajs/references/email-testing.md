# email-testing.md — `@qavajs/steps-gmail` for verifying delivered email

Polls a Gmail inbox via the Gmail API + Google OAuth, then exposes the matching message as a `mailparser` object. Use it to verify "an email was sent" or to extract a magic-link / verification code from a real inbox in CI.

Source of truth: <https://qavajs.github.io/docs/Steps/gmail>, <https://github.com/qavajs/steps-gmail>

## Installation

```bash
npm install @qavajs/steps-gmail
```

## Configuration

```typescript
export default {
    require: ['node_modules/@qavajs/steps-gmail/index.js'],
    gmail: {
        timeout:  30_000, // total ms to wait for a matching email
        interval:  5_000, // ms between polls
    },
};
```

## OAuth credentials

The login step expects a memory variable resolving to a `google.auth.fromJSON` payload:

```json
{
    "type": "authorized_user",
    "client_id": "1234567890-abc.apps.googleusercontent.com",
    "client_secret": "...",
    "refresh_token": "..."
}
```

Source these from a Google Cloud OAuth client (Desktop app) that you've granted `gmail.readonly` to. **Don't commit these secrets** — load them in your `Memory` class from `process.env` or a sealed secret file:

```typescript
// memory/index.ts
export class Constants {
    gmailUser = {
        type: 'authorized_user',
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    };
}
```

## Steps (4 total)

```gherkin
When I log in to gmail as '$gmailUser'
When I wait email matching 'subject:"Welcome to QA app" newer_than:1h'
When I save email matching 'subject:"verify your email" from:no-reply@app.example.com' as 'email'
```

(Plus internal cleanup the package handles automatically on scenario end.)

The query string uses the standard [Gmail advanced-search syntax](https://support.google.com/mail/answer/7190) — `from:`, `subject:`, `newer_than:Nh`, `has:attachment`, etc.

The saved object is a [mailparser parsed message](https://nodemailer.com/extras/mailparser/):

| Property | What it is |
|---|---|
| `email.subject` | string |
| `email.from.value[0].address` | string |
| `email.to.value` | array of `{ address, name }` |
| `email.text` | plain-text body |
| `email.html` | HTML body |
| `email.attachments` | array of `{ filename, content, contentType }` |
| `email.date` | `Date` |
| `email.messageId` | string |

## Common shapes

### Verification email containing a one-time code

```gherkin
Scenario: Sign-up sends a verification code
  When I sign up with email '$candidateEmail'
  And  I log in to gmail as '$gmailUser'
  And  I wait email matching 'subject:"Verify your email" to:$candidateEmail newer_than:5m'
  And  I save email matching 'subject:"Verify your email" to:$candidateEmail newer_than:5m' as 'verifyMail'
  And  I save '$js($verifyMail.text.match(/code:\\s*(\\d{6})/)[1])' to memory as 'code'
  When I open '$baseUrl/verify' url
  And  I type '$code' to 'Verify Form > Code'
  And  I click 'Verify Form > Submit'
  Then I expect text of 'Header > Status' to equal 'Verified'
```

### Magic-link login

```gherkin
Scenario: Passwordless login
  When I trigger 'send magic link' for '$candidateEmail'
  And  I log in to gmail as '$gmailUser'
  And  I save email matching 'subject:"Sign in to QA app" to:$candidateEmail newer_than:5m' as 'mail'
  And  I save '$js($mail.html.match(/href="(https:\\/\\/[^"]+\\/auth\\/[^"]+)"/)[1])' to memory as 'loginLink'
  When I open '$loginLink' url
  Then I expect 'Header > Avatar' to be visible
```

### Verify the email reached the right addresses

```gherkin
When I save email matching 'subject:"Order confirmation" newer_than:5m' as 'mail'
Then I expect '$mail.from.value[0].address' to equal '$expectedSender'
And  I expect '$mail.to.value' to have length '1'
And  I expect '$mail.to.value[0].address' to equal '$candidateEmail'
And  I expect '$mail.attachments' to have length '1'
And  I expect '$mail.attachments[0].filename' to match 'invoice-\\d+\\.pdf'
```

## Caveats

- **The poll lives on the cucumber worker.** With `--parallel N`, each worker polls the same inbox; rate limits apply. Use a per-worker email alias (`qa+w0@...`, `qa+w1@...`) via `parallel(...)` from `@qavajs/memory/utils` and tighten the search with `to:` filters.
- **Multiple matches → first one only.** `I save email matching ...` saves the first hit. If you need them all, write a custom step that calls `gmail.list` with the same query.
- **The OAuth token must be `authorized_user` type, not service-account.** Gmail API rejects service accounts unless the inbox is delegated.
- **`gmail.readonly` is enough for these steps.** Don't grant write/send scopes — they aren't used and increase blast radius if leaked.
- **For non-Gmail providers, this package won't help.** Use an SMTP-trap service (mailpit, mailhog, mailtrap) and write a small custom step set against its API.

## Live links

- Step catalog: [`steps-gmail.md`](steps-gmail.md)
- Source: <https://github.com/qavajs/steps-gmail>
- Docs: <https://qavajs.github.io/docs/Steps/gmail>
- Mailparser API: <https://nodemailer.com/extras/mailparser/>
- Gmail search syntax: <https://support.google.com/mail/answer/7190>
