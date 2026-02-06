List recent changes merged to master, flagging anything that touches high-risk ETL areas.

**Usage**: `/what-changed [hours]` — defaults to 48 hours if no argument given.

## Steps

1. **Parse timeframe**: Use `$ARGUMENTS` as hours (default 48).

2. **Get recent commits**: Use `mcp__github__list_commits` on the default branch (master) with enough depth to cover the timeframe.

3. **For each commit**, categorize by examining the commit message and files changed:

   **Risk categories for this ETL system** (flag these):
   - **Identity resolution**: Changes to `identityResolverService.js`, `identityMatcher.js`, `salesNavIdExtractor.js`
   - **Snapshot logic**: Changes to `personController.js`, `companyController.js`, `locationController.js`
   - **Data models**: Changes to any file in `src/models/`
   - **Webhook pipeline**: Changes to `observationHandler.js`, `validation.js`
   - **Database indexes**: Changes to `createIndexes.js` or `createAtlasSearchIndex.js`
   - **Migrations/scripts**: Changes to files in `scripts/`

   **Low-risk categories** (note but don't flag):
   - Tests only
   - Documentation only
   - Config / CI changes
   - Backlog updates

4. **Check for schema changes**: If any model file was modified, read the diff to identify added/removed/renamed fields.

## Output Format

```
Changes in last <N> hours (<count> commits):

HIGH-RISK:
  <sha-short> <message>
    Files: <list>
    Risk: <identity|snapshot|model|webhook|migration>
    Impact: <brief description of what could break>

STANDARD:
  <sha-short> <message>

LOW-RISK:
  <sha-short> <message> (tests/docs only)

Summary: <X> commits, <Y> high-risk changes
[If high-risk]: Recommend running `/deploy-health` after next deploy.
```
