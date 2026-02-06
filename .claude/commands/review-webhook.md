Analyze recent webhook processing from Render logs to identify patterns and issues.

## Steps

1. **Fetch recent webhook logs**: Use `mcp__render__list_logs` with `text: ["Webhook received"]` and `limit: 30` to get recent webhook events.

2. **Fetch processing results**: Use `mcp__render__list_logs` with `text: ["processed in MongoDB"]` and `limit: 30` to get processing outcomes.

3. **Fetch errors**: Use `mcp__render__list_logs` with `level: ["error", "warn"]` and `limit: 30`.

4. **Fetch person upsert results**: Use `mcp__render__list_logs` with `text: ["upserted person"]` and `limit: 20`.

5. **Analyze patterns**:
   - Webhook types: count visits vs scans
   - Unique profiles processed (by DuxSoup ID)
   - Duplicate rate: `isDuplicate: true` count
   - Identity resolution: `identitySource` breakdown (salesNavId vs numericId vs profileUrl)
   - Failed upserts / dead letters
   - Processing latency (time between "Webhook received" and "processed in MongoDB")

6. If `$ARGUMENTS` contains a profile URL, DuxSoup ID, or Sales Nav ID, filter logs to that specific identifier.

## Output Format

```
Webhook Activity (last N events):
  Total webhooks:  ___
  Visits:          ___ | Scans: ___
  Unique profiles: ___
  Duplicates:      ___ (___%)

Identity Resolution:
  salesNavId:  ___ (___%)
  numericId:   ___ (___%)
  profileUrl:  ___ (___%)
  missing:     ___ (___%)

Processing:
  Successful person upserts: ___
  Failed upserts:            ___
  Dead letters:              ___

[If errors]:
  Error breakdown:
  - <error message>: ___ occurrences
```

Flag any concerning patterns (high duplicate rate, identity resolution failures, dead letters).
