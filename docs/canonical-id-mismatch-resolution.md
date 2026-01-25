# Canonical ID Mismatch Resolution

## Issue Summary

You're seeing "Canonical ID mismatch" warnings in production logs because canonical IDs get "frozen" to whatever identifier was available in the first observation, even when better (more stable) identifiers become available later.

## Root Cause

DuxSoup webhooks don't always include all identifiers. The sequence typically goes:

1. **First observation** arrives with only username (no Sales Nav ID)
   - Person created with canonical_id based on username
   - Example: `canonical_id = UUIDv5("linkedInUsername:john-doe")`

2. **Later observation** arrives with Sales Nav ID
   - Sales Nav ID added as alias
   - Canonical ID based on Sales Nav ID computed: `UUIDv5("salesNavId:ACwAAAxxxxxx")`
   - **MISMATCH**: Existing canonical_id ≠ New canonical_id
   - Warning logged, but canonical_id NOT updated

**Result**: Person has Sales Nav ID in aliases, but canonical_id still based on less stable username.

## Analysis Results

Script: `scripts/analyze-canonical-id-mismatches.js`

```bash
node scripts/analyze-canonical-id-mismatches.js
```

**Findings:**
- **24,086 total people** in database
- **1,454 people (6.0%)** have mismatched canonical IDs
- **99.9% of mismatches** are people with Sales Nav ID, but canonical_id based on username
- **65.9% of people** have Sales Nav IDs available

## Solutions Provided

### 1. Migration Script (One-Time Fix)

**Purpose**: Fix all existing mismatched canonical IDs in the database.

**Script**: `scripts/migrate-canonical-ids.js`

**Usage**:
```bash
# Preview changes (dry run - default)
node scripts/migrate-canonical-ids.js

# Apply changes to database
node scripts/migrate-canonical-ids.js --execute

# Test with limited records
node scripts/migrate-canonical-ids.js --execute --limit=100
```

**What it does**:
1. Analyzes each person to find their best available identifier (highest priority)
2. Computes what the canonical_id SHOULD be
3. Updates person record if mismatch detected
4. Logs all changes

**Expected impact**:
- Will update ~1,454 person records
- Canonical IDs will reflect best available identifier (Sales Nav ID when available)
- Future observations will match correctly without warnings

### 2. Code Fix (Automatic Updates)

**Purpose**: Automatically update canonical_id when better identifiers are discovered going forward.

**File**: `src/services/identityResolverService.js`

**Changes**:
1. Added `shouldUpdateCanonicalId()` method to determine if canonical_id should be updated
2. Modified alias match scenario (lines 343-393) to update canonical_id when higher-priority identifier found
3. Modified merge winner scenario (lines 421-452) to update canonical_id when higher-priority identifier found

**Logic**:
```javascript
// Priority (higher = more stable)
salesNavId (5) > linkedInUsername (4) > profileUrl (3) > publicUrl (2) > duxsoupId (1)

// Decision flow
1. Find which alias created the existing canonical_id
2. Compare priority of that alias vs. incoming identifier
3. If incoming has higher priority → UPDATE
4. If incoming has lower/equal priority → KEEP EXISTING
```

**New log messages**:
```javascript
// When updating (INFO level)
"Updating canonical_id to higher-priority identifier"

// When keeping existing (WARN level)
"Canonical ID mismatch on alias match (keeping existing)"
```

### 3. Tests

All 16 integration tests passing:
```bash
npm run test:integration -- identityResolverService
```

The code changes include the new `shouldUpdateCanonicalId()` method which:
- Checks if incoming canonical_id is based on higher-priority identifier
- Compares against existing canonical_id by testing each alias
- Returns true only if update improves stability

## Recommended Action Plan

### Phase 1: Migration (Immediate)

1. **Dry run** the migration script to preview changes:
   ```bash
   node scripts/migrate-canonical-ids.js
   ```

