# Company ETL Bug Report

**Issue**: No companies created since January 6, 2026 (18 days ago)
**Root Cause**: Wrong payload path in company/location controllers
**Severity**: HIGH - Company data collection completely broken
**Date Discovered**: 2026-01-25

## Summary

Company and location ETL has been silently failing since early January due to three interconnected bugs:

1. **Wrong Payload Path** (PRIMARY): Company and location controllers read `rawData` instead of `rawData.data`
2. **Schema Validation Mismatch**: Company identity resolver allows name fallback, but Company model rejects non-numeric IDs
3. **Cascading Failure Risk**: Company/location upserts nested under person upsert (person failures block company/location)

## Investigation Results

### Database State
```
Total companies: 2,317
Last company created: 2026-01-06 23:17:39 (18 days ago)
Last company: The New York Times (ID: 4236)
```

### Recent Observations Analysis

**Visits (last 10):**
- Company names present: 9/10 (90%)
- CompanyProfile URLs present: 9/10 (90%)
- CompanyID present: 0/10 (0%)

**Scans (last 10):**
- Company names present: 0/10 (0%)
- CompanyProfile URLs present: 0/10 (0%)
- CompanyID present: 0/10 (0%)

### Key Findings

1. **Company data IS being sent** by DuxSoup (in visits)
2. **Data is NOT being extracted** due to wrong payload path
3. **Scans have no company data** (expected - scans focus on people)
4. **CompanyID rarely provided** - must extract from CompanyProfile URL

## Bug Details

### Bug #1: Wrong Payload Path (PRIMARY BUG) ⚠️ CRITICAL

**Affected Files:**
- `src/controllers/companyController.js` (line 15)
- `src/controllers/locationController.js` (line 7)

**Current Code:**
```javascript
// Company controller
const webhookData = observationDoc.rawData || observationDoc;

// Location controller
const webhookData = observationDoc.rawData || observationDoc;
```

**Correct Code** (matches person controller):
```javascript
const webhookData = observationDoc.rawData?.data || observationDoc.rawData || observationDoc;
```

**Impact:**
- Company identity resolution receives WRONG object
- Looks for Company/CompanyID/CompanyProfile in wrong place
- Finds nothing, returns `{ company_id: null, canonical_id: null }`
- Company upsert bails out early (line 18 check fails)
- NO companies created

**Evidence:**
Person controller (line 310-311) uses correct 3-level fallback:
```javascript
const webhookData =
  observationDoc.rawData?.data || observationDoc.rawData || observationDoc;
```

Person upserts work correctly. Company/location upserts fail.

### Bug #2: Schema Validation Mismatch ⚠️ MEDIUM

**Files:**
- `src/utils/identityResolver.js` (lines 394-401) - Allows name fallback
- `src/models/company.js` (lines 43-46) - Rejects non-numeric IDs

**The Mismatch:**

**Identity Resolver** (lines 394-401):
```javascript
// Priority 3: Company name as last resort (if no numeric ID found)
if (!company_id && webhookData.Company) {
  const name = webhookData.Company.trim();
  if (name) {
    company_id = name;  // ← Can be "Acme Corp"
    source = "name";
    primaryIdType = "name";
    aliases.push({ type: "name", value: name });
  }
}
```

**Company Model** (lines 43-46):
```javascript
_id: {
  type: String,
  required: true,
  validate: {
    validator: function (v) {
      // Accept only numeric company IDs
      return /^\d+$/.test(v);  // ← REJECTS "Acme Corp"
    },
    message: (props) =>
      `Invalid company ID format: ${props.value}. Must be numeric LinkedIn company ID`
  }
}
```

**Impact:**
- If CompanyID/CompanyProfile missing, resolver falls back to company name
- Company.create() called with name as _id (e.g., "Acme Corp")
- Validation error: "Must be numeric LinkedIn company ID"
- Company upsert fails silently (caught by error handler)

**Current Mitigation:**
Bug #1 prevents this from happening (wrong payload path means no Company field found).
If Bug #1 is fixed WITHOUT fixing Bug #2, company upserts will start failing with validation errors.

### Bug #3: Cascading Failure Risk ⚠️ LOW

**File:** `src/controllers/observationHandler.js` (lines 134-165)

**Structure:**
```javascript
try {
  await upsertFromObservation(observation, config.type);  // Person
  peopleUpsertSuccess = true;

  // Company upsert (only runs if person succeeds)
  try {
    await upsertCompanyFromObservation(observation, config.type);
    companyUpsertSuccess = true;
  } catch (companyError) {
    logger.error('Failed to upsert company', { error: companyError.message });
  }

  // Location upsert (only runs if person succeeds)
  try {
    await upsertLocationFromObservation(observation, config.type);
    locationUpsertSuccess = true;
  } catch (locationError) {
    logger.error('Failed to upsert location', { error: locationError.message });
  }
} catch (peopleError) {
  // Person failed - company/location NEVER RUN
  logger.error('Failed to upsert person', { error: peopleError.message });
}
```

**Impact:**
- Company and location upserts NESTED inside person success block
- If person upsert fails, company/location never attempted
- Person failures cascade to prevent ALL entity extraction

