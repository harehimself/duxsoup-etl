# /push – Quality Git Push Command

Push code changes to GitHub using a **pull → rebase → commit → push** workflow optimized for **solo developers and fast-moving repositories**, without enforcing feature branches or PRs.

---

## Overview

This skill provides a disciplined but **unblocked** Git workflow that:
- Keeps `main` / `master` in sync with remote
- Prevents accidental overwrites or rejected pushes
- Produces clean, conventional commits
- Supports both solo and collaborative repos **without bureaucracy**

---

## What This Skill Does

1. **Fetches & Syncs with Remote** (mandatory)
2. **Reviews Git Status**: Branch, staged/unstaged changes, history
3. **Analyzes Changes**: Categorizes by type (fix, feat, docs, etc.)
4. **Determines Push Safety**: Guards against destructive operations
5. **Generates Commit Message**: Conventional, high-quality commits
6. **Stages & Commits**: One logical change per commit
7. **Pushes to GitHub**: With verification

---

## Branch Rules

- ✅ Direct pushes to `main` / `master` are allowed
- ✅ Feature branches are optional, not required
- ❌ PRs are not required
- ❌ Force-push is forbidden unless explicitly instructed
- ❌ Never rebase a branch that is clearly shared with others

> Optimized for solo dev or trusted collaborators.  
> Defer to repo-specific rules if present.

---

## Workflow

### 0. Remote Sync Guardrail (REQUIRED)

```bash
git fetch origin
git status -sb
```

Decision logic:
- Behind → rebase required
- Diverged → stop and ask user
- Clean/ahead → proceed

```bash
git pull --rebase origin <current-branch>
```

---

### 1. Status Review

```bash
git status
git log -5 --oneline
git diff --stat
```

---

### 2. Change Categorization

One commit, one intent:

- fix
- feat
- docs
- refactor
- test
- chore
- perf

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
- Explain why, not what

---

### 4. Staging Rules

Always stage:
- src/**
- scripts/**
- tests/**
- docs/**
- .claude/skills/**
- config/examples

Never stage:
- .env
- node_modules/
- temp/debug output
- large data files (unless approved)

Warn if:
- >300 LOC changed
- >10 files modified

---

### 5. Push Decision Logic

Proceed when:
- Rebasing complete
- Tests pass
- No secrets

Stop when:
- Diverged branch
- Failing tests
- Secrets detected
- Force-push required

Ask user when:
- Breaking changes
- Large refactor
- Mixed changes
- Possibly shared branch

---

### 6. Canonical Execution

```bash
git fetch origin
git pull --rebase origin <current-branch>
git status
git diff --stat
npm test
git add <files>
git commit -m "<message>"
git push origin <current-branch>
```

---

### 7. Verification

```bash
git rev-parse HEAD
git rev-parse origin/<current-branch>
```

SHAs must match.

---

## Error Handling

- Merge conflicts: stop, report
- Push rejected: rebase
- Auth failure: check credentials
- Test failure: abort

---

## Output Example

```
✓ Successfully pushed to GitHub

Branch: main
Commit: feat(push): Allow direct mainline pushes with safety checks
Files changed: 4 (+96 −18)

Remote: <commit-url>
```

---

## Notes

- Direct mainline pushes are supported
- Feature branches are optional
- PRs are optional
- Default to safety over ceremony
