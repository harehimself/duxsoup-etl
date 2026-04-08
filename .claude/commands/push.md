Push current work to GitHub: commit, push, create PR, merge to master, and sync local.

**Usage**: `/push [message]` — optional commit message. If omitted, auto-generate from changes.

This is the ONE command for shipping code. It handles the full lifecycle.

## Steps

### Phase 1: Pre-flight checks

1. **Sync with remote**:
   - Run `git fetch origin` to update remote tracking refs.
   - Run `git status -sb` to check if the branch is behind remote.
   - If behind: run `git pull --rebase` to rebase local work on top of remote. If rebase fails, stop and report the conflict.

2. **Check working tree**:
   - Run `git status` (no `-uall`) to see staged, unstaged, and untracked files.
   - Run `git diff --stat` for a change summary.
   - If there are no changes AND no unpushed commits AND already on master, report "Nothing to push" and stop.

3. **Determine branch situation**:
   - Run `git branch --show-current`.
   - If on `master` with uncommitted changes: create a feature branch automatically. Derive the branch name from the changes (e.g., `feat/add-xyz`, `fix/broken-thing`). Switch to it before committing.
   - If on a feature branch: continue on it.

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
    - If no upstream: `git push -u origin <branch>`.
    - If upstream exists: `git push`.
    - If push is rejected (non-fast-forward), do NOT force push. Report the issue and stop.

### Phase 4: Create PR and merge

11. **Check for existing PR**:
    - Run `gh pr view --json number,state,url 2>/dev/null` to check if a PR already exists for this branch.
    - If a PR exists and is open, skip to step 13 (merge).
    - If no PR exists, create one in the next step.

12. **Create PR**:
    - Analyze ALL commits on the branch: `git log --oneline origin/master..HEAD`.
    - Get the full diff: `git diff origin/master...HEAD`.
    - Categorize the changes (bug fix, feature, refactor, ops, docs).
    - Create the PR with `gh pr create`:
      - Title: Short imperative (<70 chars), conventional commit style.
      - Body:
        ```
        ## Summary
        - <1-3 bullet points describing what and why>

        ## Changes
        - <key changes by file/component>

        ## Testing
        - <test results summary>

        🤖 Generated with Claude Code
        ```

13. **Merge PR to master**:
    - Run `gh pr merge --squash --delete-branch` to squash-merge and delete the remote branch.
    - If merge fails due to conflicts or checks, report the issue and provide the PR URL. Do not force anything.

### Phase 5: Sync local

14. **Bring local up to date**:
    - Run `git checkout master`.
    - Run `git pull origin master` to pull the squash-merged commit.
    - Delete the local feature branch if it still exists: `git branch -d <branch>`.

### Phase 6: Branch hygiene

15. **Triage Dependabot PRs** (quick check, not blocking):
    - Run `gh pr list --author "app/dependabot" --state open --json number,title,headRefName,mergeable,createdAt`.
    - If none, skip.
    - Present a summary table with PR number, title, age, and mergeable status.
    - **Conflicting**: Report as candidates for closing.
    - **Mergeable**: Report as merge candidates.
    - Ask the user: "Close N conflicting and merge N clean Dependabot PRs?" — wait for confirmation before acting.

### Phase 7: Summary

16. **Report results**:

```
Push complete:
  Merged: <branch> -> master (squash)
  PR: #<number> <url>
  Commit: <sha-short> <message>

Local: on master, up to date with origin/master

Branch hygiene:
  Open Dependabot PRs: <count>
  Action taken: <merged N / closed N / skipped>
```
