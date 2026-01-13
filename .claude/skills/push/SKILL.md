# /push - Quality Git Push Command

Push code changes to GitHub with intelligent commit message generation.

## Overview

This skill reviews the current git state, intelligently categorizes changes, generates quality commit messages, and pushes to GitHub when appropriate. It follows conventional commit format and project guidelines.

## What This Skill Does

1. **Reviews Git Status**: Checks current branch, staged/unstaged changes, and commit history
2. **Analyzes Changes**: Categorizes changes by type (fixes, features, docs, refactor, tests, etc.)
3. **Determines Push Viability**: Validates that changes are ready to push
4. **Generates Commit Message**: Creates descriptive, properly formatted commit messages
5. **Stages & Commits**: Intelligently stages appropriate files and commits
6. **Pushes to GitHub**: Pushes to remote repository with verification

## When to Use

- After completing a bug fix or feature
- When you need to push quality improvements or data fixes
- After adding new scripts or utilities
- When documentation has been updated
- After fixing pipeline issues or data quality problems

## How It Works

### 1. Git Status Review

Check the current state:
```bash
git status
git log -5 --oneline
git diff --stat
```

Identify:
- Current branch name
- Number of files changed
- Staged vs unstaged changes
- Recent commit history
- Untracked files

### 2. Change Categorization

Analyze changes to determine the primary category:

- **fix**: Bug fixes, data corrections, pipeline repairs
  - Example: Fixed schema validation error in personController
  - Example: Corrected missing name extraction

- **feat**: New features or capabilities
  - Example: Added comprehensive health check system
  - Example: New data backfill capabilities

- **docs**: Documentation updates
  - Example: Updated HEALTH_CHECK_REPORT.md
  - Example: Added API documentation

- **refactor**: Code improvements without behavior change
  - Example: Simplified extraction pipeline logic
  - Example: Improved query performance

- **test**: Test additions or updates
  - Example: Added tests for identity resolution

- **chore**: Maintenance tasks, dependency updates
  - Example: Updated npm packages
  - Example: Added new scripts to utilities

- **perf**: Performance improvements
  - Example: Optimized MongoDB aggregation queries

### 3. Commit Message Format

Follow conventional commit format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Subject Line Rules:**
- Use imperative mood ("Add" not "Added" or "Adds")
- No period at the end
- Keep under 72 characters
- Be specific and descriptive

**Body (optional):**
- Explain WHY, not WHAT (code shows what)
- Include context and reasoning
- Reference related issues if applicable

**Footer (optional):**
- Breaking changes: `BREAKING CHANGE: <description>`
- Issue references: `Fixes #123` or `Closes #456`
- Attribution: `Co-authored-by: Name <email>`

**Examples:**

```
fix(extraction): Correct schema validation error in person upsert

Phase 2 of observation processing was failing due to invalid enum value
being passed to merge reason. Changed from dynamic string interpolation
to hardcoded 'duplicate_detection' enum value.

Fixes #42
```

```
feat(health-check): Add comprehensive database health monitoring

Created new health-check system that reports on data completeness,
referential integrity, orphaned observations, and dead letter analysis.
Includes temporal analysis to detect recent vs historical issues.
```

```
docs: Update health check report with remediation results

Documented the successful fix of 313 missing names (99.4% success rate)
and verification that extraction pipeline is working correctly for new
data.
```

```
chore(scripts): Add data quality investigation utilities

Added 5 new scripts for investigating data completeness, comparing
visit vs scan quality, and analyzing missing field patterns.
```

### 4. File Staging Logic

**Always Stage:**
- Source code changes (`src/**/*.js`)
- Model updates (`src/models/*.js`)
- Controller changes (`src/controllers/*.js`)
- Documentation (`*.md`, `docs/**`)
- Configuration (`*.json`, `.env.example`)
- New scripts (`scripts/*.js`)
- Tests (`tests/**/*.test.js`)

**Never Stage:**
- Temporary files (`*.tmp`, `*.log`)
- Debug output files (`*.output`, `tmp/*`)
- Node modules (`node_modules/`)
- Environment files (`.env` with secrets)
- Claude task outputs (`/tmp/claude/**`)
- CSV data files (`*.csv`, unless explicitly needed)

**Skill Directory Changes:**
- Always stage skill directory changes (`.claude/skills/**`)
- These represent new capabilities and should be tracked

### 5. Push Decision Logic

**PROCEED with push when:**
- Changes are meaningful and complete
- All tests pass (run `npm test` if code changed)
- Commit message accurately describes changes
- No breaking changes without documentation
- No secrets in staged files

**DO NOT push when:**
- Tests are failing
- Breaking changes without proper documentation
- Secrets or credentials are staged
- Only temporary/debug files changed
- User explicitly says "don't push yet"

**ASK USER when:**
- Breaking changes detected (need confirmation)
- Large refactoring (>10 files)
- Unclear if changes are complete
- Multiple unrelated changes mixed together

