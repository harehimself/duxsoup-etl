Run tests and provide analysis of results.

**Usage**: `/run-tests [file-path-or-pattern]`

## Steps

1. **Determine scope** from `$ARGUMENTS`:
   - If a specific file path is given: run `npm test -- <path>`
   - If a pattern like "identity" or "person" is given: find matching test files with Glob `**/__tests__/**/*<pattern>*.test.js` and run them
   - If empty: run `npm test` (full unit suite)

2. **Run the tests** using Bash with a 120-second timeout.

3. **Analyze results**:
   - Total tests: passed / failed / skipped
   - If failures exist:
     - List each failing test with its `describe` → `it` path
     - Show the assertion error (expected vs received)
     - Identify the source file and line number
     - Suggest likely root cause based on the test name and error

4. **Cross-reference** failing tests against recent git changes:
   - Run `git diff --name-only HEAD~3` to see recently changed files
   - Flag if any failing test corresponds to a recently modified file

## Output Format

```
Test Results: X passed, Y failed, Z skipped (Xs)

[If failures:]
FAILURES:
1. <describe> › <it>
   File: <test-file>:<line>
   Error: Expected <X> but received <Y>
   Likely cause: <analysis>
   Related changes: <recently modified file, if any>
```

If all tests pass, confirm with a brief summary and the total run time.
