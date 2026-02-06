Run an operational script safely with dry-run by default.

**Usage**: `/ops <command> [--execute]`

Available commands from `$ARGUMENTS`:
- `merge-duplicates` — Find and merge duplicate person records
- `link-orphans` — Link orphaned observations to people
- `migrate-url-ids` — Migrate URL-based person IDs to stable IDs
- `replay-dead-letters` — Replay failed person upserts from dead letter queue
- `rebuild-companies` — Rebuild company snapshots from observations
- `rebuild-locations` — Rebuild location collection
- `backfill-canonical` — Add missing canonical IDs
- `dedupe-aliases` — Remove duplicate aliases
- `backfill-seniority` — Backfill seniority classifications
- `health-check` — Run system health check
- `import-csv` — Import CSV enrichment data (requires --file)

## Steps

1. **Parse the command** from `$ARGUMENTS`. If no command given, list available commands and exit.

2. **Map to npm script**: Look up the corresponding npm script in `package.json` or the `scripts/cli.js` command.

3. **Safety check**:
   - Confirm the command runs in **dry-run mode** by default
   - Show what the command will do before executing
   - If `--execute` is in the arguments, warn that this will make real changes

4. **Run the command** using Bash:
   - Default: `npm run ops -- <command>` (dry-run)
   - With `--execute`: `npm run ops -- <command> --execute`
   - Set timeout to 300 seconds for long-running operations

5. **Analyze output**:
   - Parse processed/updated/skipped/errored counts
   - Flag any errors or unexpected results
   - If dry-run, remind user to add `--execute` to apply changes

## Output Format

```
Operation: <command>
Mode: DRY RUN / EXECUTE
Results:
  Processed: ___
  Updated:   ___
  Skipped:   ___
  Errors:    ___

[If dry-run]: To apply these changes, run: /ops <command> --execute
[If errors]: <detail each error>
```
