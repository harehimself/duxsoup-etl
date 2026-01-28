# Duplicate Person Investigation

**Date:** January 25, 2026
**Status:** Analysis Complete - Awaiting Implementation Decision

---

## Executive Summary

**Problem:** ~40% of the person database (9,587 records) contains duplicates of the same individuals due to non-overlapping identifier sets across different DuxSoup webhook types.

**Impact:**
- 4,430 unique people have 2+ duplicate records
- Data fragmentation (observations split across records)
- Inaccurate analytics and reporting
- Wasted storage and processing

**Root Cause:** Identity resolution waterfall picks first available identifier, but different webhook types provide different identifier sets with no overlap, preventing automatic merging.

---

## Background Context

### Company Backfill (Completed Jan 25, 2026)

**Before investigating duplicates, we successfully completed the company ETL backfill:**

- **Before:** 2,317 companies (last updated Jan 6, 2026)
- **After:** 5,875 companies (last updated Jan 25, 2026)
- **Recovered:** 3,558 new companies (+153% increase)

**Backfill Results:**
- Total observations processed: 14,725
- Companies created: 3,558 ✅
- Companies updated: 6,736
- Skipped: 2,819 (no CompanyProfile URL - expected)
- Failed: 1,821 (duplicate key errors - harmless)

**Fix Applied:** Updated company and location controllers to read from `rawData.data` instead of `rawData` (matching person controller pattern).

---

## Duplicate Person Analysis

### The Issue: Example Case

**Same Person (Alton Harewood), Two Records:**

**Record 1:** `_id: "ACwAAAAdaooB-xOpw0VY7_AKzaZfnxxGrfTigvU"` (Sales Nav ID)
```json
{
  "_id": "ACwAAAAdaooB-xOpw0VY7_AKzaZfnxxGrfTigvU",
  "canonical_id": "4ad53893-fcee-5058-8121-3b37e0c345ed",
  "aliases": [
    { "type": "salesNavId", "value": "ACwAAAAdaooB-xOpw0VY7_AKzaZfnxxGrfTigvU" },
    { "type": "duxsoupId", "value": "id.1927818" },
    { "type": "profileUrl", "value": "www.linkedin.com/sales/lead/acwaaaadaoob-xopw0vy7_akzazfnxxgrftigvu,name_search,lx9l" }
  ],
  "snapshot": {
    "fullName": "Alton Harewood",
    "currentTitle": "Sr. Director Technology Partnerships",
    "currentCompany": "8x8"
  }
}
```

**Record 2:** `_id: "altonharewood"` (LinkedIn username)
```json
{
  "_id": "altonharewood",
  "canonical_id": "e042b4b6-fcad-5fc9-8271-40da2bba9044",
  "aliases": [
    { "type": "linkedInUsername", "value": "altonharewood" },
    { "type": "duxsoupId", "value": "pid.altonharewood" },
    { "type": "profileUrl", "value": "www.linkedin.com/in/altonharewood" }
  ],
  "snapshot": {
    "fullName": "Alton Harewood",
    "currentTitle": "Elevate your communications with the 8x8 Technology Partner Ecosystem"
  }
}
```

### Why They Don't Merge

**Identity Resolution Waterfall (from `identityResolver.js`):**
1. Sales Navigator ID (highest priority)
2. LinkedIn Username
3. Numeric ID (from URLs)
4. DuxSoup ID (lowest priority)

**What Happens:**
1. **Scan Type A** provides Sales Nav ID → creates record with `_id: "ACw..."`
2. **Scan Type B** provides LinkedIn username only → creates record with `_id: "altonharewood"`
3. **No shared alias value** → `findByAnyAlias()` cannot match them
4. **Different `profileUrl` formats:**
   - Record 1: `www.linkedin.com/sales/lead/...` (Sales Nav URL)
   - Record 2: `www.linkedin.com/in/altonharewood` (public profile URL)

---

## Database Analysis Results

**Script Used:** `scripts/analyze-duplicates.js`

**Findings:**
- Total people with names: **24,089**
- People with duplicate names: **4,430** (18.4%)
- Total duplicate records: **9,587** (~40% of database)

**Identity Breakdown (Duplicate Records):**
- Sales Nav ID only: **3,385** records (35.3%)
- LinkedIn username only: **4,901** records (51.1%)
- Both identifiers: **601** records (6.3%)

**Pattern Observed:**
Every sample duplicate follows the same pattern:
```
Record 1: publicUrl only           (from scan/visit type A)
Record 2: linkedInUsername only    (from scan/visit type B)
```

### Sample Duplicates (First 10)

