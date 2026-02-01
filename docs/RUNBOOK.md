# Operational Runbook

> Guide for running maintenance scripts in the DuxSoup ETL system.
>
> All scripts live in `scripts/`. This document covers the most common operations, their flags, expected output, and rollback procedures.
>
> **Last Updated:** February 1, 2026

---

## 1. Prerequisites

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB connection string (Atlas or local) |
| `MONGO_URI` | Some scripts | Alternate env var name used by some scripts (check script source) |

Most scripts use `MONGODB_URI` with a fallback to `mongodb://localhost:27017/duxsoup-etl`. A few newer scripts (e.g., `merge-duplicates.js`, `backfill-alias-normalization.js`) use `MONGO_URI` instead. Check the script source if you get a connection error.

Load environment variables by placing a `.env` file in the project root. Most scripts call `require('dotenv').config()`.

### Backup Recommendations

**Before any destructive operation** (merge, migrate, delete):

```bash
# Full database backup
mongodump --uri="$MONGODB_URI" --out=./backup-$(date +%Y%m%d-%H%M%S)

# Single collection backup
mongodump --uri="$MONGODB_URI" --collection=people --out=./backup-people-$(date +%Y%m%d)
```

### Connecting to Production vs Staging

```bash
# Staging
export MONGODB_URI="mongodb+srv://user:pass@staging-cluster.mongodb.net/duxsoup-etl"

# Production
export MONGODB_URI="mongodb+srv://user:pass@prod-cluster.mongodb.net/duxsoup-etl"
```

Always verify which environment you are connected to before running scripts. Several scripts log "Connected to MongoDB" on startup — confirm the cluster name in the connection string.

---

## 2. Common Operations

### Analysis & Diagnostics

These scripts are **read-only** and safe to run at any time.

| Script | Purpose | Command | Expected Output |
|--------|---------|---------|-----------------|
| `analyze-duplicates.js` | Find duplicate people by name, show identity breakdown | `node scripts/analyze-duplicates.js` | Count of name-based duplicates, sample entries, Sales Nav vs username split |
| `analyzeDuplicates.js` | Older duplicate analysis (similar to above) | `node scripts/analyzeDuplicates.js` | Duplicate counts and samples |
| `analyzeLegacyDuplicates.js` | Analyze duplicates in legacy collections | `node scripts/analyzeLegacyDuplicates.js` | Legacy duplicate breakdown |
| `analyzeOrphanedObservations.js` | Comprehensive orphan analysis: visits/scans not linked to people, dead letter correlation | `node scripts/analyzeOrphanedObservations.js` | Total counts, orphan counts, dead letter overlap, recommendations |
| `identify-salesnavid-duplicates.js` | Find duplicates caused by Sales Nav ID case collisions | `node scripts/identify-salesnavid-duplicates.js` | Duplicate groups with case-variant Sales Nav IDs |
| `checkDatabase.js` | Quick diagnostic: count people, show 5 samples | `node scripts/checkDatabase.js` | Total count + sample `_id`, name, aliases |
| `checkDeadLetters.js` | Inspect dead letter queue | `node scripts/checkDeadLetters.js` | Dead letter counts by status |
| `checkRemainingDeadLetters.js` | Check unresolved dead letters | `node scripts/checkRemainingDeadLetters.js` | Remaining dead letter details |
| `analyze-parsing-failures.js` | Find location strings that failed parsing | `node scripts/analyze-parsing-failures.js` | Unparseable location strings |
| `check-unparsed-metros.js` | Find metro area locations not yet supported by parser | `node scripts/check-unparsed-metros.js` | Unrecognized metro patterns |
| `check-observations-for-stable-ids.js` | Check which observations carry stable identifiers | `node scripts/check-observations-for-stable-ids.js` | Percentage with Sales Nav ID, numeric ID, etc. |
| `compare-visit-scan-data.js` | Compare field coverage between visit and scan collections | `node scripts/compare-visit-scan-data.js` | Field-by-field comparison |
| `investigate-snapshot-completeness.js` | Check person records for missing snapshot fields | `node scripts/investigate-snapshot-completeness.js` | Completeness report |
| `generateEnrichmentReport.js` | Generate a report of data enrichment coverage | `node scripts/generateEnrichmentReport.js` | Enrichment statistics |

