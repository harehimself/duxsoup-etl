Generate release notes from commits since the last tag or a given reference point.

**Usage**: `/release-notes [since-ref]` — defaults to last git tag, or last 7 days if no tags exist.

## Steps

1. **Find reference point**:
   - If `$ARGUMENTS` is given, use it as the since-ref (tag, commit SHA, or date)
   - Otherwise, find the latest git tag. If no tags, use 7 days ago.

2. **List commits**: Use `mcp__github__list_commits` on master since the reference point.

3. **Categorize each commit** by its message and files changed:
   - **Features**: New capabilities, new endpoints, new fields
   - **Bug Fixes**: Corrections to existing behavior
   - **Data Operations**: Migrations, backfills, rebuilds, deduplication
   - **Infrastructure**: CI/CD, deployment, configuration, dependencies
   - **Documentation**: Docs, backlog, comments

4. **Read the current BACKLOG.md** to cross-reference completed items with these commits.

5. **Generate release notes** in markdown format.

## Output Format

```markdown
## Release Notes — <date range>

### Features
- <commit message> (<sha-short>)

### Bug Fixes
- <commit message> (<sha-short>)

### Data Operations
- <commit message> (<sha-short>)

### Infrastructure
- <commit message> (<sha-short>)

### Documentation
- <commit message> (<sha-short>)

---
<X> commits | <Y> PRs merged | <Z> backlog items completed
```

After generating, ask if the user wants to update BACKLOG.md's completed section with any missing entries.