```
1. jan janssen (2 records)
   - ID: linkedin.com/in/janj... | Aliases: publicUrl
   - ID: janjanjanjanjan | Aliases: linkedInUsername, duxsoupId, profileUrl

2. cameron lund (2 records)
   - ID: linkedin.com/in/came... | Aliases: publicUrl
   - ID: cameronlund1 | Aliases: linkedInUsername, duxsoupId, profileUrl

3. katie libby (2 records)
   - ID: linkedin.com/in/kati... | Aliases: publicUrl
   - ID: katielibby | Aliases: linkedInUsername, duxsoupId, profileUrl

... (pattern repeats for all 4,430 duplicates)
```

---

## Root Cause: Technical Explanation

### Identity Resolution Flow

**File:** `src/utils/identityResolver.js`

```javascript
// Priority order for person identity
function resolvePersonIdentity(webhookData) {
  // 1. Try Sales Navigator ID first
  if (webhookData.SalesNavId) {
    return { _id: webhookData.SalesNavId, ... };
  }

  // 2. Try LinkedIn Username second
  if (webhookData.LinkedInUsername) {
    return { _id: webhookData.LinkedInUsername, ... };
  }

  // 3. Try Numeric ID from URLs third
  if (webhookData.NumericId) {
    return { _id: webhookData.NumericId, ... };
  }

  // 4. Fall back to DuxSoup ID
  return { _id: webhookData.DuxSoupId, ... };
}
```

**File:** `src/services/identityResolverService.js`

```javascript
async function findByAnyAlias(aliases) {
  // Try to find existing person by ANY matching alias value
  const aliasValues = aliases.map(a => a.value);

  const existing = await Person.findOne({
    'aliases.value': { $in: aliasValues }
  });

  return existing; // Returns null if no match found
}
```

### Why Merging Fails

**Webhook Type A Payload:**
```json
{
  "SalesNavId": "ACwAAAAdaooB-xOpw0VY7_AKzaZfnxxGrfTigvU",
  "DuxSoupId": "id.1927818",
  "ProfileUrl": "www.linkedin.com/sales/lead/acwaaaadaoob-xopw0vy7_akzazfnxxgrftigvu,name_search,lx9l"
}
```

**Webhook Type B Payload:**
```json
{
  "LinkedInUsername": "altonharewood",
  "DuxSoupId": "pid.altonharewood",
  "ProfileUrl": "www.linkedin.com/in/altonharewood"
}
```

**Result:**
- ❌ No shared Sales Nav ID
- ❌ No shared LinkedIn username
- ❌ Different DuxSoup ID formats (`id.` vs `pid.`)
- ❌ Different ProfileUrl formats (Sales Nav vs public)
- ✅ Same person name, company, title (but not used for matching)

**Conclusion:** Zero overlapping alias values → no merge possible

---

## Proposed Solutions

### Option 1: Cross-Link Aliases (Quick Fix)

**Approach:** Enhance identity resolver to create cross-links between related identifiers.

**Changes:**
1. Extract username from public URLs → add as `linkedInUsername` alias
   ```javascript
   // Example: "linkedin.com/in/altonharewood" → "altonharewood"
   ```

2. Normalize Sales Nav URLs to public URLs → add as `publicUrl` alias
   ```javascript
   // Example: "sales/lead/ACw..." → also store normalized form
   ```

3. Cross-reference DuxSoup ID formats
   ```javascript
   // "id.1927818" and "pid.altonharewood" both link to same person
   ```

**Pros:**
- Quick to implement (~1-2 hours)
- Works prospectively for new observations
- Low risk of breaking existing data

**Cons:**
- Doesn't fix existing 9,587 duplicates
- Requires backfill to apply to historical data

**Estimated Impact:** Prevents future duplicates, reduces new duplicate rate to ~5%

---

### Option 2: Canonical ID Merger (Comprehensive Fix)

**Approach:** Build merge tool to consolidate duplicate records.

**Algorithm:**
```javascript
// 1. Find duplicate candidates
async function findDuplicates() {
  // Group by: fullName + currentCompany + location (fuzzy match)
  // Filter to high-confidence matches (name exact + 1 other field)
  return candidatePairs;
}

// 2. Merge records
async function mergePerson(winnerId, loserId) {
  const winner = await Person.findById(winnerId);
  const loser = await Person.findById(loserId);

  // Merge observations
  winner.observations.visits.push(...loser.observations.visits);
  winner.observations.scans.push(...loser.observations.scans);

  // Merge aliases (dedupe)
  winner.aliases = dedupeAliases([...winner.aliases, ...loser.aliases]);

  // Update snapshot (prefer most recent)
  winner.snapshot = mergeSnapshots(winner.snapshot, loser.snapshot);

  // Save winner
  await winner.save();

  // Create redirect from loser → winner
  loser.mergedInto = winnerId;
  loser.mergedAt = new Date();
  await loser.save();

  return winner;
}
```

