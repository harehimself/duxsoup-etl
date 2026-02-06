Check the current deployment status and recent deploy history on Render.

## Steps

1. **Get service info**: Use `mcp__render__get_service` for the duxsoup service to check current status (suspended, auto-deploy, branch).

2. **List recent deploys**: Use `mcp__render__list_deploys` with `limit: 5` to get recent deployment history.

3. **Check latest deploy details**: For the most recent deploy, use `mcp__render__get_deploy` to get full details (status, trigger, commit, timestamps, duration).

4. **Compare with local**: Run `git log --oneline -5` to compare local commits with the deployed commit.

5. **Check for pending changes**: Run `git log --oneline origin/master..HEAD` to see if there are unpushed commits.

## Output Format

```
Current Service:
  Status: _____ | Branch: _____ | Auto-deploy: _____
  URL: https://duxsoup.onrender.com

Latest Deploy:
  Status: _____ | Trigger: _____
  Commit: _____
  Started: _____ | Finished: _____ | Duration: _____

Recent Deploys:
  | # | Status | Trigger | Commit | Time |
  |---|--------|---------|--------|------|

Local vs Deployed:
  Deployed commit: _____
  Local HEAD:      _____
  Unpushed commits: ___ (list if any)
```

Flag any failed deploys or if local is ahead of deployed.
