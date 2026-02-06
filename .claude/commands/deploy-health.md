Compare system behavior before and after the most recent deployment to detect regressions.

## Steps

1. **Get latest deploy**: Use `mcp__render__list_deploys` (limit 2) for the duxsoup service to get the two most recent deploys and their timestamps.

2. **Define time windows**: Using the latest deploy's start timestamp:
   - **Before window**: 30 minutes before deploy start
   - **After window**: 30 minutes after deploy finish (or now, if deploy was recent)

3. **Compare error volume**:
   - Use `mcp__render__list_logs` with `level: ["error"]` for the BEFORE window (use startTime/endTime)
   - Use `mcp__render__list_logs` with `level: ["error"]` for the AFTER window
   - Count errors in each window

4. **Check for restarts/crashes after deploy**:
   - Use `mcp__render__list_logs` with `text: ["restart", "crash", "SIGTERM", "OOMKilled"]` in the AFTER window

5. **Compare webhook processing**:
   - Use `mcp__render__list_logs` with `text: ["Webhook received"]` for BEFORE and AFTER windows
   - Check for any new error patterns that didn't exist before

6. **Check deploy commit**: Use `mcp__github__list_commits` to get the deploy commit and see what changed.

## Output Format

```
Deploy: <deploy_id>
  Commit: <sha> — <message>
  Started: <time> | Finished: <time> | Duration: <Xm Ys>

Before Deploy (30min):        After Deploy (30min):
  Errors:    ___                Errors:    ___  [↑/↓/=]
  Webhooks:  ___                Webhooks:  ___  [↑/↓/=]
  Restarts:  ___                Restarts:  ___

Verdict: CLEAN / REGRESSION DETECTED / INCONCLUSIVE

[If regression]:
  New errors after deploy:
  - <error message> (first seen: <time>)
  Suspect commit: <sha> — <message>
```
