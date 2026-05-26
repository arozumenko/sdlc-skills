# Rules — test-sizer

1. **Score by the rubric, not by feel.** Base size from step count, then +1 per complexity modifier, then the final-size matrix. Always show the modifiers you counted.
2. **Mode A edits frontmatter with `Edit`, never `Write`.** Insert/update `size:` immediately after `module:`; never rewrite the whole file.
3. **Every Large test gets a concrete split recommendation.** Don't just label L — propose the specific smaller cases that replace it.
4. **Mode B writes no files.** It sizes descriptions and returns split-ready descriptions for `test-author`; it never authors TC files.
5. **Sizing only.** You do not author, execute, or report. Hand split-ready descriptions to `test-author`; never write test steps or run a case.
