# Database Health Check Report
**Date:** January 13, 2026
**Database:** Production (duxsoup.people)
**Total Records:** 23,496 people, 12,113 visits, 29,048 scans

## Executive Summary

**Overall Status:** 🔴 **CRITICAL** → 🟢 **RESOLVING**

A comprehensive health check revealed significant data quality issues affecting 99.8% of person records. Investigation determined that the ETL extraction pipeline code is **working correctly**, but Phase 2 (person snapshot upsert) failed historically for most records while Phase 1 (observation storage) succeeded.

**Solution:** Re-running the extraction pipeline for all affected records using their existing observation data.

---

## Critical Findings

### 1. Incomplete Snapshot Data (23,495 affected - 99.8%)

**Issue:** Person snapshots missing critical fields despite observations containing the data.

| Field | Missing Count | % of Total |
|-------|--------------|------------|
| Phone | 22,445 | 95.5% |
| Email | 21,055 | 89.6% |
| Profile Picture | 19,513 | 83.0% |
| Connections | 19,254 | 81.9% |
| Company ID | 13,428 | 57.2% |
| Industry | 9,947 | 42.3% |
| Current Company | 8,936 | 38.0% |
| Thumbnail | 6,301 | 26.8% |
| Location | 4,653 | 19.8% |
| **Current Title** | **1,575** | **6.7%** |
| **Full Name** | **332** | **1.4%** |

**Root Cause:** During webhook processing:
- ✅ Phase 1: Save observation to visits/scans collection (succeeded)
- ❌ Phase 2: Run `upsertFromObservation` to build person snapshot (failed silently)

**Evidence:**
- Manual test of `upsertFromObservation` extracts all data correctly
- Re-running extraction on same observations successfully populates snapshots
- Pipeline code is correct and comprehensive

### 2. Unreferenced Observations (6,886 orphaned - 16.7%)

**Issue:** Observations exist but aren't linked to any person record.

- 6,880 unreferenced visits
- 6 unreferenced scans

**Impact:** These observations are invisible to the application and don't contribute to person intelligence.

### 3. URL-Based Person IDs (778 people - 3.3%)

**Issue:** Using unstable LinkedIn profile URLs (`linkedin.com/in/username`) as person `_id` instead of stable identifiers.

**Risk:** If LinkedIn usernames change, these records become unreachable.

**Best Practice:** Use Sales Navigator ID or numeric ID as `_id`.

### 4. Duplicate Aliases (663 conflicts)

**Issue:** Same alias value appearing on multiple person records.

**Potential Cause:** People who should be merged, or data quality issues during identity resolution.

---

## Data Source Analysis

### Visit vs Scan Data Quality

**Finding:** Visits contain **significantly richer data** than scans.

| Field | Visits | Scans | Winner |
|-------|--------|-------|--------|
| Title | 100% | 82% | 🏆 Visit |
| Company | 99% | 0% | 🏆 Visit |
| Industry | 94% | 0% | 🏆 Visit |
| Connections | 99% | 0% | 🏆 Visit |
| Email | 25% | N/A | Visit only |
| Phone | 10% | N/A | Visit only |
| Extended Data | ✅ | ❌ | Visit only |

**Extended Data in Visits:**
- Full position history (roles timeline)
- Education history
- Skills list

**Recommendation:** Prioritize visit data when backfilling. Current extraction code already implements this correctly.

---

## Dead Letter Analysis (1,698 historical failures)

All dead letters have status "replayed", meaning they were reprocessed. Original errors:

| Error Type | Count | Root Cause |
|------------|-------|------------|
| Schema validation: `duxsoupId` not valid enum | 874 | Alias type not in schema enum |
| E11000 duplicate key error | 166 | Duplicate person creation attempts |
| Assignment to constant variable | 100 | Code bug (fixed) |
| Date parsing errors | 40 | Invalid date formats for roles |

**Status:** Issues resolved, all replayed successfully.

---

## What's Working ✅

1. **Extraction pipeline code** is comprehensive and correct
2. **Identity resolution** working (all have canonical_id)
3. **No URL-based IDs** for 97% of people (using stable IDs)
4. **Referential integrity** intact (no broken observation references)
5. **Active system:** 442 observations in last 24h, 12,243 in last 7 days
6. **No pending dead letters**

---

## Remediation Actions

### Completed

