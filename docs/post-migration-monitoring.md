# Post-Migration Monitoring Guide

## Migration Status

✅ **Phase 1: Migration - COMPLETE**
- Execution time: 2026-01-25 09:05:03 - 09:06:34 (91 seconds)
- Records updated: 1,454 / 1,454 (100%)
- Failures: 0
- Verification: 0 mismatches remaining (100% correct)

## Phase 2: Production Monitoring

### What to Monitor

Now that the code fix is deployed and migration complete, monitor for these log patterns:

#### 1. Expected Logs (Good Signs ✅)

**INFO: Updating canonical_id to higher-priority identifier**
```
info: Updating canonical_id to higher-priority identifier
{
  "person_id": "john-doe",
  "old_canonical_id": "050918e1-be78-51a4-92ee-53cd42566bd9",
  "new_canonical_id": "7df6be1e-1d56-5972-be5a-ff092d87000d",
  "new_primary_id_type": "salesNavId"
}
```
**What it means**: System automatically updated a person's canonical_id to use a better (more stable) identifier. This is working as designed.

**When you'll see it**: When a new observation arrives with a higher-priority identifier than what was previously used.

#### 2. Decreased Warnings (Good Sign ✅)

**WARN: Canonical ID mismatch (keeping existing)**
```
warn: Canonical ID mismatch on alias match (keeping existing)
{
  "person_id": "jane-smith",
  "existing_canonical_id": "7df6be1e-1d56-5972-be5a-ff092d87000d",
  "incoming_canonical_id": "050918e1-be78-51a4-92ee-53cd42566bd9",
  "incoming_primary_id_type": "linkedInUsername"
}
```
**What it means**: System detected a mismatch but kept the existing canonical_id because it's based on a higher-priority identifier. This is working as designed.

**Expected frequency**: Should be RARE now (much less than before migration).

**When you'll see it**: When an observation arrives with a LOWER-priority identifier than what the person already has.

#### 3. Old Warnings (Should NOT See ❌)

**WARN: Canonical ID mismatch on alias match** (without "keeping existing")
```
warn: Canonical ID mismatch on alias match
{
  "person_id": "john-doe",
  "existing_canonical_id": "050918e1-be78-51a4-92ee-53cd42566bd9",
  "incoming_canonical_id": "7df6be1e-1d56-5972-be5a-ff092d87000d"
}
```
**What it means**: OLD VERSION - before the code fix. Should NOT appear anymore.

**If you see this**: Code fix may not be deployed. Check that commit `e13e923` is deployed.

### How to Monitor Render Logs

#### Via Render Dashboard

1. Go to https://dashboard.render.com
2. Select your `duxsoup-etl` service
3. Click "Logs" tab
4. Search for these patterns:
   - `"Updating canonical_id to higher-priority identifier"` (expected)
   - `"Canonical ID mismatch"` (should be rare)

#### Via Render CLI (if installed)

```bash
# Stream live logs
render logs --service-id <your-service-id> --tail

# Search for specific patterns
render logs --service-id <your-service-id> | grep "canonical"
render logs --service-id <your-service-id> | grep "mismatch"
```

### Success Metrics

After 24-48 hours of monitoring, you should see:

✅ **Significant decrease in mismatch warnings**
- Before: Frequent "Canonical ID mismatch" warnings (every time a person with username-only first observation gets a Sales Nav ID)
- After: Rare warnings (only when lower-priority identifiers arrive)

✅ **New INFO logs appearing**
- "Updating canonical_id to higher-priority identifier" logs when system auto-updates

✅ **No migration-related errors**
- No "person not found" errors
- No "duplicate canonical_id" errors
- Webhooks processing successfully

### Verification Commands

Run these commands periodically to verify system health:

#### 1. Check for any remaining mismatches
```bash
node scripts/analyze-canonical-id-mismatches.js
```
**Expected result**: 0 mismatches (0.0%)

#### 2. Verify database connectivity
```bash
curl https://duxsoup.onrender.com/health
```
**Expected result**: `{"status":"healthy","database":"connected"}`

#### 3. Sample recent people records
You can check a few recent person records to verify they have correct canonical IDs:

```javascript
// MongoDB query (in Mongo shell or Compass)
db.people.find({
  "aliases.type": "salesNavId"
}).sort({ updatedAt: -1 }).limit(5).forEach(person => {
  const salesNavAlias = person.aliases.find(a => a.type === 'salesNavId');
  const expectedCanonicalId = computeCanonicalId(buildCanonicalKey('salesNavId', salesNavAlias.value));

  print(`Person: ${person._id}`);
  print(`  Has Sales Nav ID: ${salesNavAlias.value}`);
  print(`  Current canonical_id: ${person.canonical_id}`);
  print(`  Expected canonical_id: ${expectedCanonicalId}`);
  print(`  Match: ${person.canonical_id === expectedCanonicalId}`);
  print('');
});
```

### Expected Behavior Examples

#### Example 1: New Person with Username Only (First Observation)
```
Webhook arrives:
{
  "Profile": "https://linkedin.com/in/john-doe",
  // No Sales Nav ID
}

Expected behavior:
1. Person created with username-based canonical_id
2. No warnings (correct for first observation)
```

#### Example 2: Sales Nav ID Arrives Later (Second Observation)
```
Webhook arrives for same person:
{
  "Profile": "https://linkedin.com/in/john-doe",
  "SalesProfile": "...ACwAAABCDEF..."  // Now includes Sales Nav ID
}

Expected behavior:
1. System finds existing person by alias (username)
2. Detects canonical_id mismatch
3. Compares priorities: salesNavId (5) > linkedInUsername (4)
4. UPDATES canonical_id to Sales Nav ID-based UUID
5. Logs: "Updating canonical_id to higher-priority identifier" (INFO)
```

#### Example 3: Lower-Priority Identifier Arrives
```
Webhook arrives for person who already has Sales Nav ID:
{
  "Profile": "https://linkedin.com/in/john-doe",
  // No Sales Nav ID (DuxSoup didn't include it this time)
}

Expected behavior:
1. System finds existing person by alias (username)
2. Detects canonical_id mismatch
3. Compares priorities: linkedInUsername (4) < salesNavId (5)
4. KEEPS existing canonical_id (already optimal)
5. Logs: "Canonical ID mismatch on alias match (keeping existing)" (WARN)
```

### Troubleshooting

#### Issue: Still seeing many mismatch warnings

**Possible causes:**
1. Code fix not deployed - Check commit `e13e923` is in production
2. Render not redeployed after push - Manually trigger deploy
3. Old logs cached - Clear log view and refresh

**Resolution:**
```bash
# Check deployed commit
git log --oneline -5

# Should show:
# e13e923 fix(identity): Auto-update canonical_id when better identifiers discovered
```

#### Issue: "Duplicate key error on canonical_id"

**Possible cause**: Extremely rare - two people computed to same canonical_id

**Resolution**: This shouldn't happen with UUIDv5, but if it does:
1. Check the error logs for the conflicting canonical IDs
2. Investigate which two people have the collision
3. File an issue - this indicates a deeper problem

#### Issue: Webhooks failing after migration

**Possible cause**: Database connection issue (unrelated to migration)

**Resolution:**
1. Check health endpoint: `curl https://duxsoup.onrender.com/health`
2. Check Render logs for database connection errors
3. Verify MongoDB cluster is accessible

### Phase 3: Long-Term Verification

**Timeline**: 1 week after migration

**Action**: Run analysis script again
```bash
node scripts/analyze-canonical-id-mismatches.js
```

**Expected result**:
- Mismatched canonical IDs: 0 (0.0%)
- If any mismatches appear, investigate why the auto-update didn't work

**If mismatches appear**:
1. Check the specific person records
2. Review their alias history
3. Check if auto-update logic was bypassed somehow
4. May need to adjust `shouldUpdateCanonicalId()` logic

## Summary

✅ **Phase 1 Complete**: Migration successful, 1,454 records fixed
🔄 **Phase 2 In Progress**: Monitor production logs for decreased warnings
⏳ **Phase 3 Pending**: Verify after 1 week

The system is now configured to:
1. **Auto-update** canonical IDs when better identifiers discovered
2. **Log INFO** when updating (expected behavior)
3. **Log WARN** when keeping existing (defensive behavior)
4. **Maintain stability** by only updating to higher-priority identifiers

All 24,086 person records now have canonical IDs that match their best available identifier! 🎉
