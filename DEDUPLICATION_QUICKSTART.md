# Deduplication Quick Start

## TL;DR

You have 20,000+ records in `scans` and `visits` collections with many duplicates. I've created a safe, automated deduplication script.

## Quick Commands

### 1. Analyze First (Dry Run - Safe)

```bash
# Check scans collection
node scripts/dedupeObservations.js --collection=scans --dry-run

# Check visits collection
node scripts/dedupeObservations.js --collection=visits --dry-run
```

**This shows what WOULD happen without making any changes.**

### 2. Execute Deduplication (After Review)

```bash
# Deduplicate scans
node scripts/dedupeObservations.js --collection=scans --execute

# Deduplicate visits
node scripts/dedupeObservations.js --collection=visits --execute
```

**This WILL make changes - backups are created automatically.**

## What It Does

The script performs **4 automated phases**:

1. **Analysis**: Counts records, identifies missing event_keys
2. **Backfill**: Computes event_key for legacy records (SHA1 hash of userid|type|time|id)
3. **Identify**: Finds duplicate event_key groups
4. **Remove**: Deletes duplicates, keeps oldest record, backs up removed records

## Safety Features

✅ **Dry-run by default** - Must use `--execute` to make changes
✅ **Automatic backups** - Duplicates saved to `{collection}_duplicates_backup`
✅ **Keeps oldest record** - Source of truth preserved
✅ **Conflict detection** - Warns if backfilling creates duplicates
✅ **Progress logging** - Shows status every 100 records

## What Gets Removed?

For each duplicate group (records with same event_key):

- **KEEPS**: Oldest record by `createdAt`
- **REMOVES**: All newer duplicates
- **BACKS UP**: Removed records to backup collection

## Example Output

```
============================================================
DuxSoup ETL - Observation Deduplication Script
============================================================
Collection: scans
Mode: DRY RUN
============================================================

=== Phase 1: Analyzing scans collection ===
Total records: 20,543
With event_key: 12,000
Without event_key (legacy): 8,543

=== Phase 2: Backfilling event_keys for scans ===
Found 8,543 legacy records to backfill
[DRY RUN] Would set event_key for 507f1f77bcf86cd799439011: a3f5c8d...
...

=== Phase 3: Identifying duplicates in scans ===
Found 87 duplicate event_key groups
Total duplicate records to remove: 2,309

=== Phase 4: Removing duplicates from scans ===
[DRY RUN] Would remove duplicate 507f191e810c19729de860ea (keeping 507f1f77bcf86cd799439011)
...

============================================================
SUMMARY
============================================================
Collection: scans
Total records: 20,543
Legacy records backfilled: 8,543
Duplicate groups found: 87
Total duplicates removed: 2,309
============================================================
```

## If Something Goes Wrong

### Rollback Process

```javascript
// In MongoDB shell/Compass:
// Restore from backup
db.scans_duplicates_backup.find().forEach((doc) => {
  delete doc._backup_reason;
  delete doc._backup_date;
  delete doc._kept_record_id;
  db.scans.insertOne(doc);
});
```

### Verify Results

```javascript
// Check counts
db.scans.countDocuments();
db.scans.countDocuments({ event_key: null });

// Check for remaining duplicates
db.scans.aggregate([
  { $group: { _id: "$event_key", count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
]);

// Inspect backup
db.scans_duplicates_backup.countDocuments();
```

## Files Created

- `scripts/dedupeObservations.js` - Main deduplication script
- `docs/DEDUPLICATION_GUIDE.md` - Comprehensive guide
- `__tests__/scripts/dedupeObservations.test.js` - Test suite (all passing ✅)
- `DEDUPLICATION_QUICKSTART.md` - This file

## Why Duplicates Exist

1. **Sparse Index**: `event_key` field allows multiple NULL values
2. **Legacy Data**: Records created before `event_key` system
3. **Webhook Retries**: Some duplicates from before idempotency was implemented

## What is event_key?

An idempotency key computed as: `SHA1(userid | type | time | id)`

- Same webhook retried → same event_key → detected as duplicate
- Unique index prevents new duplicates (but sparse allows NULL values)

## Impact on Other Collections

**No impact** on downstream collections:

- `people` collection (uses canonical_id + aliases)
- `companies` collection (uses canonical_id)
- `locations` collection (uses canonical_id)

Observations are source of truth; snapshots have separate deduplication logic.

## Next Steps

1. **Run dry-run first** to see what would happen
2. **Review output** to understand scope
3. **Execute on scans** collection
4. **Verify results** using MongoDB queries above
5. **Execute on visits** collection
6. **Clean up backups** after 30 days (optional)

## Questions?

- Full documentation: `docs/DEDUPLICATION_GUIDE.md`
- Test suite: `npm test -- __tests__/scripts/dedupeObservations.test.js`
- Related code: `src/models/scan.js:82-86`, `src/models/visit.js:100-104`, `src/utils/eventKey.js`
