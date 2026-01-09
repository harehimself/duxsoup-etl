# Identity Matcher Integration

## Overview

As of 2026-01-09, **all webhook processing now uses the centralized identity matching logic** from `src/utils/identityMatcher.js`.

This integration ensures that all future extractions (scans, visits, and person upserts) use the same waterfall identity matching strategy that was developed during the deduplication project.

## What Changed

### Before Integration

Previously, the system had **two different identity resolution strategies**:

1. **`src/utils/identityResolver.js`** - Used by webhook processing

   - Priority: Sales Nav ID → Numeric ID → Public Profile URL
   - Did NOT extract LinkedIn usernames from Profile URLs
   - Could NOT match cross-platform scans (Sales Nav vs Regular LinkedIn)

2. **`scripts/mergeScans.js`** - Used by deduplication scripts
   - Custom identity logic in each script
   - Inconsistent behavior across different tools

This inconsistency meant that:

- ❌ Same person scanned from Sales Nav and Regular LinkedIn = treated as duplicates
- ❌ Deduplication scripts used different logic than webhook processing
- ❌ LinkedIn username extraction was duplicated in multiple places

### After Integration

Now the system has **one centralized identity matcher**:

- ✅ `src/utils/identityMatcher.js` - Single source of truth for all identity resolution
- ✅ `src/utils/identityResolver.js` - Updated to use identityMatcher internally (backward compatibility)
- ✅ All webhook processing uses the new waterfall priority
- ✅ Deduplication scripts and webhooks use identical logic

## New Waterfall Priority

The integrated system now uses this priority order:

```
Priority 1: LinkedIn Username
  ├─ Extracted from Profile URLs (/in/username)
  ├─ Extracted from pid.username DuxSoup IDs
  ├─ Works across Sales Nav AND Regular LinkedIn
  └─ Filters out Sales Nav IDs (ACwAAA/ACoAAA patterns)

Priority 2: Sales Navigator ID
  ├─ Extracted from SalesProfile, Profile, PublicProfile, RecruiterProfile
  ├─ Pattern: ACwAAA* or ACoAAA*
  └─ Very stable, but only available in Sales Nav scans

Priority 3: Normalized Profile URL
  └─ Fallback for profiles without custom usernames

Priority 4: Public Profile / Recruiter Profile
  └─ Rare fallback

Priority 5: DuxSoup ID
  └─ Last resort (changes between scan sources: id.XXX vs pid.XXX)
```

### Key Improvement: LinkedIn Username Priority

**Why LinkedIn username is now Priority 1:**

Before:

```javascript
// Sales Nav scan
{ SalesProfile: ".../ACwAAA123", id: "id.19022018" }
→ person_id: "ACwAAA123"

// Regular LinkedIn scan (SAME PERSON)
{ Profile: "linkedin.com/in/john-doe", id: "pid.john-doe" }
→ person_id: "linkedin.com/in/john-doe"

Result: Treated as different people ❌
```

After:

```javascript
// Sales Nav scan WITH username in URL
{ SalesProfile: ".../ACwAAA123", Profile: "linkedin.com/in/john-doe" }
→ person_id: "john-doe"

// Regular LinkedIn scan (SAME PERSON)
{ Profile: "linkedin.com/in/john-doe", id: "pid.john-doe" }
→ person_id: "john-doe"

Result: Correctly identified as same person ✅
```

## Integration Points

### 1. Webhook Processing (observationHandler.js)

**File:** `src/controllers/observationHandler.js`

The webhook handler already uses `identityResolver.js`, which now internally uses `identityMatcher.js`:

```javascript
// Line 177 in observationHandler.js
const identityHints = resolvePersonIdentity(payload);
// ↓
// Calls identityResolver.resolvePersonIdentity()
// ↓
// Which now calls identityMatcher.extractIdentifiers() + getPrimaryIdentifier()
```

**No changes needed** - automatic integration through identityResolver.js.

### 2. Person Upsert (personController.js)

**File:** `src/controllers/personController.js`

Person upserts use the same flow:

```javascript
// Line 223 in personController.js
const identity = resolvePersonIdentity(webhookData);
// ↓
// Uses identityResolver.resolvePersonIdentity()
// ↓
// Now uses centralized identityMatcher.js internally
```

**No changes needed** - automatic integration.

### 3. Deduplication Scripts

**Files:**

- `scripts/mergeScans.js`
- `scripts/dedupeObservations.js`
- `scripts/analyzeDuplicates.js`

All scripts directly import and use `identityMatcher.js`:

```javascript
const {
  extractIdentifiers,
  getPrimaryIdentifier,
} = require("../src/utils/identityMatcher");

const identifiers = extractIdentifiers(scan);
const primary = getPrimaryIdentifier(identifiers);
```

**Already using centralized logic** - created during deduplication project.

## Testing

### Test Coverage

All identity matching logic is tested:

1. **`__tests__/utils/identityMatcher.test.js`** - 22 tests ✅

   - Username extraction (including pid format)
   - Sales Nav ID extraction
   - Sales Nav ID filtering (not treated as username)
   - Waterfall priority logic
   - Identity key generation
   - Same-person comparison