### Backfill Scripts

These add missing data to existing records. All default to **dry-run mode**.

| Script | Purpose | Dry-Run Command | Execute Command | Flags |
|--------|---------|-----------------|-----------------|-------|
| `backfillCanonicalId.js` | Add `canonical_id` to people missing it | `node scripts/backfillCanonicalId.js --dry-run` | `node scripts/backfillCanonicalId.js --commit` | `--limit=N`, `--batch-size=N` |
| `backfillCompanyCanonicalId.js` | Add `canonical_id` to companies missing it | `node scripts/backfillCompanyCanonicalId.js --dry-run` | `node scripts/backfillCompanyCanonicalId.js --commit` | `--limit=N`, `--batch-size=N` |
| `backfillLocationCanonicalId.js` | Add `canonical_id` to locations missing it | `node scripts/backfillLocationCanonicalId.js --dry-run` | `node scripts/backfillLocationCanonicalId.js --commit` | `--limit=N`, `--batch-size=N` |
| `backfill-alias-normalization.js` | Add normalized aliases (lowercase, stripped URLs) to people | `node scripts/backfill-alias-normalization.js --dry-run` | `node scripts/backfill-alias-normalization.js --execute` | `--limit=N`, `--batch-size=N` |
| `backfill-all-snapshot-data.js` | Recover missing snapshot fields from observations | `node scripts/backfill-all-snapshot-data.js --dry-run` | `node scripts/backfill-all-snapshot-data.js --execute` | `--limit=N` |
| `backfill-missing-names.js` | Fill in missing firstName/lastName from observations | `node scripts/backfill-missing-names.js --dry-run` | `node scripts/backfill-missing-names.js --execute` | — |
| `backfill-salesnavid-extraction.js` | Extract and store Sales Nav IDs from URL aliases | `node scripts/backfill-salesnavid-extraction.js --dry-run` | `node scripts/backfill-salesnavid-extraction.js --execute` | — |
| `backfillSeniority.js` | Add seniority rank to person roles based on title parsing | `node scripts/backfillSeniority.js --dry-run` | `node scripts/backfillSeniority.js --commit` | `--limit=N`, `--batch-size=N` |

### Rebuild Scripts

Rebuild entire collections from observation data. Idempotent and replayable.

| Script | Purpose | Dry-Run Command | Execute Command | Flags |
|--------|---------|-----------------|-----------------|-------|
| `rebuildCompanies.js` | Rebuild companies collection from visits/scans | `node scripts/rebuildCompanies.js --dry-run` | `node scripts/rebuildCompanies.js` | `--from=YYYY-MM-DD`, `--to=YYYY-MM-DD`, `--limit=N`, `--source=visit\|scan` |
| `rebuildLocations.js` | Rebuild locations collection from visits/scans | `node scripts/rebuildLocations.js --dry-run` | `node scripts/rebuildLocations.js` | `--from=YYYY-MM-DD`, `--to=YYYY-MM-DD`, `--limit=N`, `--source=visit\|scan` |
| `rebuildPeople.js` | Rebuild people collection from visits/scans | `node scripts/rebuildPeople.js --dry-run` | `node scripts/rebuildPeople.js` | `--from=YYYY-MM-DD`, `--to=YYYY-MM-DD`, `--limit=N`, `--source=visit\|scan` |
| `re-extract-snapshots.js` | Re-run `upsertFromObservation` for people with missing data | `node scripts/re-extract-snapshots.js --dry-run` | `node scripts/re-extract-snapshots.js --execute` | `--limit=N` |

### Migration Scripts

Transform data structures or identifiers. **Back up before running.**

