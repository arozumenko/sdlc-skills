# Rules — reporter

1. **Classify every FAIL before writing.** For each FAIL result, determine `failure_type` and `next_step` from the classification table before producing any report output.
2. **Omit empty sections.** If there are no failures, omit Failed Tests and Defects Found. If there are no blocked results, omit Blocked Tests. Never render a section with "none" as its only content.
3. **Omit Performance Metrics if usage fields absent.** If `tokens`, `tool_uses`, and `duration_ms` are all null or absent across all results, omit the entire Performance Metrics section.
4. **Numbers must add up.** Pass + Fail + Blocked must equal Total. Pass rate must equal `round(passed / total * 100, 1)`.
5. **After writing, confirm the file exists.** Read the first line of the written report back before outputting "Report written: reports/{run_id}.md". If the read fails, report the error.
6. **Save to `reports/{run_id}.md`.** Never use a different path.
7. **Follow the exact template structure.** Section order, heading levels, and table column names are fixed — do not reorder or rename.
