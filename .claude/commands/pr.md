Create a pull request for the current branch following this project's conventions.

## Steps

1. **Gather context**:
   - Run `git status` to see all changes (staged + unstaged + untracked)
   - Run `git diff --stat` to see change summary
   - Run `git log --oneline origin/master..HEAD` to see commits on this branch
   - Run `git diff origin/master...HEAD` to see the full diff against master

2. **Run tests**: Execute `npm test` to ensure all tests pass before creating PR.
   - If tests fail, report failures and stop. Do not create the PR.

3. **Analyze changes** across ALL commits (not just the latest):
   - Categorize: bug fix, feature, refactor, ops, docs
   - Identify affected systems: identity resolution, webhook processing, snapshots, API, scripts, tests
   - Note any schema changes, new dependencies, or migration needs

4. **Draft PR**:
   - Title: Short imperative (<70 chars), e.g., "fix: tighten Sales Nav ID regex validation"
   - Body follows this template:

```markdown
## Summary
- <1-3 bullet points describing what and why>

## Changes
- <list of key changes by file/component>

## Testing
- <what tests were added/modified>
- <test results summary>

## Checklist
- [ ] Tests pass (`npm test`)
- [ ] No new lint warnings
- [ ] Backlog updated (if applicable)
- [ ] Docs updated (if schema changed)
```

5. **Create PR** using `gh pr create` with the drafted title and body.

## Output

Return the PR URL when complete.
