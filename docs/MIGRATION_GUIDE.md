# Migration Guide: Identity Resolution Updates

**Date:** 2026-01-26
**Version:** 2.0
**Impact:** Medium (requires backfill, but backward compatible)

---

## 🎯 Overview

This migration updates the identity resolution system to:
- ✅ Extract salesNavId from URLs (case-insensitive)
- ✅ Use case-insensitive DB queries for salesNavId matching
- ✅ Extract numeric LinkedIn member IDs
- ✅ Normalize salesNavIds to canonical case
- ✅ Detect username conflicts

**No breaking changes** - the system is backward compatible with existing data.

---

## 📋 Migration Steps

### Step 1: Verify Tests (Already Done ✅)

All 88 tests passing:
```bash
# Unit tests (salesNavIdExtractor)
npm test -- src/__tests__/salesNavIdExtractor.test.js
# ✅ 49 tests passing

# Integration tests (profileMatcher)
npx jest --config=jest.config.integration.js src/__tests__/profileMatcher.integration.test.js
# ✅ 17 tests passing

# Existing tests (identityMatcher)
npm test -- __tests__/utils/identityMatcher.test.js
# ✅ 22 tests passing
```

---

### Step 2: Backup Database

**CRITICAL:** Backup your MongoDB database before running backfill scripts.

```bash
# Create backup
mongodump --uri="${MONGO_URI}" --out=./backups/pre-identity-migration-$(date +%Y%m%d)

# Verify backup
ls -lh ./backups/
```

---

### Step 3: Run Backfill Script (Dry Run)

Test the backfill without making changes:

```bash
node scripts/backfill-salesnavid-extraction.js --dry-run --limit=100
```

**Expected output:**
```
═══════════════════════════════════════════════════════════
Backfill: Extract salesNavId from URL Aliases
═══════════════════════════════════════════════════════════
Mode: DRY RUN (no changes)
Limit: 100 records

✓ Connected to MongoDB

Found 1,234 people with URL aliases to process

  [person-1] Extracted salesNavId: ACwAAA123...
  [person-2] Normalized salesNavId: acwaaa456 → ACwAAA456...
  [person-3] Update canonical_id: uuid-old → uuid-new...

Progress: 100/100 (100%)

═══════════════════════════════════════════════════════════
Backfill Complete
═══════════════════════════════════════════════════════════
Processed:              100
salesNavId extracted:   45
salesNavId normalized:  12
numericId extracted:    38
canonical_id updated:   50
Potential duplicates:   2
Errors:                 0

ℹ️  DRY RUN - No changes were made to the database
```

---

### Step 4: Run Backfill Script (Live)

If dry run looks good, run the full backfill:

```bash
# Process all records
node scripts/backfill-salesnavid-extraction.js

# OR process in batches
node scripts/backfill-salesnavid-extraction.js --limit=1000
```

**Monitor for:**
- ⚠️ **Potential duplicates:** Review these manually before merging
- ✗ **Errors:** Investigate and fix data issues

---

### Step 5: Identify Duplicates

Find people with case-insensitive salesNavId duplicates:

```bash
# Identify only (no changes)
node scripts/identify-salesnavid-duplicates.js
```

**Expected output:**
```
═══════════════════════════════════════════════════════════
Identify Duplicate People by salesNavId
═══════════════════════════════════════════════════════════
Mode: IDENTIFY ONLY

Found 10,000 people with salesNavId

═══════════════════════════════════════════════════════════
Found 5 duplicate groups
Total duplicate records: 8
═══════════════════════════════════════════════════════════

Group 1/5:
  salesNavId: ACwAAA123
  Duplicates: 2 people

    [1] person-abc
        salesNavId: ACwAAA123
        username: johndoe
        observations: 5 visits, 2 scans
        canonical_id: uuid-abc

    [2] person-xyz
        salesNavId: acwaaa123
        username: johndoe
        observations: 3 visits, 1 scans
        canonical_id: uuid-xyz

    → Would merge into: person-abc (more observations)
```

---

### Step 6: Merge Duplicates (Optional)

If you're confident, auto-merge duplicates:

```bash
# Review the merge logic first
node scripts/identify-salesnavid-duplicates.js

# Then merge
node scripts/identify-salesnavid-duplicates.js --auto-merge
```

**Merge logic:**
1. Prefers person with salesNavId in canonical case (ACwAAA)
2. Prefers person with most observations
3. Prefers most recently updated
4. Lexical tie-breaker

---

### Step 7: Verify Results