| Script | Purpose | Dry-Run Command | Execute Command | Flags |
|--------|---------|-----------------|-----------------|-------|
| `migrateLocationStructure.js` | Add structured location fields (city, state, country) to location records | `node scripts/migrateLocationStructure.js --dry-run` | `node scripts/migrateLocationStructure.js` | `--limit=N` |
| `migrate-url-to-stable-ids.js` | Migrate people with URL-based `_id` to stable IDs | `node scripts/migrate-url-to-stable-ids.js --dry-run` | `node scripts/migrate-url-to-stable-ids.js --execute` | `--limit=N` |
| `migrate-canonical-ids.js` | Update canonical IDs to use higher-priority identifiers | `node scripts/migrate-canonical-ids.js --dry-run` | `node scripts/migrate-canonical-ids.js --execute` | `--limit=N` |
| `migrate-connections-degree-to-number.js` | Convert string connection/degree values to numbers | `node scripts/migrate-connections-degree-to-number.js --dry-run` | `node scripts/migrate-connections-degree-to-number.js --execute` | — |
| `standardize-people-urls.js` | Normalize URL fields across people collection | `node scripts/standardize-people-urls.js --dry-run` | `node scripts/standardize-people-urls.js --execute` | — |
| `reparse-locations.js` | Re-parse location strings with improved parser | `node scripts/reparse-locations.js --dry-run` | `node scripts/reparse-locations.js --execute` | — |

### Cleanup & Deduplication

**These are destructive operations.** Always dry-run first. Back up before executing.

| Script | Purpose | Dry-Run Command | Execute Command | Flags |
|--------|---------|-----------------|-----------------|-------|
| `merge-duplicates.js` | Merge duplicate people by name+company+location/title | `node scripts/merge-duplicates.js --dry-run --output=merge-review.csv` | `node scripts/merge-duplicates.js --execute` | `--limit-groups=N`, `--output=<path>` |
| `dedupe-people.js` | Detect and merge duplicates using multiple strategies | `node scripts/dedupe-people.js --dry-run` | `node scripts/dedupe-people.js --execute` | `--limit=N` |
| `dedupeAliases.js` | Remove duplicate aliases (same type+value) from people | `node scripts/dedupeAliases.js --dry-run` | `node scripts/dedupeAliases.js --commit` | `--limit=N`, `--batch-size=N` |
| `dedupeObservations.js` | Remove duplicate observation references from people | `node scripts/dedupeObservations.js --dry-run` | `node scripts/dedupeObservations.js --execute` | — |
| `identify-salesnavid-duplicates.js` | Find and optionally merge Sales Nav ID case-variant duplicates | `node scripts/identify-salesnavid-duplicates.js` | `node scripts/identify-salesnavid-duplicates.js --auto-merge` | `--auto-merge` |

### Orphan Resolution

| Script | Purpose | Dry-Run Command | Execute Command |
|--------|---------|-----------------|-----------------|
| `link-orphaned-observations.js` | Link unattached visits/scans to their matching person | `node scripts/link-orphaned-observations.js --dry-run` | `node scripts/link-orphaned-observations.js` (run without `--dry-run`) |
| `create-missing-people.js` | Create person records for orphaned observations that have no match | `node scripts/create-missing-people.js --dry-run` | `node scripts/create-missing-people.js --execute` |
| `processUnprocessedScans.js` | Process scans that were saved but never converted to person snapshots | `node scripts/processUnprocessedScans.js --dry-run` | `node scripts/processUnprocessedScans.js --execute` |
| `replayDeadLetters.js` | Replay failed observation-to-person conversions from dead letter queue | `node scripts/replayDeadLetters.js --dry-run` | `node scripts/replayDeadLetters.js --execute` |

### Import Scripts

| Script | Purpose | Command | Notes |
|--------|---------|---------|-------|
| `import-csv-visits.js` | Import DuxSoup CSV exports as visit observations | `node scripts/import-csv-visits.js --file=<path>` | Creates visits, people, companies, locations |
| `import-historical-csv.js` | Import historical DuxSoup exports (older `id.XXXXXXX` format) | `node scripts/import-historical-csv.js --file=<path>` | Handles legacy ID format, missing Sales Nav IDs |
| `importCsvEnrichment.js` | Import enrichment data from CSV | `node scripts/importCsvEnrichment.js --file=<path>` | — |

### Index Management

| Script | Purpose | Command | Flags |
|--------|---------|---------|-------|
| `createIndexes.js` | Create all required MongoDB indexes for canonical identity resolution | `node scripts/createIndexes.js` | `--fix-non-unique` to drop and recreate problematic unique indexes |

