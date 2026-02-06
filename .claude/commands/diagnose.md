Diagnose a production issue by correlating Render logs, GitHub commits, and MongoDB state.

**Usage**: `/diagnose <error-message-or-timestamp-or-keyword>`

The argument `$ARGUMENTS` can be:
- An error message or keyword (e.g., "E11000", "dead letter", "ECONNREFUSED")
- A timestamp (e.g., "2026-02-06T12:00:00Z")
- A person ID or profile URL to trace a specific record's processing

## Steps

### Phase 1: Find the problem
1. **Search Render logs** for the error/keyword:
   - Use `mcp__render__list_logs` with `text: ["$ARGUMENTS"]` and `limit: 30`
   - If a timestamp was given, set startTime to 15 minutes before and endTime to 15 minutes after
   - Also fetch `level: ["error", "warn"]` in the same window

2. **Establish timeline**: From the matching logs, identify:
   - First occurrence timestamp
   - Last occurrence timestamp
   - Frequency (one-off vs recurring)
   - Affected service components (webhook, person upsert, company, location, dead letter)

### Phase 2: Find the cause
3. **Check recent deploys**: Use `mcp__render__list_deploys` (limit 3) and compare deploy timestamps against error timeline.
   - Did the error start after a specific deploy?

4. **Check recent commits**: Use `mcp__github__list_commits` to find commits deployed around the error start time.
   - Focus on changes to: controllers, services, models, utils

5. **Check database state** (if the error involves a specific record):
   - Use `mcp__mongodb__find` on the `people` collection if a person ID is involved
   - Use `mcp__mongodb__find` on the `deadletters` collection if dead letter related
   - Use `mcp__mongodb__find` on the `visits` or `scans` collection if observation related

### Phase 3: Assess impact
6. **Scope the blast radius**:
   - How many records/webhooks are affected?
   - Is it blocking (Phase 1 failure) or non-blocking (Phase 2 dead letter)?
   - Is it ongoing or resolved?

## Output Format

```
DIAGNOSIS: <short title>

Timeline:
  First seen:  <timestamp>
  Last seen:   <timestamp>
  Frequency:   <one-off | intermittent | continuous>
  Duration:    <ongoing | resolved after X minutes>

Root Cause:
  <explanation of what's happening and why>
  Likely trigger: <deploy <sha> | data issue | external dependency | unknown>

Impact:
  Severity: <low | medium | high>
  Scope: <N records affected | specific person | all webhooks>
  Blocking: <yes (Phase 1) | no (Phase 2 dead letter)>

Evidence:
  - <log entry 1>
  - <log entry 2>
  - <relevant commit or DB state>

Recommended Fix:
  - <actionable next step>
  - <fallback if first step doesn't work>
```
