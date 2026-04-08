Push current work to GitHub: commit, push, triage open branches, and optionally create a PR.

**Usage**: `/push [message]` — optional commit message. If omitted, auto-generate from changes.

## Steps

### Phase 1: Pre-flight checks

1. **Sync with remote**:
   - Run `git fetch origin` to update remote tracking refs.
   - Run `git status -sb` to check if the branch is behind remote.
   - If behind: run `git pull --rebase` to rebase local work on top of remote. If rebase fails, stop and report the conflict.

2. **Check working tree**:
   - Run `git status` (no `-uall`) to see staged, unstaged, and untracked files.
   - Run `git diff --stat` for a change summary.
   - If there are no changes AND no unpushed commits, report "Nothing to push" and stop.

3. **Check current branch**:
   - Run `git branch --show-current`.
   - If on `master` with substantive changes (not just docs/config), recommend creating a feature branch instead. Ask the user whether to continue on master or create a branch.

4. **Secrets scan**:
   - Check both staged AND unstaged files for sensitive patterns: `.env`, `credentials`, `secret`, `token`, `key` files, or files containing API keys / connection strings.
   - If detected, warn the user and exclude those files. Do not proceed until confirmed safe.

5. **Run tests**: Execute `npm test`.
   - If tests fail, report failures and stop. Do not push broken code.

### Phase 2: Commit (if uncommitted changes exist)

6. **Stage changes**:
   - Stage specific files by name (not `git add -A` or `git add .`).
   - Double-check staged files list with `git diff --cached --name-only` before committing.

7. **Backlog check**:
   - If the changes include feature or bug-fix work, check whether the relevant BACKLOG.md item has been updated.
   - Remind the user to include backlog updates in the same commit per project rules.

8. **Craft commit message**:
   - If `$ARGUMENTS` is provided, use it as the commit message.
   - Otherwise, analyze the diff and generate a conventional commit message:
     - Format: `type: short description` (e.g., `fix:`, `feat:`, `refactor:`, `docs:`, `chore:`, `test:`)
     - Keep the subject line under 72 characters.
   - Append the standard co-author trailer.

9. **Commit**: Create the commit using a HEREDOC for the message.

### Phase 3: Push

10. **Push to remote**:
    - If on a feature branch with no upstream: `git push -u origin <branch>`.
    - If upstream exists: `git push`.
    - If push is rejected (non-fast-forward), do NOT force push. Report the issue and stop.
    - Report the pushed commits summary.

### Phase 4: Branch hygiene

11. **Check for stale remote branches**:
    - Run `gh pr list --author "app/dependabot" --state open --json number,title,headRefName,mergeable,createdAt`.
    - If none, skip to Phase 5.

12. **Triage Dependabot PRs**:
    - **Conflicting**: Report as superseded candidates for closing.
    - **Mergeable**: Report as merge candidates.
    - Present a summary table with PR number, title, age, and mergeable status.
    - Ask the user: "Close N conflicting and merge N clean Dependabot PRs?" — wait for confirmation before acting.

### Phase 5: Summary

13. **Report results**:

```
Push complete:
  Branch: _____ -> origin/_____
  Commits pushed: _____
  Latest: <sha-short> <message>

Branch hygiene:
  Open Dependabot PRs: <count>
  Action taken: <merged N / closed N / skipped>

Active branches: <count>
```

14. **Suggest next step**:
    - If on a feature branch: "Run `/pr` to create a pull request."
    - If pushed to master with auto-deploy on: "Deploy will trigger automatically. Run `/deploy-status` to monitor."