```bash
# Check salesNavId coverage
node -e "
const mongoose = require('mongoose');
const Person = require('./src/models/person');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const total = await Person.countDocuments();
  const withSalesNavId = await Person.countDocuments({ 'aliases.type': 'salesNavId' });
  const withNumericId = await Person.countDocuments({ 'aliases.type': 'numericId' });

  console.log('People with salesNavId:', withSalesNavId, '/', total, '(' + Math.round(withSalesNavId/total*100) + '%)');
  console.log('People with numericId:', withNumericId, '/', total, '(' + Math.round(withNumericId/total*100) + '%)');

  await mongoose.disconnect();
  process.exit(0);
});
"
```

---

### Step 8: Deploy Code Changes

Once backfill is complete, deploy the updated code to production.

**Files changed:**
- `src/utils/identityMatcher.js` - Uses new extractor
- `src/services/identityResolverService.js` - Case-insensitive queries

**No breaking changes** - backward compatible with old data.

---

## 🔍 Validation Queries

### Check for Case-Insensitive Duplicates

```javascript
// MongoDB query
db.people.aggregate([
  { $unwind: '$aliases' },
  { $match: { 'aliases.type': 'salesNavId' } },
  {
    $group: {
      _id: { $toLower: '$aliases.value' },
      people: { $addToSet: '$_id' },
      count: { $sum: 1 },
    },
  },
  { $match: { count: { $gt: 1 } } },
]);
```

### Check salesNavId Extraction Coverage

```javascript
// People with URL aliases but no salesNavId
db.people.countDocuments({
  $and: [
    { 'aliases.type': { $ne: 'salesNavId' } },
    {
      $or: [
        { 'aliases.type': 'salesUrl' },
        { 'aliases.type': 'recruiterUrl' },
        { 'aliases.type': 'profileUrl' },
      ],
    },
  ],
});
```

### Check Canonical ID Updates

```javascript
// Count canonical_ids that need updating
db.people.aggregate([
  { $match: { 'aliases.type': 'salesNavId' } },
  {
    $project: {
      salesNavId: {
        $arrayElemAt: [
          {
            $filter: {
              input: '$aliases',
              cond: { $eq: ['$$this.type', 'salesNavId'] },
            },
          },
          0,
        ],
      },
      canonical_id: 1,
    },
  },
]);
```

---

## ⚠️ Potential Issues

### Issue 1: Username Conflicts

**Symptom:** Script reports "CONFLICT: Existing salesNavId differs from extracted"

**Cause:** Same username was used by different people (username recycled)

**Resolution:** These are legitimately different people. Do NOT merge them.

**Action:** Review manually and confirm they are different people.

---

### Issue 2: Partial Extractions

**Symptom:** Some URLs have salesNavIds but extraction fails

**Cause:** Unexpected URL format not covered by regex

**Resolution:** Add new URL pattern to `extractSalesNavIdFromUrl()`

**Action:**
1. Log the failing URL
2. Update regex pattern if needed
3. Re-run backfill

---

### Issue 3: Canonical ID Conflicts

**Symptom:** canonical_id changes for many records

**Cause:** Priority changed (salesNavId now highest priority)

**Expected:** This is correct behavior. salesNavId should be the primary identifier.

**Action:** No action needed. This is an improvement.

---

## 📊 Expected Impact

| Metric | Before | After | Notes |
|--------|--------|-------|-------|
| salesNavId coverage | ~60% | ~95% | Extracted from URLs |
| numericId coverage | 0% | ~70% | New identifier type |
| Case sensitivity errors | ~15% | ~0% | Fixed by case-insensitive queries |
| Duplicate rate | ~5% | ~0.5% | Reduced by better matching |
| Username conflicts detected | 0 | ~50 | Prevents false merges |

---

## 🔄 Rollback Plan

If issues arise, rollback using the backup:

```bash
# Restore from backup
mongorestore --uri="${MONGO_URI}" --drop ./backups/pre-identity-migration-YYYYMMDD

# Verify restoration
mongo ${MONGO_URI} --eval "db.people.countDocuments()"
```

**Code rollback:** Revert the Git commits and redeploy.

---

## ✅ Post-Migration Checklist

- [ ] Database backed up
- [ ] Dry run completed successfully
- [ ] Backfill completed (salesNavIds extracted)
- [ ] Duplicates identified and reviewed
- [ ] Optional: Duplicates merged
- [ ] Validation queries run
- [ ] Code deployed to production
- [ ] No increase in error rates
- [ ] Duplicate rate decreased

---

## 📞 Support

If you encounter issues:
1. Check the validation queries above
2. Review logs for error patterns
3. Run dry-run mode again to see what would change
4. Contact the team for assistance

---

**Migration prepared by:** Identity Resolution Team
**Last updated:** 2026-01-26
