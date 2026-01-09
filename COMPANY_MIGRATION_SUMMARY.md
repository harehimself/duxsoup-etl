# Company ID Migration Summary

**Date:** 2026-01-09
**Total Companies:** 2,717

## Current State

After changing the company model to require numeric LinkedIn company IDs, **79.6% of existing companies have invalid IDs**.

### Breakdown:

| Category                          | Count | Percentage | Status                             |
| --------------------------------- | ----- | ---------- | ---------------------------------- |
| ✅ Already numeric                | 555   | 20.4%      | **Valid** - no action needed       |
| 🔄 Can migrate (extract from URL) | 1,883 | 69.3%      | **Can fix** with migration script  |
| ⚠️ Cannot migrate (company names) | 279   | 10.3%      | **Problem** - will fail validation |

## What the Migration Script Does

### ✅ Migrates (1,883 companies)

Extracts numeric ID from LinkedIn company URLs:

```
"linkedin.com/company/314350" → "314350" (Qualtrics)
"linkedin.com/company/49697"  → "49697"  (Medallia)
"linkedin.com/company/4728"   → "4728"   (NICE)
```

**Process:**

1. Creates backup collection (`companies_backup_[timestamp]`)
2. Extracts numeric ID from URL
3. Creates new company record with numeric `_id`
4. Adds old URL to `aliases` array (preserves identity)
5. Deletes old record

### ⚠️ Cannot Migrate (279 companies)

These companies have **company names** as their `_id` (no LinkedIn URL available):

```
"Chris Bogue Communications"
"Go Red For Women"
"nEdra gUnn"
"TGW Sales Ops Consulting"
"Auntie's Sweet Chocolates"
```

**Problem:** These will **FAIL model validation** if you try to update them!

## Recommended Action Plan

### ✅ Selected Option: Run Migration + Delete Invalid Records

**Step 1:** Run migration script with deletion

```bash
node scripts/migrateCompanyIds.js --execute --delete-invalid
```

This will:

- Migrate 1,883 companies (extract numeric ID from URL)
- Skip 555 companies (already numeric)
- **Delete 279 companies** (no numeric ID available)

**Result:**

- Total companies after: 2,438 (100% with numeric IDs)
- All remaining companies will pass validation
- No legacy records to maintain

### Alternative Options (Not Used)

#### Option 1: Keep Legacy Records (Not Recommended)

Run migration without deletion, then relax validation to accept non-numeric IDs for legacy records.

```bash
node scripts/migrateCompanyIds.js --execute
```

**Downside:** Need to maintain legacy validation and gradually fix 279 companies manually.

#### Option 2: Migration Only

Run migration but keep invalid records in database (they become read-only).

**Downside:** 279 companies will fail validation if touched by any code.

## Running the Migration

### Preview Changes (Dry Run)

**Without deletion:**

```bash
node scripts/migrateCompanyIds.js --dry-run
```

**With deletion:**

```bash
node scripts/migrateCompanyIds.js --dry-run --delete-invalid
```

### Execute Migration

**Without deletion (keep invalid records):**

```bash
node scripts/migrateCompanyIds.js --execute
```

**With deletion (recommended):**

```bash
node scripts/migrateCompanyIds.js --execute --delete-invalid
```

### What Happens:

1. ✅ Creates backup: `companies_backup_[timestamp]`
2. 🔄 Migrates 1,883 companies (extract numeric ID from URL)
3. ⏭️ Skips 555 companies (already numeric)
4. 🗑️ Deletes 279 companies (no numeric ID) **if --delete-invalid flag is used**

### Rollback (If Needed)

```javascript
// In MongoDB shell:
db.companies.drop();
db.companies_backup_[timestamp].find().forEach(function (doc) {
  db.companies.insert(doc);
});
```

## After Migration

### Expected Results:

**Without --delete-invalid flag:**

```
Total companies: 2,717
✅ Numeric IDs: 2,438 (89.7%)
⚠️ Non-numeric IDs: 279 (10.3%)
```

**With --delete-invalid flag (recommended):**

```
Total companies: 2,438
✅ Numeric IDs: 2,438 (100%)
⚠️ Non-numeric IDs: 0 (0%)
```

## Impact Assessment

### ✅ Safe to Migrate:

- Migration creates automatic backup
- Only changes `_id` format (extracts from URL)
- Preserves all data
- Adds old URL to aliases (no data loss)

### ⚠️ Data Loss (with --delete-invalid):

- **279 companies** will be permanently deleted (10.3% of total)
- These companies have no numeric LinkedIn ID (only company names)
- Backup collection will preserve the deleted records

### ✅ After Migration (with --delete-invalid):

- **100%** of companies will have proper numeric IDs
- No validation failures on existing records
- New company upserts will use numeric IDs automatically
- Cross-platform company matching will work correctly

## Files

- **Check script:** `scripts/checkCompanyIds.js`
- **Migration script:** `scripts/migrateCompanyIds.js`
- **Model:** `src/models/company.js`

## Next Steps

1. ✅ **Script completed** - Deletion logic implemented
2. ✅ **Dry-run tested** - Both flags work correctly
3. **Ready to execute**: `node scripts/migrateCompanyIds.js --execute --delete-invalid`
4. **Verify results**: `node scripts/checkCompanyIds.js`

---

**Status:** ✅ Migration Script Complete (Ready to Execute)
**Recommended:** `--execute --delete-invalid` (Delete invalid companies)
**Risk Level:** Low (automatic backup created, reversible)