---

## 3. Safe Defaults

**All scripts default to dry-run mode.** No data is modified unless you explicitly opt in.

The opt-in flag varies by script:

| Pattern | Scripts Using It |
|---------|-----------------|
| `--commit` | `backfillCanonicalId.js`, `backfillCompanyCanonicalId.js`, `backfillLocationCanonicalId.js`, `dedupeAliases.js`, `backfillSeniority.js` |
| `--execute` | `merge-duplicates.js`, `backfill-alias-normalization.js`, `link-orphaned-observations.js` (no flag = execute, `--dry-run` to preview), `dedupe-people.js`, `migrate-url-to-stable-ids.js`, most migration scripts |
| Remove `--dry-run` | `rebuildCompanies.js`, `rebuildLocations.js`, `rebuildPeople.js`, `migrateLocationStructure.js` |

### Scripts Without Dry-Run Mode

The following scripts **do not have dry-run mode** and will modify data immediately:

- **Analysis scripts** (`analyze-duplicates.js`, `analyzeOrphanedObservations.js`, etc.) — these are read-only, so dry-run is unnecessary.
- **`createIndexes.js`** — creates indexes immediately. Indexes are additive and non-destructive to data, but may lock the collection briefly on large datasets.
- **`checkDatabase.js`** — read-only diagnostic.

### Recommended Workflow

1. **Always start with dry-run** to understand what will change
2. **Review the output** — check counts, sample records
3. **Back up** if the operation is destructive
4. **Run with a small `--limit`** first (e.g., `--limit=50`)
5. **Verify** the limited run produced correct results
6. **Run the full operation**

---

## 4. Rollback Guidance

### Merge Operations (`merge-duplicates.js`, `dedupe-people.js`)

**Audit trail:** Merge operations write records to the `merges` collection. Each record contains the winner ID, loser IDs, the merge reason, and a timestamp.

**Rollback:**
- There is no automated un-merge script. To reverse a merge:
  1. Find the merge record in `merges` collection: `db.merges.find({ winner_id: "<id>" })`
  2. The loser documents are **deleted** during merge — they cannot be recovered without a backup
  3. **Restore from backup** is the only reliable rollback for merges

**Prevention:** Always export the `--output=merge-review.csv` candidate list and review before executing.

### Migration Operations (`migrate-url-to-stable-ids.js`, `migrate-canonical-ids.js`)

**Rollback:**
- `migrate-url-to-stable-ids.js` creates new documents with stable `_id` values and deletes old URL-based documents. The old `_id` is logged.
- To reverse: restore the affected documents from a `mongodump` backup taken before the migration.

### Backfill Operations (`backfillCanonicalId.js`, `backfill-alias-normalization.js`, etc.)

**Rollback:**
- Backfills add data (`$set`, `$addToSet`) — they do not delete or overwrite existing data.
- To reverse a backfill: use a targeted `updateMany` to `$unset` the fields that were added, or restore from backup.
- Example: `db.people.updateMany({ canonical_id: { $exists: true } }, { $unset: { canonical_id: "" } })`

### Rebuild Operations (`rebuildCompanies.js`, `rebuildLocations.js`, `rebuildPeople.js`)

**Rollback:**
- Rebuilds are idempotent upserts. Running them again with the same data produces the same result.
- If a rebuild introduced bad data, restore the collection from backup and re-run with corrected logic.

### General Backup Procedure

```bash
# Before any destructive operation
mongodump --uri="$MONGODB_URI" --collection=people --out=./pre-operation-backup

# Restore if needed
mongorestore --uri="$MONGODB_URI" --collection=people --drop ./pre-operation-backup/duxsoup-etl/people.bson
```

---

## 5. Monitoring During Scripts

### Watching Logs

Scripts log to stdout/stderr. For long-running operations:

```bash
# Run with output capture
node scripts/rebuildCompanies.js 2>&1 | tee rebuild-companies-$(date +%Y%m%d).log

# Watch in real-time
node scripts/merge-duplicates.js --execute 2>&1 | tee merge-output.log
```

Most scripts log progress every 100 records (e.g., "Processed 100 visits...", "100/5000 linked...").