2. **`src/__tests__/identityResolver.test.js`** - 30 tests ✅
   - Backward compatibility with existing code
   - Integration with identityMatcher.js
   - All waterfall priority scenarios
   - Canonical ID generation

### Running Tests

```bash
# Test centralized identity matcher
npm test -- __tests__/utils/identityMatcher.test.js

# Test backward compatibility wrapper
npm test -- src/__tests__/identityResolver.test.js

# Run all tests
npm test
```

## Migration Status

### ✅ Completed

- [x] Created centralized identity matcher (`src/utils/identityMatcher.js`)
- [x] Integrated into `src/utils/identityResolver.js` for backward compatibility
- [x] Updated all tests to reflect new waterfall priority
- [x] All deduplication scripts use centralized logic
- [x] All webhook processing uses centralized logic (via identityResolver)
- [x] Comprehensive test coverage (52 tests total)

### ⚠️ Known Behavioral Change

**Test expectations updated** to reflect new priority:

Old behavior (before integration):

- Sales Nav ID was always Priority 1
- LinkedIn username was NOT extracted from Profile URLs
- Cross-platform matching was impossible

New behavior (after integration):

- LinkedIn username is Priority 1 (if available)
- Sales Nav ID is Priority 2 (if no username)
- Cross-platform matching works for profiles with usernames
- Sales Nav IDs in /in/ URLs are filtered out (not treated as usernames)

**Impact:** Future webhook processing will match more duplicates correctly.

## Benefits of Integration

### 1. Consistency

✅ All parts of the system use identical identity resolution logic
✅ No surprises between webhook processing and deduplication scripts

### 2. Cross-Platform Matching

✅ Same person scanned from Sales Nav and Regular LinkedIn = correctly identified
✅ Reduces duplicate person records by ~20% (based on deduplication analysis)

### 3. Maintainability

✅ Single source of truth for identity logic
✅ Future changes only need to be made in one place
✅ Comprehensive test coverage ensures correctness

### 4. Data Quality

✅ LinkedIn username is more stable than DuxSoup ID
✅ Sales Nav IDs correctly filtered from username extraction
✅ Better alias collection for People snapshots

## Usage for New Code

When writing new code that needs identity resolution:

### Option 1: Direct Use (Recommended for new code)

```javascript
const {
  extractIdentifiers,
  getPrimaryIdentifier,
} = require("../utils/identityMatcher");

async function processWebhook(data) {
  const identifiers = extractIdentifiers(data);
  const primary = getPrimaryIdentifier(identifiers);

  if (!primary) {
    // No identifier found
    return null;
  }

  const key = `${primary.type}:${primary.value}`;
  // Use key for deduplication...
}
```

### Option 2: Via identityResolver (For backward compatibility)

```javascript
const { resolvePersonIdentity } = require("../utils/identityResolver");

async function processWebhook(data) {
  const identity = resolvePersonIdentity(data);

  if (!identity.person_id) {
    // No identifier found
    return null;
  }

  // Use identity.person_id, identity.canonical_id, etc.
}
```

Both approaches now use the same underlying logic from `identityMatcher.js`.

## Rollback Plan

If issues are discovered with the new waterfall priority:

1. **Immediate Fix:** Update `identityMatcher.js` priority order in `getPrimaryIdentifier()` function
2. **Tests:** Update both test files to match new expectations
3. **Verify:** Run all tests to ensure no regressions

The centralized architecture makes rollback or adjustments much easier than the old distributed logic.

## Future Improvements

### 1. Graph-Based Transitive Matching

**Current limitation:** If A matches B, and B matches C, but A and C share no identifier, they're treated as different people.

**Future enhancement:** Implement transitive matching in People collection:

- Build identity graph
- Connect nodes that share any identifier
- Merge all nodes in connected component

### 2. Name Similarity Matching

**Current limitation:** Name changes create multiple "unique" people (e.g., Tricia Kumar → Tricia Marren after marriage)

**Future enhancement:** Add fuzzy name matching as final fallback:

- Use Levenshtein distance or similar algorithm
- Only match if Company + Location also match (avoid false positives)
- Require manual review before merging

### 3. Identity Key Index

**Current state:** `identity_key` field exists but not indexed in all collections

**Future enhancement:** Backfill and index:

```bash
node scripts/backfillIdentityKeys.js
```

Then add indexes:

```javascript
db.people.createIndex({ identity_key: 1 }, { unique: true, sparse: true });
db.scans.createIndex({ identity_key: 1 });
db.visits.createIndex({ identity_key: 1 });
```

## Related Documentation

- [Identity Matching Guide](./IDENTITY_MATCHING.md) - Complete guide to centralized utility
- [Deduplication Summary](../DEDUPLICATION_SUMMARY.md) - Overview of deduplication project
- [Deduplication Guide](./DEDUPLICATION_GUIDE.md) - User guide for running scripts

## Questions?

For implementation questions or issues:

1. Check test files for usage examples
2. Review `scripts/mergeScans.js` for real-world usage
3. Run tests to validate behavior: `npm test`
4. Consult this documentation

---

**Last Updated:** 2026-01-09
**Status:** ✅ Integrated and Tested
**Test Coverage:** 52 tests passing
**Backward Compatible:** Yes