2. Review the preview output to verify expected behavior

3. **Execute** the migration during low-traffic period:
   ```bash
   node scripts/migrate-canonical-ids.js --execute
   ```

4. Monitor logs to verify successful migration

### Phase 2: Monitor (Ongoing)

1. Deploy the code changes (already committed)

2. Monitor production logs for new messages:
   - **INFO**: "Updating canonical_id to higher-priority identifier" (expected, good)
   - **WARN**: "Canonical ID mismatch on alias match (keeping existing)" (rare, investigate if frequent)

3. The warnings should decrease significantly since:
   - Existing records fixed by migration
   - New records automatically updated when better IDs discovered

### Phase 3: Verification (1 week after migration)

1. Run analysis script again:
   ```bash
   node scripts/analyze-canonical-id-mismatches.js
   ```

2. Verify mismatch rate near 0%

3. Check logs for warning frequency (should be minimal)

## Technical Details

### Canonical ID Generation

Canonical IDs are UUIDv5 hashes generated from:
```javascript
canonical_key = `${type}:${value}`
canonical_id = UUIDv5(namespace + canonical_key)

// Examples:
"salesNavId:ACwAAABCDEF" → "7df6be1e-1d56-5972-be5a-ff092d87000d"
"linkedInUsername:john-doe" → "050918e1-be78-51a4-92ee-53cd42566bd9"
```

### Priority Waterfall

Identity resolution uses this priority order:
1. **Sales Navigator ID** - Most stable, never changes
2. **LinkedIn Username** - Stable across platforms
3. **Profile URL** - Can change
4. **Public URL / Recruiter Profile** - Less stable
5. **DuxSoup ID** - Last resort

### Why Canonical IDs Matter

Canonical IDs enable:
- Fast exact lookups without scanning aliases
- Deterministic identity across systems
- Deduplication based on stable identifiers
- Merge detection and resolution

When canonical IDs are based on unstable identifiers:
- Defeats the purpose of "canonical"
- Makes lookups less efficient
- Could lead to duplicate records

## Files Modified

1. `src/services/identityResolverService.js` - Added automatic canonical_id updating
2. `scripts/analyze-canonical-id-mismatches.js` - Analysis tool (new)
3. `scripts/migrate-canonical-ids.js` - Migration tool (new)
4. `docs/canonical-id-mismatch-resolution.md` - This documentation (new)

## Questions & Troubleshooting

### Q: Is it safe to run the migration on production?

Yes. The migration only updates the `canonical_id` field. It doesn't:
- Delete or modify observations
- Change aliases
- Affect snapshots
- Touch any other data

### Q: What if migration fails partway through?

The script processes records one at a time. If it fails:
1. Some records will be updated, others won't
2. Safe to re-run - it will update remaining mismatched records
3. No data loss or corruption risk

### Q: Will this affect existing API clients?

Minimal impact:
- Person `_id` doesn't change
- Aliases remain the same
- Only `canonical_id` field updates

If clients search by canonical_id:
- After migration, they should use the NEW canonical_id
- The NEW canonical_id is based on the person's most stable identifier

### Q: Why not update canonical_id on every observation?

Too aggressive - would cause unnecessary churn:
- Canonical_id should be relatively stable
- Only update when we find a BETTER identifier
- Don't update when new identifier is same/lower priority

## Monitoring Queries

### Find people with Sales Nav ID but username-based canonical_id

```javascript
// This query would be complex - use the analysis script instead
node scripts/analyze-canonical-id-mismatches.js
```

### Count canonical_id mismatches

```bash
node scripts/analyze-canonical-id-mismatches.js | grep "Mismatched canonical IDs:"
```

## References

- Identity Resolution Docs: `docs/identity-resolution-summary.md`
- Identity Matcher: `src/utils/identityMatcher.js`
- Identity Resolver: `src/utils/identityResolver.js`
- Service Layer: `src/services/identityResolverService.js`