### Counts to Check Before and After

| Metric | How to Check | Why |
|--------|-------------|-----|
| Person count | `db.people.countDocuments()` | Should decrease after merges, increase after `create-missing-people` |
| Orphaned visit count | Run `analyzeOrphanedObservations.js` | Should decrease after `link-orphaned-observations` |
| Orphaned scan count | Same as above | Same as above |
| Duplicate count | Run `analyze-duplicates.js` | Should decrease after `merge-duplicates` or `dedupe-people` |
| Dead letter count | `db.dead_letters.countDocuments()` | Should decrease after `replayDeadLetters` |
| Merge audit count | `db.merges.countDocuments()` | Should increase after merge operations |

### Health Endpoints

While the server is running, check these endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Basic health check (always 200 if server is up) |
| `GET /api/health/metrics` | Overall system metrics: person/visit/scan/company/location counts |
| `GET /api/health/ingestion` | Ingestion statistics: recent webhook processing rates |
| `GET /api/health/parity` | Visit/Scan parity check: are observations balanced? |

```bash
# Quick health check
curl http://localhost:3000/health

# Full metrics
curl http://localhost:3000/api/health/metrics | jq .

# Check ingestion stats
curl http://localhost:3000/api/health/ingestion | jq .
```

### Post-Operation Verification Checklist

After any major operation:

1. Run `node scripts/checkDatabase.js` for a quick sanity check
2. Hit `GET /api/health/metrics` to verify collection counts
3. Run `node scripts/analyzeOrphanedObservations.js` to check for new orphans
4. Run `node scripts/analyze-duplicates.js` to check duplicate count
5. Spot-check 5-10 affected records manually in the database

---

## Appendix: Full Script Inventory

Grouped alphabetically within categories for quick reference.

### Analysis & Diagnostics (Read-Only)

| Script | Purpose |
|--------|---------|
| `analyze-canonical-id-mismatches.js` | Find canonical ID mismatches |
| `analyze-canonical-id-mismatches-batched.js` | Batched version of canonical ID mismatch analysis |
| `analyze-duplicates.js` | Analyze duplicate people by name |
| `analyze-parsing-failures.js` | Find unparseable location strings |
| `analyzeDuplicates.js` | Older duplicate analysis |
| `analyzeLegacyDuplicates.js` | Legacy collection duplicate analysis |
| `analyzeOrphanedObservations.js` | Comprehensive orphan analysis |
| `analyzeSingleDeadLetter.js` | Inspect a single dead letter entry |
| `audit-salesnavid-case.js` | Audit Sales Nav ID case inconsistencies |
| `check-connections-degree-data.js` | Check connections/degree data quality |
| `check-observation-location.js` | Check location data in observations |
| `check-observations-for-stable-ids.js` | Check which observations carry stable IDs |
| `check-unparsed-metros.js` | Find unrecognized metro area patterns |
| `check-url-people-observation-types.js` | Check URL-based people observation sources |
| `checkAliasTypes.js` | Audit alias type distribution |
| `checkCrossCollectionDuplicates.js` | Check for duplicates across collections |
| `checkCsvInScans.js` | Check CSV-imported scan records |
| `checkDatabase.js` | Quick database diagnostic |
| `checkDeadLetterDates.js` | Analyze dead letter date ranges |
| `checkDeadLetters.js` | Inspect dead letter queue |
| `checkRemainingDeadLetters.js` | Check unresolved dead letters |
| `checkRiyaThosar.js` | Debug specific person record |
| `compare-visit-scan-data.js` | Compare visit vs scan field coverage |
| `countUnprocessedScans.js` | Count scans missing person upserts |
| `debug-canonical-duplicate.js` | Debug canonical ID duplicate case |
| `find-migratable-url-people.js` | Find URL-based people eligible for migration |
| `findSpecificPerson.js` | Look up a specific person by ID |
| `generateEnrichmentReport.js` | Generate data enrichment coverage report |
| `health-check.js` | Standalone health check script |
| `health-check-fixed.js` | Fixed version of health check |
| `identify-salesnavid-duplicates.js` | Find Sales Nav ID case-variant duplicates |
| `inspect-url-person-observation.js` | Inspect observations for URL-based people |
| `inspectCanonicalIds.js` | Inspect canonical ID distribution |
| `investigate-company-etl.js` | Debug company ETL processing |
| `investigate-missing-names.js` | Find people missing name data |
| `investigate-records.js` | General record investigation |
| `investigate-salesnavid-conflicts.js` | Investigate Sales Nav ID conflicts |
| `investigate-snapshot-completeness.js` | Check snapshot field completeness |
| `investigate-url-based-ids.js` | Investigate URL-based person IDs |
| `investigateOrphanedVisit.js` | Debug a specific orphaned visit |
| `testCsvMatching.js` | Test CSV import matching logic |
| `verify-location-fix.js` | Verify location parsing fix |
| `verify-numeric-conversion.js` | Verify numeric field conversion |
| `verifyCanonicalId.js` | Verify canonical ID computation |
| `verifyRebuild.js` | Verify rebuild results |