✅ **Investigated 332 missing names** - Found 80% recoverable from observations
✅ **Analyzed data completeness** - Identified 23,495 people needing re-extraction
✅ **Compared visit vs scan data** - Confirmed visits have richer data
✅ **Tested extraction pipeline** - Verified code works correctly
✅ **Created re-extraction script** - Simpler, more efficient than comprehensive backfill

### In Progress

🔄 **Re-extracting snapshots for 23,495 people**
- Script: `scripts/re-extract-snapshots.js`
- Method: Re-run `upsertFromObservation` using existing observations
- Expected time: 5-15 minutes
- Expected result: All missing fields populated from observation data

### Recommended Next Steps

1. **Link unreferenced observations** (6,886 orphaned)
   - Create migration script to match observations to people
   - Use Sales Nav ID / numeric ID for matching

2. **Migrate URL-based person IDs** (778 people)
   - Replace `linkedin.com/in/username` with stable IDs
   - Preserve as aliases for backwards compatibility

3. **Resolve duplicate aliases** (663 conflicts)
   - Investigate if these are truly duplicates or should be merged
   - Run deduplication analysis

4. **Monitor extraction pipeline**
   - Add alerts for Phase 2 failures
   - Log when `upsertFromObservation` fails but webhook succeeds
   - Consider making Phase 2 failures more visible

5. **Review recent webhook processing**
   - Check logs for silent failures in last 7 days
   - Verify new observations are being processed correctly

---

## Technical Details

### Observation-Snapshot Pattern

The system uses a sound architectural pattern:
- **Observations** (visits/scans): Immutable event logs, append-only
- **People**: Canonical snapshots, derived from observations
- **Relationship**: Person → Observations (unidirectional references in `person.observations.visits/scans` arrays)

### Extraction Pipeline

Located in: `src/controllers/personController.js::upsertFromObservation()`

**Extracts:**
- Basic fields: firstName, lastName, fullName, title, company, location
- Contact: email, phone, twitter
- Professional: industry, connections, summary, degree
- Images: profilePicture, thumbnail
- Extended: roles timeline, education, skills

**Precedence Rules:**
1. Ignore empty/blank incoming values
2. Visit beats scan for conflicting non-empty values
3. Newer beats older within same source type

### Scripts Created

1. **`scripts/health-check-fixed.js`** - Comprehensive database health check
2. **`scripts/investigate-records.js`** - Sample and analyze data structures
3. **`scripts/investigate-missing-names.js`** - Analyze name recovery potential
4. **`scripts/investigate-snapshot-completeness.js`** - Field-level completeness analysis
5. **`scripts/compare-visit-scan-data.js`** - Data source quality comparison
6. **`scripts/re-extract-snapshots.js`** - Re-run extraction for incomplete snapshots

---

## Impact Assessment

### Before Remediation
- 332 people without names (1.4%)
- 1,575 people without titles (6.7%)
- 8,936 people without companies (38%)
- 9,947 people without industry (42.3%)
- 19,254 people without connections (81.9%)

### After Remediation (Expected)
- ✅ All recoverable data populated from observations
- ✅ Names, titles, companies backfilled where available
- ✅ Visits provide rich data (extended fields)
- ⚠️ Some fields will remain empty if not in observations (especially for scan-only people)

### Remaining Gaps (Expected)
- Scans with minimal data will have incomplete profiles
- People with only scans won't have: company, industry, connections, email, phone
- Solution: Encourage more visit captures vs scans for richer data

---

## Monitoring & Prevention

### Add Monitoring For:
1. Phase 2 failures during webhook processing
2. People created without names
3. Observations not linked to people
4. Dead letter queue growth

### Preventive Measures:
1. Make Phase 2 errors more visible (log level: ERROR vs WARN)
2. Add alerting when `upsertFromObservation` fails
3. Periodic health checks (weekly)
4. Dashboard showing data completeness metrics

---

## Appendix: Commands

### Run Health Check
```bash
NODE_ENV=production node scripts/health-check-fixed.js
```

### Re-Extract Snapshots (Dry Run)
```bash
NODE_ENV=production node scripts/re-extract-snapshots.js --dry-run
```

### Re-Extract Snapshots (Execute)
```bash
NODE_ENV=production node scripts/re-extract-snapshots.js
```

### Investigate Specific Issues
```bash
# Check data structures
NODE_ENV=production node scripts/investigate-records.js

# Analyze missing names
NODE_ENV=production node scripts/investigate-missing-names.js

# Check field completeness
NODE_ENV=production node scripts/investigate-snapshot-completeness.js

# Compare visit vs scan quality
NODE_ENV=production node scripts/compare-visit-scan-data.js
```
