# cicd.md — running qavajs in CI/CD

qavajs is CI-agnostic. The pipeline contract is dead-simple: provide Node ≥ 20 and a browser if doing UI tests, run `npm test`, publish JUnit / Allure / HTML artifacts.

Source of truth: <https://qavajs.github.io/docs/Guides/cicd>

## Pipeline contract

1. Check out source
2. `npm install` (or `npm ci` for lock-fidelity)
3. Install browser binaries (UI runs only — see runner-specific notes)
4. Set environment vars: `BASE_URL`, secrets, etc.
5. `npm test` (or `npx qavajs run --config config.ts --profile ci`)
6. Upload `report/junit-report.xml`, `report/report.html`, `allure-results/`, `traces/`, `video/` as artifacts
7. Surface JUnit results for in-pipeline test reporting

## GitHub Actions

```yaml
# .github/workflows/qavajs.yml
name: qavajs E2E
on:
  push: { branches: [main] }
  pull_request:
  workflow_dispatch:

jobs:
  e2e:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1, 2, 3, 4]      # split work across 4 nodes
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - run: npm ci

      # Playwright runner — install pinned browsers
      - run: npx playwright install --with-deps chromium

      # OR for steps-wdio: install Chrome
      # - run: |
      #     sudo apt-get update
      #     sudo apt-get install -y google-chrome-stable

      - name: Run qavajs (shard ${{ matrix.shard }}/4)
        env:
          BASE_URL: ${{ secrets.BASE_URL }}
          API_BASE: ${{ secrets.API_BASE }}
        run: >
          npx qavajs run --config config.ts --profile ci
          --shard ${{ matrix.shard }}/4
          --parallel 4

      - name: Upload artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qavajs-shard-${{ matrix.shard }}
          path: |
            report/
            allure-results/
            traces/
            video/

  publish-allure:
    needs: e2e
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { pattern: 'qavajs-shard-*', merge-multiple: true }
      - run: |
          npx -y allure-commandline generate allure-results -o allure-report --clean
      - uses: actions/upload-artifact@v4
        with:
          name: allure-report
          path: allure-report
```

Notes:
- `--shard x/y` pairs naturally with a matrix.
- `--parallel N` runs N workers within each shard.
- `--retry 1 --retry-tag-filter '@flaky'` retries only quarantined scenarios.
- For PR feedback, add a `dorny/test-reporter@v1` step to convert JUnit into PR check annotations.

## GitLab CI

```yaml
# .gitlab-ci.yml
stages: [test, report]

variables:
  npm_config_cache: "$CI_PROJECT_DIR/.npm"

cache:
  paths: [.npm/, node_modules/]

e2e:
  stage: test
  image: mcr.microsoft.com/playwright:v1.49.0-noble   # use the version you depend on
  parallel: 4
  variables:
    BASE_URL: "$BASE_URL"
  script:
    - npm ci
    - >
      npx qavajs run --config config.ts --profile ci
      --shard $CI_NODE_INDEX/$CI_NODE_TOTAL
      --parallel 4
  artifacts:
    when: always
    reports:
      junit: report/junit-report.xml
    paths:
      - report/
      - allure-results/
      - traces/
      - video/
    expire_in: 1 week
```

## Azure DevOps

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include: [main]

pool:
  vmImage: 'ubuntu-latest'

strategy:
  matrix:
    shard1: { SHARD: 1 }
    shard2: { SHARD: 2 }
    shard3: { SHARD: 3 }
    shard4: { SHARD: 4 }

steps:
  - task: NodeTool@0
    inputs: { versionSpec: '22.x' }

  - script: npm ci
    displayName: 'Install deps'

  - script: npx playwright install --with-deps chromium
    displayName: 'Install browsers'

  - script: >
      npx qavajs run --config config.ts --profile ci
      --shard $(SHARD)/4
      --parallel 4
    displayName: 'Run qavajs'
    env:
      BASE_URL: $(BASE_URL)

  - task: PublishTestResults@2
    condition: succeededOrFailed()
    inputs:
      testResultsFormat: 'JUnit'
      testResultsFiles: 'report/junit-report.xml'
      mergeTestResults: true
      failTaskOnFailedTests: true

  - task: PublishBuildArtifacts@1
    condition: succeededOrFailed()
    inputs:
      pathToPublish: report
      artifactName: 'qavajs-shard-$(SHARD)'
```

## Jenkins (Declarative)

```groovy
pipeline {
  agent {
    docker {
      image 'mcr.microsoft.com/playwright:v1.49.0-noble'
      args  '-u root'
    }
  }

  environment {
    BASE_URL = credentials('qa-base-url')
  }

  stages {
    stage('Install') {
      steps { sh 'npm ci' }
    }

    stage('Test (sharded)') {
      matrix {
        axes { axis { name 'SHARD'; values '1', '2', '3', '4' } }
        stages {
          stage('Run shard') {
            steps {
              sh """
                npx qavajs run --config config.ts --profile ci \
                  --shard ${SHARD}/4 \
                  --parallel 4
              """
            }
            post {
              always {
                junit 'report/junit-report.xml'
                archiveArtifacts artifacts: 'report/**, allure-results/**, traces/**, video/**',
                                 allowEmptyArchive: true
              }
            }
          }
        }
      }
    }
  }
}
```

## Common CI patterns

### `--memory-values` for environment overrides

Avoid baking URLs into config:

```bash
npx qavajs run --config config.ts \
  --memory-values "$(cat <<JSON
{ "baseUrl": "$BASE_URL", "apiBase": "$API_BASE" }
JSON
)"
```

### `--no-error-exit` for full reports on failure

Without it, the upload-artifact step skips on non-zero exit. Use it together with `--retry` and a downstream JUnit publish step.

### Cache strategy

- npm cache: bind-mount `~/.npm` (or `actions/setup-node@v4` cache).
- Playwright browsers: cache `~/.cache/ms-playwright` (saves ~5 min per run).
- Allure CLI: cache `~/.allure` if you generate reports per shard.

### Headless/visible

Always headless in CI. Local dev uses the default (visible) profile; CI selects `--profile headless`. Spread inheritance keeps the diff minimal.

## Live links

- Docs (with examples for GitHub Actions, GitLab, Azure, Jenkins): <https://qavajs.github.io/docs/Guides/cicd>
- Allure publishing: <https://github.com/allure-framework/allure-actions> (GitHub) or vendor equivalents
- Playwright Docker images: <https://playwright.dev/docs/docker>
