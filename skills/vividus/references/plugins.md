# Vividus Plugin Catalog

The Vividus framework ships **47+ plugins** versioned together via the BOM (`org.vividus:vividus-bom:<version>`). Add the ones you need to `build.gradle`; the BOM picks the version automatically.

```gradle
dependencies {
    implementation platform('org.vividus:vividus-bom:0.6.18')
    implementation('org.vividus:vividus')
    implementation('org.vividus:vividus-plugin-<name>')
}
```

After adding a plugin, run `./gradlew build`, then `./gradlew printSteps --args="-f /tmp/steps.txt"` to dump every step the project now exposes.

Per-plugin reference: https://docs.vividus.dev/vividus/latest/plugins/plugin-<name>.html

---

## Web / UI

| Plugin | Purpose | When to pick |
|---|---|---|
| `vividus-plugin-web-app` | **Selenium** WebDriver-based web testing | Default web automation. Mature, full step library. |
| `vividus-plugin-web-app-playwright` | **Playwright**-based web testing | Faster, more deterministic for modern apps; smaller step surface than Selenium plugin. |
| `vividus-plugin-web-app-to-rest-api` | Browser proxy → REST API assertions | Validate XHR/fetch traffic from a browser session against API contracts. |
| `vividus-plugin-visual` | Screenshot diff (built-in) | Visual regression without a SaaS. |
| `vividus-plugin-applitools` | Applitools Eyes integration | Visual diff via SaaS with smart-diff. |
| `vividus-plugin-accessibility` | Axe-based a11y checks | Run WCAG/A11Y assertions on pages. |
| `vividus-plugin-lighthouse` | Lighthouse audits | Performance / SEO / a11y scoring. |
| `vividus-plugin-html` | Static HTML parsing/assertions | Parse HTML strings — independent of a browser. |

---

## Mobile / Desktop

| Plugin | Purpose |
|---|---|
| `vividus-plugin-mobile-app` | Appium-based iOS/Android/tvOS testing |
| `vividus-plugin-electron` | Electron desktop app testing |
| `vividus-plugin-mobitru` | Mobitru device cloud |
| `vividus-plugin-saucelabs` | Sauce Labs grid |
| `vividus-plugin-browserstack` | BrowserStack grid |
| `vividus-plugin-lambdatest` | LambdaTest grid |

---

## API & Protocols

| Plugin | Purpose |
|---|---|
| `vividus-plugin-rest-api` | HTTP / REST (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) |
| `vividus-plugin-websocket` | WebSocket client |
| `vividus-plugin-email` | IMAP/SMTP — assert on inbox / send |
| `vividus-plugin-ssh` | SSH command execution |
| `vividus-plugin-winrm` | Windows Remote Management |
| `vividus-plugin-shell` | Local shell execution |

---

## Data formats

| Plugin | Purpose |
|---|---|
| `vividus-plugin-json` | JSONPath assertions, schema validation, save by path |
| `vividus-plugin-xml` | XPath assertions on XML |
| `vividus-plugin-csv` | CSV parse + ExamplesTable transformer |
| `vividus-plugin-excel` | XLSX parse + ExamplesTable transformer |
| `vividus-plugin-yaml` | YAML parse |
| `vividus-plugin-html` | HTML DOM parse (jsoup-based) |
| `vividus-plugin-parquet` | Parquet file read |
| `vividus-plugin-avro` | Avro encode/decode |
| `vividus-plugin-datetime` | Date/time arithmetic & formatting steps |

---

## Databases

| Plugin | Purpose |
|---|---|
| `vividus-plugin-db` | Relational DB (JDBC) — Postgres, MySQL, MSSQL, Oracle, H2, etc. |
| `vividus-plugin-mongodb` | MongoDB query/assert |
| `vividus-plugin-redis` | Redis ops |

---

## Messaging

| Plugin | Purpose |
|---|---|
| `vividus-plugin-kafka` | Produce/consume Kafka topics |
| `vividus-plugin-rabbitmq` | RabbitMQ queues/exchanges |

(AWS/Azure native messaging covered below.)

---

## AWS

| Plugin | Service |
|---|---|
| `vividus-plugin-aws-dynamodb` | DynamoDB |
| `vividus-plugin-aws-kinesis` | Kinesis Data Streams |
| `vividus-plugin-aws-lambda` | Lambda invoke |
| `vividus-plugin-aws-s3` | S3 |
| `vividus-plugin-aws-secrets-manager` | Secrets Manager (used for secrets resolution) |

---

## Azure

| Plugin | Service |
|---|---|
| `vividus-plugin-azure-cosmos-db` | Cosmos DB |
| `vividus-plugin-azure-data-factory` | Data Factory pipeline ops |
| `vividus-plugin-azure-event-grid` | Event Grid |
| `vividus-plugin-azure-event-hub` | Event Hub |
| `vividus-plugin-azure-functions` | Functions invoke |
| `vividus-plugin-azure-resource-manager` | ARM operations |
| `vividus-plugin-azure-service-bus` | Service Bus |
| `vividus-plugin-azure-storage-account` | Blob/File storage |
| `vividus-plugin-azure-storage-queue` | Storage Queue |

---

## Other

| Artifact | Purpose |
|---|---|
| `vividus-mcp-server` | Bundled Model Context Protocol server for AI tooling integration. Launch via `./gradlew startMcpServer`. Doc: https://docs.vividus.dev/vividus/latest/user-guides/ai.html |

---

## Picking-by-task quick map

| Task | Add these plugins |
|---|---|
| Smoke-test a web app on Chrome | `vividus-plugin-web-app` |
| API contract testing | `vividus-plugin-rest-api`, `vividus-plugin-json` |
| Validate REST + DB consistency | `vividus-plugin-rest-api`, `vividus-plugin-json`, `vividus-plugin-db` |
| Mobile app on local Appium | `vividus-plugin-mobile-app` |
| Mobile app on BrowserStack | `vividus-plugin-mobile-app`, `vividus-plugin-browserstack` |
| Visual regression | `vividus-plugin-web-app`, `vividus-plugin-visual` |
| WCAG accessibility audit | `vividus-plugin-web-app`, `vividus-plugin-accessibility` |
| Performance audit | `vividus-plugin-web-app`, `vividus-plugin-lighthouse` |
| Kafka producer/consumer flow | `vividus-plugin-kafka` |
| AWS S3 upload then validate via API | `vividus-plugin-aws-s3`, `vividus-plugin-rest-api`, `vividus-plugin-json` |
| Read CSV to drive scenarios | `vividus-plugin-csv` (often already pulled by core) |
| Send email and check delivery | `vividus-plugin-email` |
| Test Electron desktop app | `vividus-plugin-electron` |