**Severity**: Low currently because:
- Person upserts are stable (working correctly)
- Company/location upserts have independent try-catch (failures don't cascade up)

**Risk**: If person upserts start failing frequently, company/location collection stops entirely.

## Recommended Fixes

### Priority 1: Fix Payload Path (IMMEDIATE) ✅

**Files to modify:**
1. `src/controllers/companyController.js` line 15
2. `src/controllers/locationController.js` line 7

**Change:**
```diff
- const webhookData = observationDoc.rawData || observationDoc;
+ const webhookData = observationDoc.rawData?.data || observationDoc.rawData || observationDoc;
```

**Impact:**
- Fixes primary bug causing zero companies to be created
- Aligns with person controller pattern
- Will immediately start extracting company data from visits

### Priority 2: Remove Name Fallback (IMMEDIATE) ✅

**File to modify:**
1. `src/utils/identityResolver.js` lines 394-408

**Change:**
Remove the name fallback logic entirely. Company should ONLY be created if numeric ID available.

```diff
- // Priority 3: Company name as last resort (if no numeric ID found)
- if (!company_id && webhookData.Company) {
-   const name = webhookData.Company.trim();
-   if (name) {
-     company_id = name;
-     source = "name";
-     primaryIdType = "name";
-     aliases.push({ type: "name", value: name });
-   }
- } else if (webhookData.Company) {
+ // Always add company name as alias (if available)
+ if (webhookData.Company) {
    const name = webhookData.Company.trim();
    if (name && !aliases.find((a) => a.value === name)) {
      aliases.push({ type: "name", value: name });
    }
  }
```

**Rationale:**
- Company name alone is NOT a stable identifier
- Companies change names, causing duplicates
- Numeric ID is required for canonical identity
- Name should be stored as alias and in snapshot.name
- Better to skip company than create with unstable ID

### Priority 3: Improve Error Handling (OPTIONAL) 🔄

**File to modify:**
1. `src/controllers/observationHandler.js` lines 134-165

**Current behavior:** Company/location only attempted if person succeeds.

**Option A (Conservative):** Keep current structure, add better logging
```javascript
if (peopleUpsertSuccess) {
  logger.info('Person upserted successfully, attempting company/location');
} else {
  logger.warn('Person upsert failed, skipping company/location upserts', {
    observation_id: observation._id,
    event_key: eventKey,
  });
}
```

**Option B (Independent):** Run company/location regardless of person success
```javascript
// Move company/location upserts outside person try-catch
// Makes them independent of person upsert status
```

**Recommendation:** Option A (Conservative)
- Current structure is intentional (person is primary entity)
- Person upserts are stable (not failing frequently)
- Independent extraction could create orphaned companies
- Better logging makes debugging easier

## Testing Plan

### Phase 1: Verify Fixes Locally

1. **Apply fixes** to company/location controllers and identity resolver
2. **Run integration tests** to ensure no regressions
3. **Manual test** with sample webhook data

### Phase 2: Backfill Missing Companies

After deploying fixes:

1. **Identify observations** from Jan 7 onwards with company data
2. **Re-process observations** to extract companies retroactively
3. **Verify** companies being created from new webhooks

### Phase 3: Monitor Production

1. **Watch logs** for company upsert success/failure
2. **Track company creation** rate (should increase immediately)
3. **Verify** company data quality (numeric IDs, proper aliases)

## Expected Outcomes

**After Fix Deployment:**
- ✅ Companies created from new visits with CompanyProfile URLs
- ✅ Company names stored as aliases and in snapshot.name
- ✅ Zero validation errors (no name-based IDs attempted)
- ✅ Location extraction also fixed (same bug)

**Backfill Results (estimated):**
- ~18 days of missing data
- ~9/10 visits have company data = ~90% coverage
- Estimated recoverable companies: depends on visit volume

**Long-term:**
- Company collection resumes normal growth
- Stable company IDs from LinkedIn URLs
- Proper company-person relationships
- Location data also being extracted

## Related Issues

**Why CompanyID field is always missing:**
- DuxSoup doesn't always provide CompanyID in webhooks
- Must extract from CompanyProfile URL instead
- Identity resolver handles this correctly (lines 374-384)
- URL extraction: `linkedin.com/company/82978333` → `82978333`

**Why scans have no company data:**
- Scans focus on bulk people data
- Company information is visit-specific
- Expected behavior (not a bug)

## Files Affected

**To Fix:**
- `src/controllers/companyController.js`
- `src/controllers/locationController.js`
- `src/utils/identityResolver.js`

**To Test:**
- `src/__tests__/companyController.test.js` (if exists)
- `src/__tests__/locationController.test.js` (if exists)
- `src/__tests__/identityResolver.test.js`

**Investigation Tools:**
- `scripts/investigate-company-etl.js` (created for this bug)

## Timeline

- **Bug Introduction**: Unknown (possibly months ago)
- **Last Working**: January 6, 2026
- **Bug Discovered**: January 25, 2026 (18 days silent failure)
- **Fix Priority**: IMMEDIATE
- **Data Recovery**: Required (18 days of missing companies)
