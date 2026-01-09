# Observation Deduplication Guide

## Problem Statement

The `scans` and `visits` collections have accumulated over 20,000 records, many of which are duplicates due to:

1. **Legacy records without event_key**: The `event_key` field uses a sparse unique index, allowing multiple `null` values
2. **Webhook retries**: Before the idempotency system was fully in place, duplicate webhooks may have been processed
3. **Migration gaps**: Records created before the `event_key` system was implemented lack this deduplication key

## What is event_key?

`event_key` is a SHA1 hash computed from:

```
sha1(userid | type | time | id)
```

Where:

- `userid`: DuxSoup user who triggered the webhook
- `type`: Event type (visit or scan)
- `time`: Event timestamp
- `id`: DuxSoup webhook ID

This key ensures idempotency - the same webhook retried multiple times will produce the same `event_key`.

## Deduplication Strategy

The script `scripts/dedupeObservations.js` implements a **4-phase approach**:

### Phase 1: Analysis

- Count total records in collection
- Identify records with missing `event_key` (legacy data)
- Check for duplicate `event_keys` (shouldn't exist with unique index)
- Show sample records for inspection

### Phase 2: Backfill

- Compute `event_key` for all legacy records
- Update records with computed keys
- Detect conflicts (where computed key already exists)
- Log errors for manual review

### Phase 3: Identify Duplicates

- Find all `event_key` values that appear more than once
- Group duplicates together
- Count total duplicates to be removed

### Phase 4: Remove Duplicates

- For each duplicate group, keep the **oldest record** (by `createdAt`)
- Backup duplicates to `{collection}_duplicates_backup` collection
- Delete duplicate records
- Report summary statistics

## Safety Features

1. **Dry-run by default**: Script runs in analysis mode unless `--execute` is specified
2. **Automatic backups**: All duplicates are backed up before deletion
3. **Conflict detection**: Warns if backfilling would create new duplicates
4. **Oldest-first**: Always keeps the earliest record (source of truth)
5. **Progress logging**: Shows status every 100 records processed

## Usage

### Step 1: Analyze (Dry Run)

First, run in dry-run mode to see what would happen:

```bash
# Analyze scans collection
node scripts/dedupeObservations.js --collection=scans --dry-run

# Analyze visits collection
node scripts/dedupeObservations.js --collection=visits --dry-run
```

This will show:

- Total records
- Records with/without `event_key`
- Duplicate groups found
- Sample records

**Review the output carefully before proceeding!**

### Step 2: Execute Deduplication

Once satisfied with the dry-run results:

```bash
# Deduplicate scans collection
node scripts/dedupeObservations.js --collection=scans --execute

# Deduplicate visits collection
node scripts/dedupeObservations.js --collection=visits --execute
```

### Step 3: Verify Results

After execution, check:

```javascript
// In MongoDB shell or Compass:

// Check scans collection
db.scans.countDocuments();
db.scans.countDocuments({ event_key: null });
db.scans.aggregate([
  { $group: { _id: "$event_key", count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
]);

// Check backup collection
db.scans_duplicates_backup.countDocuments();

// Same for visits
db.visits.countDocuments();
db.visits.countDocuments({ event_key: null });
```

## Expected Results

### Before Deduplication

```
Collection: scans
Total records: 20,543
With event_key: 12,000
Without event_key (legacy): 8,543
```

### After Backfill

```
Collection: scans
Total records: 20,543
With event_key: 20,543
Without event_key (legacy): 0
```

### After Duplicate Removal

```
Collection: scans
Total records: 18,234
Duplicate groups found: 87
Total duplicates removed: 2,309
```

## What Records Are Kept?

For each duplicate group, the script keeps:

- **Oldest record by createdAt**: This is the earliest observation, closest to source of truth
- If `createdAt` is missing, defaults to epoch (1970-01-01)

Removed records are backed up to `{collection}_duplicates_backup` with metadata:

- `_backup_reason`: "duplicate_event_key"
- `_backup_date`: Timestamp of backup
- `_kept_record_id`: ID of the record that was kept

## Troubleshooting

### "Missing required fields for event_key"

Some records may lack `id`, `userid`, `time`, or other fields needed to compute `event_key`. These will be skipped and logged.

**Solution**: Manually inspect these records and either:

- Fill in missing fields from `rawData`
- Delete if they're incomplete/corrupted
- Move to a `pending_identity` collection for review

### "Duplicate detected during backfill"

This means a computed `event_key` already exists in the collection, indicating a true duplicate that the sparse index missed.

**Solution**: This is expected! Phase 4 will handle removal. The script logs these for review.

### "E11000 duplicate key error"

If you see this during execution, it means the unique index is working correctly to prevent duplicate insertions.

**Solution**: This is a safety feature. The script will detect and handle this gracefully.

## Rollback Procedure

If deduplication produces unexpected results:

1. **Restore from backup collection**:

```javascript
// Copy backup records back to main collection
db.scans_duplicates_backup.find().forEach((doc) => {
  delete doc._backup_reason;
  delete doc._backup_date;
  delete doc._kept_record_id;
  db.scans.insertOne(doc);
});
```

2. **Clear event_keys** (optional, to re-run backfill):

```javascript
db.scans.updateMany(
  { event_key: { $ne: null } },
  { $set: { event_key: null } },
);
```

3. **Re-run deduplication** with adjusted logic if needed

## Impact on Downstream Collections

Deduplicating observations (scans/visits) does **not** affect:

- `people` collection (snapshots are already deduplicated by canonical_id)
- `companies` collection (deduplicated by canonical_id)
- `locations` collection (deduplicated by canonical_id)

The observation collections are the **source of truth** for raw webhook data. Snapshots are built from these observations and have their own deduplication logic via aliases and canonical IDs.

## Performance Considerations

- **Large collections**: For 20,000+ records, expect 5-10 minutes per collection
- **MongoDB load**: Runs multiple aggregations and updates - avoid during peak traffic
- **Backup size**: Backup collections will contain all removed duplicates (~10-20% of original size)

## Maintenance Recommendations

1. **Run monthly**: Check for new duplicates that may have appeared
2. **Monitor event_key coverage**: Ensure all new records have `event_key` set
3. **Review webhook handler**: Ensure idempotency logic is working (observationHandler.js:92-111)
4. **Clean backups**: After 30 days, archive or delete backup collections

## Testing

A test suite is available at `tests/dedupeObservations.test.js`:

```bash
npm test -- tests/dedupeObservations.test.js
```

This validates:

- `computeEventKey` logic matches production
- Duplicate detection works correctly
- Oldest record is kept
- Backups are created properly

## Questions?

For issues or questions:

1. Check logs in Winston output
2. Review backup collections before deleting
3. Test on a staging database first if available
4. Consult the codebase maintainer

## Related Files

- `scripts/dedupeObservations.js` - Main deduplication script
- `src/models/scan.js` - Scan schema (event_key field at line 82-86)
- `src/models/visit.js` - Visit schema (event_key field at line 100-104)
- `src/utils/eventKey.js` - Event key computation logic
- `src/controllers/observationHandler.js` - Webhook idempotency logic (lines 92-111)
