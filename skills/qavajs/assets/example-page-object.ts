// example-page-object.ts — root App and a few component classes.
// Imports come from `@qavajs/steps-playwright/po`. For WDIO, swap the import to
// `@qavajs/steps-wdio/po`; the rest is identical.
//
// @ts-nocheck — this is a copy-paste template; types resolve once `@qavajs/steps-playwright`
// is installed in the host project.

import { locator } from '@qavajs/steps-playwright/po';

class TodoItem {
    Label  = locator('label');
    Toggle = locator('input.toggle');
    Delete = locator('button.destroy');
}

class CompletedTodo {
    selector = 'li.completed';
    Label    = locator('label');
}

export class App {
    // Simple element by CSS
    TodoInput        = locator('.new-todo');
    TodoCounter      = locator('.todo-count');
    ClearCompleted   = locator('.clear-completed');

    // Collection (used by `Todos collection`, `#1 of Todos`)
    Todos            = locator('.todo-list li');
    CompletedTodos   = locator('.todo-list li.completed').as(CompletedTodo);

    // Templated locators — `'TodoByIndex (3)'` and `'TodoByText (Buy milk) > Toggle'`
    TodoByIndex = locator.template((i) => `.todo-list li:nth-child(${i})`).as(TodoItem);
    TodoByText  = locator.template((t) => `.todo-list li:has-text("${t}")`).as(TodoItem);

    // Filters (link bar)
    ActiveFilter    = locator('a[href*="active"]');
    CompletedFilter = locator('a[href*="completed"]');
    AllFilter       = locator('a[href$="#/"]');
}