### 6. Execution Steps

Execute in this order:

1. **Check current state:**
   ```bash
   git status
   git log -3 --oneline
   ```

2. **Analyze changes:**
   ```bash
   git diff --stat
   git diff --name-only
   ```

3. **Run tests (if code changed):**
   ```bash
   npm test
   ```

4. **Stage appropriate files:**
   ```bash
   # Example for fix scenario:
   git add src/controllers/personController.js
   git add scripts/re-extract-snapshots.js
   git add HEALTH_CHECK_REPORT.md
   ```

5. **Create commit with quality message:**
   ```bash
   git commit -m "fix(extraction): Correct schema validation error in person upsert

   Phase 2 of observation processing was failing due to invalid enum value
   being passed to merge reason. Changed from dynamic string interpolation
   to hardcoded 'duplicate_detection' enum value.

   Successfully re-extracted 313 people with 100% success rate."
   ```

6. **Push to remote:**
   ```bash
   git push origin <branch-name>
   ```

7. **Verify push:**
   ```bash
   git log origin/<branch-name> -1
   ```

### 7. Special Cases

**Multiple Related Changes:**
If changes span multiple categories but are related, choose the primary category:
- Fixed bug + added tests = `fix`
- New feature + documentation = `feat`
- Multiple fixes for same issue = single `fix` commit

**Skill Directory Updates:**
When adding/updating Claude skills:
```
chore(skills): Add /push command for quality git workflow

New skill automates git review, commit message generation, and pushing
to GitHub with proper conventional commit formatting.
```

**Data Quality Fixes:**
```
fix(data): Recover missing snapshot data for 313 people

Re-ran extraction pipeline using existing observation data. Fixed 99.4%
of people with missing names. Pipeline now verified working correctly.
```

**Breaking Changes:**
```
feat(api)!: Update webhook payload structure

BREAKING CHANGE: Webhook now requires 'salesNavId' field. Old format
with only 'profileUrl' is no longer supported. Update all webhook
sources to include stable identifiers.
```

## Error Handling

**Git Errors:**
- Merge conflicts: Report to user, don't auto-resolve
- Push rejected: Check if remote has new commits, suggest pull first
- Authentication failed: Remind user to check GitHub credentials

**Test Failures:**
- DO NOT commit if tests fail
- Report which tests failed
- Ask user if they want to fix before committing

**Validation Errors:**
- Check for secrets in staged files
- Warn about large files (>1MB)
- Detect `.env` files with actual secrets

## Output Format

Provide clear summary after push:

```
✓ Successfully pushed to GitHub

Branch: master
Commit: fix(extraction): Correct schema validation error in person upsert
Files changed: 3 files (+127, -42)
  - src/controllers/personController.js
  - scripts/re-extract-snapshots.js
  - HEALTH_CHECK_REPORT.md

Remote: https://github.com/user/duxsoup-etl/commit/<hash>
```

## Examples

### Example 1: Bug Fix + Scripts
```
User: /push
Assistant: Reviewing git status...

Found changes:
- src/controllers/personController.js (bug fix)
- scripts/re-extract-snapshots.js (new recovery script)
- HEALTH_CHECK_REPORT.md (updated docs)

This appears to be a bug fix with recovery tooling. Running tests...
Tests passed ✓

Staging files and creating commit:
Type: fix
Scope: extraction
Message: "Correct schema validation error in person upsert"

[Creates commit and pushes]
✓ Successfully pushed to master
```

### Example 2: New Feature
```
User: /push
Assistant: Reviewing git status...

Found changes:
- scripts/health-check-fixed.js (new script)
- scripts/investigate-*.js (5 new analysis tools)
- .claude/skills/check-health/ (new skill)

This is a new feature: comprehensive health check system.
Tests passed ✓

[Creates feat commit and pushes]
✓ Successfully pushed to master
```

### Example 3: Multiple Unrelated Changes
```
User: /push
Assistant: Reviewing git status...

Found changes:
- src/models/person.js (schema change)
- scripts/random-debug.js (debug script)
- README.md (docs update)
- .env (contains secrets!)

⚠️ Warning: Multiple unrelated changes detected
⚠️ Error: .env file contains secrets and should not be committed

Recommendations:
1. Create separate commits for person.js and README.md
2. Remove .env from staging
3. Delete debug script or add to .gitignore

Should I proceed with staging only person.js and README.md?
```

## Integration with Project

This skill follows the project's conventions defined in:
- `.claude/CLAUDE.md` - Architecture and patterns
- `.claude/rules/javascript.md` - Code quality standards
- `.claude/rules/testing.md` - Testing requirements

When code changes are detected, this skill MUST run tests before committing.

## Notes

- Always verify remote state before pushing
- Never force push to main/master without explicit user request
- Preserve commit history (avoid rebasing shared branches)
- Follow team's git workflow (if documented)
- Use `git push -u origin <branch>` for new branches
