# Canonical ID Mismatch Investigation & Resolution Plan

**Date**: 2026-01-29
**Issue**: Production logs showing "Canonical ID mismatch on alias match (keeping existing)" warnings

---

## Problem Summary

Production logs show warnings like this:
```log
warn: Canonical ID mismatch on alias match (keeping existing) {
  "existing_canonical_id": "70449845-bdc1-5468-9881-027784e9f6a9",
  "incoming_canonical_id": "b8333a5e-e286-57e8-a45c-ecd4e57c72fa",
  "incoming_primary_id_type": "salesNavId",
  "person_id": "ACwAAAAQic0Bn0XVgPYraHsLHpCHt3LIyc2_Qyo"
}
```

**Key observation**: `incoming_primary_id_type: salesNavId` (highest priority identifier!)

This indicates the system found an existing person by alias match, but the canonical_ids don't match **even though both are salesNavId-based**.

---

## Root Causes

### Cause 1: Historical Data Frozen on Weak Identifiers (6% of records)

**Timeline:**
1. First observation arrives with only `linkedInUsername` → person created
2. Canonical ID set based on username: `UUIDv5("linkedInUsername:john-doe")`
3. Later observation includes `salesNavId` → added as alias
4. Canonical ID **NOT updated** (conservative behavior)
5. Result: Person has salesNavId, but canonical_id still based on username

**Evidence from previous analysis:**
- **24,086 total people**
- **1,454 people (6%)** have mismatched canonical IDs
- **99.9% of mismatches**: Have salesNavId but canonical_id based on username
- **65.9% of people** have salesNavIds available

**Status**: ✅ Documented, migration script ready

---

### Cause 2: Same-Priority Conflicts (Production warnings)

**Observation:**
Warnings show `incoming_primary_id_type: salesNavId`, meaning **BOTH** existing and incoming identifiers are salesNavId (same priority: 10).

**Why would they produce different canonical_ids?**

**Theory A: Multiple Different SalesNavIds for Same Person**
- Person has 2+ different salesNavIds in aliases
- DuxSoup webhook arrives with salesNavId #2
- System computes canonical_id from salesNavId #2
- Existing canonical_id is from salesNavId #1
- Mismatch detected, but won't update (same priority)

**Theory B: Case Sensitivity Issues**
- salesNavId stored as: `ACwAAA...` (canonical case)
- salesNavId arrives as: `acwaaa...` (lowercase)
- If not normalized before canonical_id computation → different hashes
- Canonical IDs won't match

**Theory C: LinkedIn Changed SalesNavId**
- Rare but possible: LinkedIn updates a person's salesNavId
- Old observations have old salesNavId
- New observations have new salesNavId
- System sees both as valid aliases

**Status**: ⚠️ Needs investigation (script created)

---

## Technical Details

### Canonical ID Priority System

```javascript
const priorities = {
  salesNavId: 10,      // Highest - most stable
  numericId: 9,
  linkedInUsername: 8,
  profileUrl: 5,
  publicUrl: 4,
  salesUrl: 4,
  recruiterUrl: 4,
  duxsoupId: 1,        // Lowest - least stable
};
```

### shouldUpdateCanonicalId() Logic

```javascript
// From identityResolverService.js:209-252

shouldUpdateCanonicalId(person, newCanonicalId, newPrimaryIdType) {
  // If no canonical_id exists, always set it
  if (!person.canonical_id) return true;

  // If they match, no update needed
  if (person.canonical_id === newCanonicalId) return false;

  // Find which alias created the existing canonical_id
  for (const alias of person.aliases) {
    const testCanonicalId = computeCanonicalId(buildCanonicalKey(alias.type, alias.value));

    if (testCanonicalId === person.canonical_id) {
      const existingPriority = priorities[alias.type] || 0;
      const newPriority = priorities[newPrimaryIdType] || 0;

      // Update ONLY if new priority is HIGHER
      return newPriority > existingPriority;
    }
  }

  // Can't determine source - only update if new is salesNavId
  return newPrimaryIdType === 'salesNavId';
}
```

**Behavior:**
- ✅ Updates when new identifier has **higher** priority
- ❌ Does NOT update when priorities are **equal** (conservative)
- ❌ Does NOT update when new has **lower** priority

---

## Action Plan

### Phase 1: Fix Historical Mismatches ⏰ **DO THIS FIRST**

**Goal**: Update ~1,454 records where canonical_id is based on weak identifier

**Steps:**

1. **Dry run to preview changes:**
   ```bash
   node scripts/migrate-canonical-ids.js
   ```
   Review the output to see what would be updated.

2. **Test with limited records:**
   ```bash
   node scripts/migrate-canonical-ids.js --execute --limit=100
   ```
   Verify first 100 updates work correctly.

3. **Full migration (during low-traffic period):**
   ```bash
   node scripts/migrate-canonical-ids.js --execute
   ```
   Update all ~1,454 mismatched records.

4. **Verify migration:**
   ```bash
   node scripts/analyze-canonical-id-mismatches.js
   ```
   Should show mismatch rate near 0%.

**Expected Impact:**
- ✅ Warnings should decrease by ~94% (if Cause 1 is dominant)
- ✅ Canonical IDs will reflect best available identifier
- ✅ Future observations will match correctly

