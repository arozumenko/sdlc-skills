!-- Visual regression story template.
!-- Prerequisites:
!--   1. build.gradle:  implementation('org.vividus:vividus-plugin-visual')
!--   2. profile.properties: ui.visual.acceptable-diff-percentage=2
!--   3. src/main/resources/baselines/.gitkeep  (folder must exist as classpath resource)
!--   4. suite.properties: batch-1.variables.visualAction=ESTABLISH
!--
!-- First run (ESTABLISH): creates baseline PNGs under output/resources/main/baselines/
!--   Copy them to src/main/resources/baselines/ and commit.
!--
!-- Regression run (COMPARE_AGAINST):
!--   ./gradlew runStories -Pvividus."batch-1.variables.visualAction"=COMPARE_AGAINST

Description: Visual regression — key pages

Meta:
    @feature visual
    @priority 2

Lifecycle:
Before:
Scope: SCENARIO
When I change window size to `1440x900`

Scenario: Home page visual check
Given I am on main application page
When I ${visualAction} baseline with name `home` ignoring:
|ELEMENT                  |
|cssSelector(.cookie-banner, .hero-carousel)|

Scenario: About page visual check
Given I am on main application page
When I go to relative URL `/about`
When I ${visualAction} baseline with name `about` ignoring:
|ELEMENT                  |
|cssSelector(.cookie-banner)|

!-- To add more pages: copy a Scenario block, change the URL and baseline name.
!-- To ignore multiple dynamic areas in one check, combine CSS selectors:
!--   cssSelector(.cookie-banner, .live-chat, .countdown-timer)
