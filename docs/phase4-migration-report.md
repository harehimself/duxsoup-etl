# Phase 4: URL-based Person _id Migration Report

## Executive Summary

**Date:** 2026-02-01
**Database:** duxsoup
**Total URL-based people:** 750

## Dry-Run Analysis Results (First 50 people)

### Statistics

| Category | Count | Percentage |
|----------|-------|------------|
| Can migrate to stable ID | 30 | 60% |
| Need merge with existing | 4 | 8% |
| Must keep URL-based ID | 16 | 32% |
| **Total analyzed** | **50** | **100%** |

### Projected Results (All 750 people)

Based on the sample analysis, if the pattern holds:

| Category | Projected Count |
|----------|-----------------|
| Can migrate to stable ID | ~450 |
| Need merge with existing | ~60 |
| Must keep URL-based ID | ~240 |

### Key Findings

1. **60% Can Migrate:** 30 out of 50 people have extractable Sales Navigator IDs from their observation data, allowing clean migration to stable IDs.

2. **8% Need Merge:** 4 out of 50 people have stable IDs that already exist in the people collection, indicating these are duplicates that need to be merged.

3. **32% Must Keep URL:** 16 out of 50 people have no stable IDs in their observations (only usernames), so they must remain URL-based.

### Sample Cases

#### Case 1: Clean Migration (60%)
```
Current ID: linkedin.com/in/aarurkar
Sales Nav ID: ACoAAAHKNmgBnj9N7DAJCGTyp02xQFSZfvkkhZI
Action: MIGRATE
→ New _id: ACoAAAHKNmgBnj9N7DAJCGTyp02xQFSZfvkkhZI
```

#### Case 2: Merge Required (8%)
```
Current ID: linkedin.com/in/adam-j-clark-2b027236
Sales Nav ID: ACoAAAeDfiQBqi8xoex0IDhndoklIRXmXNmzT38
Action: MERGE
Reason: Person with _id=ACoAAAeDfiQBqi8xoex0IDhndoklIRXmXNmzT38 already exists
→ Merge URL-based person into existing stable-ID person
```

#### Case 3: Keep URL-based (32%)
```
Current ID: linkedin.com/in/abbottluke
Sales Nav ID: (none)
Numeric ID: (none)
Username: abbottluke
Action: KEEP_URL
Reason: No stable ID found in observations
→ Remains as linkedin.com/in/abbottluke
```

## Migration Process

### Phase 1: Add Aliases (Dry-Run)
- Extract stable IDs from observations
- Add salesNavId/numericId/username to aliases array
- No destructive changes

### Phase 2: Migrate & Merge (Execution)

#### For "MIGRATE" cases:
1. Create new person document with stable _id
2. Update Change references
3. Update DeadLetter references
4. Delete old URL-based person

#### For "MERGE" cases:
1. Merge aliases arrays (deduplicate)
2. Merge observations arrays
3. Merge snapshot fields (prefer non-empty)
4. Update Change references
5. Update DeadLetter references
6. Delete URL-based duplicate

#### For "KEEP_URL" cases:
- No action needed (aliases already added)

## Technical Details

### Database Connection
- **Issue Found:** Mongoose was connecting to "test" database by default
- **Solution:** Modified connection string to explicitly specify "duxsoup" database
- **Fix:** `const uri = process.env.MONGODB_URI.replace('/?', '/duxsoup?');`

### ID Extraction Priority
1. **Sales Navigator ID** (from Profile URL miniProfileUrn parameter)
2. **Numeric ID** (from scan.id field, format: "id.123456789")
3. **Username** (from scan.id field, format: "pid.username")

### Query Pattern
- **Pattern:** `{ _id: /\// }`
- **Logic:** Any _id containing "/" is URL-based
- **Matches:** "linkedin.com/in/username"
- **Excludes:** Stable IDs (ACwAAA..., numeric IDs, usernames)

## Risk Assessment

### Low Risk
- Dry-run mode tested successfully
- Transactional updates (all-or-nothing)
- Aliases added before migration
- No data loss (URL preserved in aliases)

### Medium Risk
- 8% of cases require merging duplicates
- Need to verify merge logic preserves all data

### Mitigation
- Start with batch of 50 people
- Verify results before processing all 750
- Keep URL-based _id in aliases array for rollback

## Recommendations

1. **Execute on first 50 people** to validate migration logic
2. **Verify merged records** to ensure no data loss
3. **Check Change/DeadLetter references** are updated correctly
4. **Monitor for errors** during execution
5. **Proceed with remaining 700** after validation

## Execution Command

```bash
# Dry-run (analysis only)
node scripts/phase4-migrate-url-based-ids.js --dry-run --limit=50

# Execute migration on first 50
node scripts/phase4-migrate-url-based-ids.js --limit=50

# Execute full migration (all 750)
node scripts/phase4-migrate-url-based-ids.js
```

## Expected Outcome

After successful migration of all 750 people:
- ~450 people migrated to stable IDs
- ~60 duplicates merged into existing records
- ~240 people remain URL-based (no stable ID available)
- **Net reduction:** ~510 URL-based IDs eliminated
- **Remaining URL-based:** ~240 (down from 750)

## Next Steps

1. Execute migration on first 50 people
2. Validate results:
   - Check migrated person records
   - Verify merged duplicates
   - Confirm Change/DeadLetter references
3. If successful, proceed with remaining 700 people
4. Document final statistics
5. Update architecture docs with new ID distribution