**Risk**: Low - only updates `canonical_id` field, doesn't touch observations/aliases

---

### Phase 2: Investigate Same-Priority Conflicts 🔍

**Goal**: Understand why we're seeing conflicts even when both IDs are salesNavId

**Steps:**

1. **Run investigation script:**
   ```bash
   node scripts/investigate-salesnavid-conflicts.js
   ```

2. **Analyze results:**
   - How many people have multiple different salesNavIds?
   - Are they case mismatches or truly different IDs?
   - What % of canonical_id conflicts remain after Phase 1 migration?

3. **Based on findings, decide next steps:**

   **If mostly case mismatches:**
   - Add normalization before alias storage
   - Create cleanup script to normalize existing aliases

   **If truly different salesNavIds:**
   - Investigate DuxSoup data quality
   - May need to merge people with conflicting IDs
   - Consider adding deduplication logic

   **If conflicts persist:**
   - Review shouldUpdateCanonicalId() logic
   - Consider allowing updates when both are salesNavId but different values

---

### Phase 3: Monitor & Verify 📊 **1 week after Phase 1**

1. **Check warning frequency in production logs:**
   ```bash
   # Filter for canonical ID mismatch warnings
   grep "Canonical ID mismatch" render.log | wc -l
   ```

2. **Run analysis again:**
   ```bash
   node scripts/analyze-canonical-id-mismatches.js
   ```
   Should show mismatch rate < 1%

3. **Review investigation results:**
   ```bash
   node scripts/investigate-salesnavid-conflicts.js
   ```
   Identify any remaining systematic issues

---

## Scripts Reference

### Analysis
- `scripts/analyze-canonical-id-mismatches.js` - Count and categorize mismatches
- `scripts/investigate-salesnavid-conflicts.js` - **NEW** - Investigate same-priority conflicts

### Migration
- `scripts/migrate-canonical-ids.js` - Update canonical_ids to match best identifier
  - Flags: `--execute` (apply changes), `--limit N` (test with N records)

### Debug
- `scripts/debug-canonical-duplicate.js` - Debug specific person records

---

## Success Criteria

### After Phase 1 Migration:
- [ ] ~1,454 records updated
- [ ] Analysis shows mismatch rate < 1%
- [ ] Warnings decrease by 90%+

### After Phase 2 Investigation:
- [ ] Understand root cause of same-priority conflicts
- [ ] Identified data quality issues (if any)
- [ ] Created remediation plan for remaining conflicts

### After Phase 3 Monitoring:
- [ ] Warning rate stabilized at acceptable level
- [ ] No systematic issues detected
- [ ] Documentation updated with findings

---

## Rollback Plan

If migration causes issues:

1. **Canonical_id is non-critical**:
   - Used for fast lookup and deduplication
   - System can still function with mismatched canonical_ids

2. **No data loss risk**:
   - Migration only updates `canonical_id` field
   - Doesn't modify `_id`, aliases, observations, or snapshots

3. **Revert if needed**:
   - Keep backup before migration
   - Can manually revert specific records if needed

---

## Questions & Answers

### Q: Why not just update canonical_id every time we see a salesNavId?

**A**: Too aggressive. Would cause unnecessary churn:
- Canonical_id should be relatively stable
- Only update when we find a **better** (higher priority) identifier
- Don't update when new identifier is same/lower priority

### Q: Should we allow updates when both are salesNavId but different values?

**A**: Maybe. Current behavior is conservative (keeps existing). Alternatives:
- Always use the salesNavId from `person._id` if it's a salesNavId
- Pick the salesNavId that appears most frequently in observations
- Flag as data quality issue and investigate manually

**Decision**: Wait for Phase 2 investigation results before changing this.

### Q: Is it safe to run migration in production?

**A**: Yes. The migration:
- ✅ Only updates `canonical_id` field
- ✅ Doesn't delete or modify observations
- ✅ Doesn't change aliases or snapshots
- ✅ Can be run incrementally with `--limit`
- ✅ Safe to re-run (idempotent)

### Q: What if migration fails partway?

**A**: Safe to retry:
- Script processes records one at a time
- If it fails, some records updated, others not
- Safe to re-run - will update remaining mismatched records
- No data loss or corruption risk

---

## Timeline

| Phase | Task | Duration | Owner |
|-------|------|----------|-------|
| **Phase 1** | Dry run migration | 5 min | - |
| | Test with 100 records | 5 min | - |
| | Full migration | 10-15 min | - |
| | Verify results | 5 min | - |
| **Phase 2** | Run investigation script | 10 min | - |
| | Analyze findings | 30 min | - |
| | Create remediation plan | TBD | - |
| **Phase 3** | Monitor logs (1 week) | Ongoing | - |
| | Re-run analysis | 5 min | - |
| | Document findings | 30 min | - |

**Total estimated time**: 1-2 hours + 1 week monitoring

---

## References

- [Canonical ID Mismatch Resolution](./canonical-id-mismatch-resolution.md)
- [Identity Resolution Summary](./identity-resolution-summary.md)
- [Post-Migration Monitoring](./post-migration-monitoring.md)
- Code: `src/services/identityResolverService.js:209-252` (shouldUpdateCanonicalId)
- Code: `src/services/identityResolverService.js:443-468` (alias match scenario)
