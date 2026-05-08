Feature: ToDo MVC — adding and managing todo items

  Background:
    Given I open '$todoUrl' url

  @smoke
  Scenario: Add a single todo
    When I type 'Buy milk' to 'TodoInput'
    And  I press 'Enter' key
    Then I expect element count of 'Todos collection' to be 1
    And  I expect text of '#1 of Todos' to equal 'Buy milk'
    And  I expect text of 'TodoCounter' to equal '1 item left'

  @smoke
  Scenario Outline: Add multiple todos and toggle completion
    When I type '<text>' to 'TodoInput'
    And  I press 'Enter' key
    Then I expect text of 'TodoByText (<text>) > Label' to equal '<text>'
    When I click 'TodoByText (<text>) > Toggle'
    Then I expect 'TodoByText (<text>)' to be in 'CompletedTodos collection'

    Examples:
      | text          |
      | Read book     |
      | Walk the dog  |

  Scenario: Soft assert several visual properties
    When I type 'Smoke' to 'TodoInput'
    And  I press 'Enter' key
    Then I expect 'Todos collection' to softly be visible
    And  I expect text of 'TodoCounter' to softly equal '1 item left'
    And  I expect 'ClearCompleted' to softly not be visible

  @api
  Scenario: Verify backing API in parallel with the UI flow
    When I send 'GET' request to '$apiBase/todos/1' and save response as 'r'
    And  I parse '$r' body as json
    Then I expect '$r.status' to equal '200'
    And  I expect '$r.payload.id' to equal '1'