### Backfill

| Script | Purpose |
|--------|---------|
| `backfill-alias-normalization.js` | Normalize existing aliases |
| `backfill-all-snapshot-data.js` | Recover missing snapshot fields |
| `backfill-companies.js` | Backfill company data |
| `backfill-missing-names.js` | Fill in missing names |
| `backfill-salesnavid-extraction.js` | Extract Sales Nav IDs from URLs |
| `backfillCanonicalId.js` | Add canonical IDs to people |
| `backfillCompanyCanonicalId.js` | Add canonical IDs to companies |
| `backfillLocationCanonicalId.js` | Add canonical IDs to locations |
| `backfillSeniority.js` | Add seniority ranks to roles |

### Rebuild

| Script | Purpose |
|--------|---------|
| `rebuildCompanies.js` | Rebuild companies from observations |
| `rebuildLocations.js` | Rebuild locations from observations |
| `rebuildPeople.js` | Rebuild people from observations |
| `re-extract-snapshots.js` | Re-extract snapshot data for incomplete records |

### Migration

| Script | Purpose |
|--------|---------|
| `migrate-canonical-ids.js` | Upgrade canonical IDs to higher-priority identifiers |
| `migrate-canonical-ids-batched.js` | Batched version of canonical ID migration |
| `migrate-connections-degree-to-number.js` | Convert string values to numeric types |
| `migrate-url-to-stable-ids.js` | Migrate URL-based `_id` values to stable IDs |
| `migrateCompanyIds.js` | Migrate company ID formats |
| `migrateLocationStructure.js` | Add structured location fields |
| `standardize-people-urls.js` | Normalize URL fields |
| `reparse-locations.js` | Re-parse locations with improved parser |

### Cleanup & Deduplication

| Script | Purpose |
|--------|---------|
| `dedupe-people.js` | Multi-strategy duplicate detection and merge |
| `dedupeAliases.js` | Remove duplicate aliases |
| `dedupeObservations.js` | Remove duplicate observation references |
| `merge-duplicates.js` | Merge duplicates by name+company+signal |
| `mergeScans.js` | Merge duplicate scan records |

### Orphan Resolution

| Script | Purpose |
|--------|---------|
| `create-missing-people.js` | Create people for unmatched orphans |
| `link-orphaned-observations.js` | Link orphaned observations to existing people |
| `linkIdentities.js` | Link identity records across collections |
| `processUnprocessedScans.js` | Process scans that missed Phase 2 |
| `replayDeadLetters.js` | Replay failed dead letter entries |

### Import

| Script | Purpose |
|--------|---------|
| `import-csv-visits.js` | Import DuxSoup CSV exports |
| `import-historical-csv.js` | Import historical CSV format |
| `importCsvEnrichment.js` | Import enrichment CSV data |

### Index Management

| Script | Purpose |
|--------|---------|
| `createIndexes.js` | Create all required MongoDB indexes |
| `atlas-search-indexes.json` | Atlas Search index definitions (not a script — JSON config) |

### Shell Scripts

| Script | Purpose |
|--------|---------|
| `cutover.sh` | Database cutover procedure |
| `pre-flight-check.sh` | Pre-deployment verification checks |
| `run-backfill.sh` | Run multiple backfill scripts in sequence |
