# /push - Quality Git Push Command

Push code changes to GitHub using a **pull → rebase → commit → push** workflow designed for safe, clean collaboration in multi-developer repositories.

---

## Overview

This skill enforces a disciplined Git workflow that:
- Syncs with remote before committing
- Prevents accidental divergence or rejected pushes
- Produces clean, conventional commit history
- Is safe for solo *and* multi-contributor projects

---

## What This Skill Does

1. **Fetches & Syncs with Remote** (mandatory)
2. **Reviews Git Status**: Branch, staged/unstaged changes, history
3. **Analyzes Changes**: Categorizes by type (fix, feat, docs, etc.)
4. **Determines Push Viability**: Guards against unsafe pushes
5. **Generates Commit Message**: Conventional, high-quality commits
6. **Stages & Commits**: One logical change per commit
7. **Pushes to GitHub**: With verification

---

## Branch Safety Rules (Hard Requirements)

- ❌ Never push directly to `main` / `master`
- ✅ Always work on a feature branch
- ✅ Merge via PR
- ❌ Never force-push without explicit user instruction
- ❌ Never rebase shared branches

---

## How It Works

### 0. Remote Sync Guardrail (REQUIRED)

```bash
git fetch origin
git status -sb
```

**Decision Logic**
- Branch behind → rebase required
- Branch diverged → stop and ask user
- Branch clean / ahead → proceed

```bash
git pull --rebase origin main
```

---

### 1. Git Status Review

```bash
git status
git log -5 --oneline
git diff --stat
```

Identify:
- Branch name
- Files changed
- Staged vs unstaged
- Commit cleanliness

---

### 2. Change Categorization

Primary category only (one commit = one intent):

- **fix** – Bug fixes, data corrections
- **feat** – New capabilities
- **docs** – Documentation
- **refactor** – Non-behavioral improvements
- **test** – Tests only
- **chore** – Maintenance
- **perf** – Performance improvements

---

### 3. Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

Rules:
- Imperative mood
- ≤72 chars subject
- Explain *why*, not *what*
- One logical change per commit

---

### 4. File Staging Logic

**Always Stage**
- `src/**`
- `scripts/**`
- `tests/**`
- `docs/**`
- `.claude/skills/**`
- Config & examples

**Never Stage**
- `.env`
- `node_modules/`
- temp/debug output
- large data files unless approved

Warn if:
- >300 LOC changed
- >10 files modified (suggest split)

---

### 5. Push Decision Logic

**PROCEED when**
- Branch rebased on latest main
- Tests pass
- Commit message accurate
- No secrets staged

**STOP when**
- On `main` / `master`
- Branch diverged
- Tests failing
- Secrets detected

**ASK USER when**
- Breaking changes
- Large refactor
- Mixed unrelated changes

---

### 6. Execution Steps (Canonical)

```bash
git fetch origin
git pull --rebase origin main
git status
git diff --stat
npm test
git add <files>
git commit -m "<message>"
git push origin <branch>
```

---

### 7. Push Verification

```bash
git rev-parse HEAD
git rev-parse origin/<branch>
```

SHAs must match.

---

## Error Handling

- **Merge conflicts**: Stop, report, do not auto-resolve
- **Push rejected**: Require rebase
- **Auth failure**: Prompt credential check
- **Test failure**: Abort commit

---

## Output Summary

```
✓ Successfully pushed to GitHub

Branch: feature/extraction-fix
Commit: fix(extraction): Correct schema validation error in person upsert
Files changed: 3 (+127 −42)

Remote: <commit-url>
```

---

## Notes

- Rebase only local feature branches
- Never rewrite shared history
- Follow project-specific Git rules if present
- Default to safety over speed
