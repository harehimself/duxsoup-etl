# Historical CSV Import - Quick Start Guide

## Overview

This guide covers importing the historical DuxSoup extraction CSV (`historical-extraction.csv`) using the specialized import script.

## Quick Commands

```bash
# 1. DRY RUN (test with sample)
node scripts/import-historical-csv.js test-sample.csv --dry-run --batch-size=50

# 2. FULL IMPORT (production)
node scripts/import-historical-csv.js historical-extraction.csv --batch-size=100

# 3. POST-IMPORT: Check for failed upserts
node scripts/replay-dead-letters.js --dry-run

# 4. POST-IMPORT: Verify data quality
npm run check-health
```

## File Statistics

- **File:** `historical-extraction.csv`
- **Size:** 229.9MB
- **Records:** ~49,723 (including header)
- **Format:** DuxSoup export with extended position/education data

## What the Script Does

### Phase 1: Visit Observations (Append-Only)
- Creates immutable Visit records from each CSV row
- Idempotency: Uses `event_key` (SHA1 hash) to prevent duplicates
- Re-running import will skip existing visits (safe)

### Phase 2: Person Snapshots (Enriched)
- Creates or updates Person records with:
  - ✅ Skills (Skill-0 through Skill-99)
  - ✅ Role history (Position-0 through Position-25)
  - ✅ Education (School-0 through School-19) **NEW**
  - ✅ Contact info, location, profile data
- Identity resolution: Uses LinkedIn username or numeric ID
- Deduplication: Merges with existing people by aliases

## Key Features

### Extended Data Extraction
```
Position History:  Position-0 → Position-25 (covers 99.99%+ of records)
Education History: School-0 → School-19 (complete data)
Skills:            Skill-0 → Skill-99 (all skills)
```

### ID Handling
- **CSV Format:** `id.XXXXXXX` (e.g., `id.21187262`)
- **Person _id:** Extracted numeric ID or LinkedIn username
- **DuxSoup ID:** Preserved in aliases array for reference

### Idempotency
- **Synthetic UserID:** `historical-import`
- **Event Key:** SHA1(userid + type + time + id)
- Safe to re-run: Existing visits skipped automatically

## Expected Results (Full Import)

```
Total Rows:           ~49,723
Visits Created:       ~49,723 (first run) / 0 (subsequent runs)
People Created:       ~X (new unique people)
People Updated:       ~Y (existing people enriched)
Skills Added:         ~X thousand
Roles Added:          ~X thousand
Education Added:      ~X thousand
Missing Sales Nav ID: 49,723 (all rows lack this field)
```

## Step-by-Step: Full Import

### 1. Pre-Import Backup (Recommended)
```bash
# Create MongoDB backup
mongodump --uri="${MONGODB_URI}" --out=./backup-pre-historical-import-$(date +%Y%m%d)
```

### 2. Run Import
```bash
# Start import with monitoring
node scripts/import-historical-csv.js historical-extraction.csv --batch-size=100 2>&1 | tee import-log.txt
```

**Estimated Time:** 30-60 minutes (depends on network/DB performance)

**Progress Updates:** Every 50 rows

### 3. Monitor Progress
```bash
# In another terminal, watch the log
tail -f import-log.txt

# Or check database counts
mongo "${MONGODB_URI}" --eval "db.visits.countDocuments({})"
mongo "${MONGODB_URI}" --eval "db.people.countDocuments({})"
```

### 4. Post-Import Validation

#### Check Statistics
The import will print a final report with:
- Total rows processed
- Visits created/skipped
- People created/updated
- Skills/roles/education added
- Errors encountered

#### Review Dead Letters
```bash
# Check for failed person upserts
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const count = await mongoose.connection.db.collection('dead_letters').countDocuments();
  console.log('Dead letters:', count);
  await mongoose.disconnect();
});
"
```

#### Replay Failed Upserts (if any)
```bash
# Preview what would be replayed
node scripts/replay-dead-letters.js --dry-run

# Execute replay
node scripts/replay-dead-letters.js --execute
```

## Troubleshooting

### Error: "Client must be connected before running operations"
**Cause:** Database connection lost during import
**Fix:** Script now handles this - connection stays open until all batches complete

### Error: "Invalid person ID format"
**Cause:** Person model validation rejected ID format
**Fix:** Script now extracts numeric ID from `id.XXXXXXX` format or uses LinkedIn username

### Import Seems Slow
**Solutions:**
- Reduce batch size: `--batch-size=50`
- Check network latency to MongoDB
- Verify MongoDB Atlas cluster isn't throttling

### Duplicate Visits Created
**Check:** Did you change the synthetic userid between runs?
**Fix:** Always use the same userid for idempotency

## Data Quality Notes

### Missing Sales Navigator IDs
- **Issue:** All 49,723 rows have empty `salesNavId` column
- **Impact:** Person identity relies on LinkedIn username or numeric ID
- **Mitigation:** Aliases array includes all identifiers for future enrichment

### Position History Coverage
- **Position-0 to Position-25:** 99.99%+ coverage
- **Position-26 to Position-49:** Only 5 records (0.01%)
- **Decision:** Script extracts up to Position-25 (minimal data loss)

### Education Data
- **NEW:** Historical CSV includes School-0 through School-19
- **Enrichment:** Education data added to Person snapshots
- **Deduplication:** Schools matched by institution + degree + dates

## Files Reference

| File | Purpose |
|------|---------|
| `scripts/import-historical-csv.js` | Main import script (specialized for historical CSV) |
| `historical-extraction.csv` | Full 229.9MB source file (~49,723 records) |
| `test-sample.csv` | Test file (100 records) for dry-runs |
| `test-tiny.csv` | Tiny test file (10 records) for quick validation |
| `import-log.txt` | Import execution log (created during run) |

## Clean Up Test Data

After validating with test files, you may want to remove test visits:

```bash
# Remove visits from test runs
node -e "
require('dotenv').config();
const mongoose = require('mongoose');
const Visit = require('./src/models/visit');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const result = await Visit.deleteMany({
    id: { \$in: ['id.21187262', 'id.102506316', ...] } // Add test IDs
  });
  console.log('Deleted test visits:', result.deletedCount);
  await mongoose.disconnect();
});
"
```

## Success Criteria

✅ Import completed without fatal errors
✅ All ~49,723 rows processed
✅ Visit observations created (idempotency working)
✅ Person snapshots enriched with skills, roles, education
✅ Dead letters collection empty (or replayed successfully)
✅ Data quality checks pass

## Next Steps After Import

1. **Sales Navigator ID Backfill** (if possible)
   - Enrich historical people with Sales Nav IDs from other sources
   - Update aliases arrays

2. **Data Quality Checks**
   - Run health checks: `npm run check-health`
   - Spot-check random person records
   - Verify role timelines and education data

3. **Deduplication Review**
   - Check for duplicate person records
   - Merge any duplicates found
   - Run: `node scripts/dedupe-aliases.js`

4. **Archive Import Artifacts**
   - Move test files to archive folder
   - Save import-log.txt for reference
   - Update documentation with final statistics

---

**Script Version:** 1.0
**Created:** 2026-01-31
**Purpose:** One-time historical data import
**Status:** Ready for production use