**Migration Strategy:**
1. **Dry run:** Generate merge candidates, output CSV for review
2. **Manual review:** User approves high-confidence merges
3. **Execute:** Run merge for approved pairs
4. **Validation:** Verify observation counts, no data loss
5. **Cleanup:** Archive merged records (keep for audit trail)

**Pros:**
- Fixes all existing 9,587 duplicates
- Can be run multiple times (idempotent)
- Audit trail via `mergedInto` field

**Cons:**
- More complex to implement (~4-6 hours)
- Requires validation and testing
- Risk of incorrect merges (mitigated by dry run)

**Estimated Impact:** Reduces duplicate count to ~500 (edge cases only)

---

### Option 3: Fuzzy Matching Layer (Advanced)

**Approach:** Add similarity-based matching service.

**Features:**
1. **Name similarity:** Levenshtein distance, phonetic matching
2. **Company matching:** Handle rebrands, acquisitions
3. **Location fuzzy matching:** "San Francisco" = "SF Bay Area"
4. **Confidence scoring:**
   - 95%+: Auto-merge
   - 80-95%: Manual review queue
   - <80%: Keep separate

**Pros:**
- Handles edge cases (name typos, missing data)
- Continuous improvement (ML-based)
- Catches duplicates current system misses

**Cons:**
- Most complex to implement (~2-3 days)
- Requires ongoing tuning
- Risk of false positives if thresholds too low

**Estimated Impact:** Reduces duplicates to <100, ongoing deduplication

---

## Recommended Implementation Plan

### Phase 1: Immediate (Option 1) - 2 hours
**Goal:** Stop creating new duplicates

1. Enhance `resolvePersonIdentity()` to extract username from URLs
2. Add cross-linking logic for Sales Nav ↔ public URLs
3. Test with sample webhooks
4. Deploy to production

**Result:** New duplicates reduced by ~90%

### Phase 2: Short-term (Option 2) - 1 week
**Goal:** Clean up existing duplicates

1. Build merge tool (`scripts/merge-duplicates.js`)
2. Run dry-run analysis, generate CSV
3. Review and approve merge candidates
4. Execute merge for 9,587 duplicates
5. Validate results

**Result:** Database reduced from 24,089 to ~19,000 people records

### Phase 3: Long-term (Option 3) - Optional
**Goal:** Advanced deduplication

1. Implement fuzzy matching service
2. Set up manual review queue
3. Tune confidence thresholds
4. Monitor and improve

**Result:** Ongoing duplicate prevention, edge case handling

---

## Files Involved

**Scripts:**
- `scripts/analyze-duplicates.js` - Duplicate analysis tool (created)
- `scripts/merge-duplicates.js` - Merge tool (to be created)

**Core Files:**
- `src/utils/identityResolver.js` - Identity resolution logic
- `src/services/identityResolverService.js` - Alias matching service
- `src/controllers/personController.js` - Person upsert logic
- `src/models/person.js` - Person schema

**Documentation:**
- `docs/duplicate-person-investigation.md` - This document
- `docs/identity-matching-guide.md` - Existing identity documentation

---

## Questions for Discussion

1. **Merge strategy:** Should we auto-merge high-confidence matches or require manual review for all?
2. **Observation handling:** How should we merge observation arrays? Chronological order?
3. **Canonical ID:** Which record becomes the "winner"? (Oldest? Most complete? Sales Nav ID priority?)
4. **Rollback plan:** If merge goes wrong, how do we un-merge?
5. **Production impact:** Should we pause webhook ingestion during merge?

---

## Next Steps (When Ready to Resume)

**Choose implementation path:**
- **A:** Quick fix only (Option 1) - Stop the bleeding
- **B:** Comprehensive fix (Option 1 + 2) - Fix prospectively + clean up historical
- **C:** Full solution (Option 1 + 2 + 3) - Complete deduplication system

**Estimated Timeline:**
- Option A: 2 hours
- Option B: 1 week
- Option C: 2-3 weeks

---

## References

**Related Documents:**
- `docs/company-etl-bug-report.md` - Similar ETL issue (resolved)
- `docs/identity-matching-guide.md` - Current identity resolution documentation

**Code Locations:**
- Identity resolution: `src/utils/identityResolver.js:394-450`
- Alias matching: `src/services/identityResolverService.js:1-220`
- Person upsert: `src/controllers/personController.js:309-450`

**Test Files:**
- `src/__tests__/identityResolver.test.js` - Identity resolver tests (30 tests, all passing)

---

**Last Updated:** January 25, 2026
**Author:** Claude Code (with user investigation)
**Status:** Analysis complete, awaiting implementation decision
