# Specialist Skills Index

Maps check types to specialist skills. Use this to determine which `*-audit`
specialist skill files to load for a given audit. Load on demand — only the
ones the page or request needs. Each is a self-contained SKILL.md with its own
domain references.

## Check-Type → Skill Mapping

| Check Type | Skill to Load | Domain |
|---|---|---|
| accessibility | accessibility-audit | Accessibility ♿ |
| wcag | accessibility-audit | WCAG Compliance 📋 |
| security | security-audit | Security 🔒 |
| owasp | security-audit | OWASP 🔒 |
| privacy | privacy-audit | Privacy 🍪 |
| cookie-consent | privacy-audit | Cookie Consent 🍪 |
| gdpr | privacy-audit | GDPR 🇪🇺 |
| networking | performance-audit | Networking 📡 |
| performance | performance-audit | Performance 📡 |
| console-logs | performance-audit | Console 🖥️ |
| javascript | performance-audit | JavaScript ⚡ |
| mobile | responsive-audit | Mobile 📱 |
| content | content-seo-audit | Content ✍️ |
| ui-ux | ux-audit | UI/UX 🎨 |
| forms | ux-audit | Forms 🎨 |
| genai | ux-audit | GenAI 🤖 |
| error-messages | ux-audit | Error Messages ⚠️ |
| All page-type checks | ux-audit | Page-type UX |
| bug-reproduction | reproducing-issues | Bug Reproduction 🔍 |
| test-generation | test-generation | Test Generation 🧪 |

## Page-Type Checks (in ux-audit)

| Check Type | Domain |
|---|---|
| landing | Landing Pages 🚀 |
| homepage | Homepage 🏠 |
| pricing | Pricing 💰 |
| about | About ℹ️ |
| contact | Contact 📬 |
| signup | Signup 📝 |
| checkout | Checkout 💳 |
| shopping-cart | Shopping Cart 🛒 |
| product-details | Product Details 🛍️ |
| product-catalog | Product Catalog 📦 |
| search-box | Search 🔍 |
| search-results | Search Results 📊 |
| news | News 📰 |
| video | Video 🎥 |
| ai-chatbots | AI Chatbots 💬 |
| social-profiles | Social Profiles 👤 |
| social-feed | Social Feed 📱 |
| system-errors | System Errors 🔴 |
| legal | Legal ⚖️ |
| careers | Careers ⚠️ |

## Default Checks by Input Type

### URL / Web Page (always run)
- security → security-audit
- privacy → privacy-audit
- accessibility → accessibility-audit
- content → content-seo-audit
- networking → performance-audit

### URL / Web Page (conditionally, based on screenshot)
- ui-ux, forms → ux-audit
- mobile → responsive-audit
- Page-type checks → ux-audit (see page-types above)
- gdpr → privacy-audit
- owasp → security-audit
- wcag → accessibility-audit

### Code Snippets (always run)
- security → security-audit
- javascript → performance-audit
- genai → ux-audit
- accessibility (HTML/JSX) → accessibility-audit
- ui-ux (HTML/CSS) → ux-audit

## Cross-mode skills (not specialists)

These are loaded by the workflow's Mode Dispatch, not as audit specialists:

| Mode | Skill |
|---|---|
| Reproduce / Verify Fix | reproducing-issues |
| Research | deep-research |
| Test Generation | test-generation |
