# /test-commit - TDD workflow: test, then commit

**Usage:** `/test-commit [test-path] [commit-message]`

**Description:** Runs tests and creates a git commit only if all tests pass. Enforces TDD discipline.

**Purpose:** Streamlines the test-driven development workflow mandated by project rules.

---

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - `test-path` (optional): specific test file or pattern (default: all tests)
   - `commit-message` (optional): commit message (if empty, will prompt)

2. **Execute workflow:**

   **Step 1: Run tests**
   - If test-path provided: `npm test -- <test-path>`
   - Otherwise: `npm test`
   - Capture output and exit code

   **Step 2: Analyze results**
   - If tests PASS:
     - Show passing test summary
     - Proceed to commit
   - If tests FAIL:
     - Show failures
     - STOP (do NOT commit)
     - Suggest fixes

   **Step 3: Git status**
   - Run `git status --short`
   - Show changed files
   - Confirm files to commit

   **Step 4: Commit (only if tests passed)**
   - If commit message provided: use it
   - Otherwise: ask user for commit message
   - Follow commit message format from CLAUDE.md
   - Add co-author attribution
   - Run `git commit` (respects hooks)

3. **Output format:**
   ```
   TEST & COMMIT WORKFLOW
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   📋 Step 1: Running tests...
   > npm test -- [test-path]

   [test output]

   ✓ Tests passed! ([X] tests, [Y] assertions)

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   📋 Step 2: Git status

   Modified files:
     M src/models/person.js
     M src/__tests__/person.test.js

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   📋 Step 3: Creating commit...

   ✓ Committed: [commit hash]

   Commit message:
   ─────────────────────────────────
   [commit message]

   🤖 Generated with Claude Code

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
   ─────────────────────────────────

   ✓ All done! Tests passed and changes committed.
   ```

4. **Failure handling:**
   ```
   TEST & COMMIT WORKFLOW
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   📋 Step 1: Running tests...
   > npm test

   [test output showing failures]

   ✗ Tests FAILED! ([X] failed)

   COMMIT BLOCKED - Fix tests first!

   Failed tests:
   • person.test.js:45 - should validate Sales Nav ID format
   • person.test.js:67 - should reject invalid canonical_id

   Suggested actions:
   1. Review test failures above
   2. Fix the code or tests
   3. Run /test-commit again
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

5. **Project rules compliance:**
   - MUST run tests before commit (from testing.md)
   - MUST use co-author attribution (from settings.json)
   - MUST follow commit message format
   - Respects git hooks (no --no-verify)

## Examples

```bash
/test-commit                                    # Run all tests, then commit
/test-commit src/__tests__/person.test.js       # Test specific file
/test-commit . "Fix: person identity validation" # With message
```

## Error Handling

- If no changes to commit: notify and exit gracefully
- If tests timeout: show output and suggest increasing timeout
- If git commit fails: show error and suggest resolution
