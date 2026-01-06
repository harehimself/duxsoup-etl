# Identity Linking Job - Execution Guide

## What This Does

The linking job **upgrades URL-fallback people to stable IDs** by:
1. Finding people with URLs as primary ID (e.g., `linkedin.com/in/johndoe`)
2. Checking if they have Sales Navigator IDs in their aliases
3. Merging them into canonical people with stable IDs

**Expected Impact**: Boost coverage from ~21% to ~90-95%

---

## Execution Steps

### Step 1: Preview (Dry Run) - 2 minutes

```bash
# On Render Shell
node scripts/linkIdentities.js --dry-run --limit=20
```

**What to look for:**
```
Found 5000 upgradable people

Sample upgradable people:
  linkedin.com/in/johndoe → ACwAAABCDEF123 (salesNavId)
  linkedin.com/in/janedoe → ACwAAAXYZ789 (salesNavId)
  linkedin.com/in/bobsmith → 12345678 (numericId)

✅ Dry run complete. Use --commit to execute merges.
```

**Decision Point:**
- ✅ If you see upgradable people → Proceed to Step 2
- ❌ If "Found 0 upgradable people" → Skip this job (nothing to link)

---

### Step 2: Execute Small Batch - 5 minutes

```bash
# Merge first 100 people
node scripts/linkIdentities.js --commit --limit=100 --batch-size=10
```

**What to expect:**
```
Found 100 upgradable people

Executing merges...

  ✓ Merged: linkedin.com/in/johndoe → ACwAAABCDEF123
  ✓ Merged: linkedin.com/in/janedoe → ACwAAAXYZ789
  ...

Progress: 10/100 people processed
Progress: 20/100 people processed
...

✅ Linking job complete!
Statistics:
  Found: 100
  Merged: 95
  Already linked: 3
  Skipped: 0
  Failed: 2
```

**Decision Point:**
- ✅ If most merges succeed (>90%) → Proceed to Step 3
- ❌ If high failure rate (>10%) → Stop, investigate errors

---

### Step 3: Check Coverage Improvement

```bash
curl https://duxsoup.onrender.com/api/health/parity | jq '{
  people_count: .metrics.people_count,
  coverage_percent: .metrics.coverage_percent,
  url_fallback: .metrics.url_fallback_count
}'
```

**Expected results after 100 merges:**
```json
{
  "people_count": 5300,  // Slightly higher (merged people)
  "coverage_percent": 22, // Slight improvement
  "url_fallback": 4900   // 100 fewer URL-fallback people
}
```

---

### Step 4: Execute Full Batch - 30-60 minutes

```bash
# Merge all upgradable people (up to 5000)
node scripts/linkIdentities.js --commit --limit=5000 --batch-size=50
```

**Progress monitoring:**
```
Progress: 50/5000 people processed
Progress: 100/5000 people processed
...
Progress: 5000/5000 people processed

✅ Linking job complete!
Statistics:
  Found: 5000
  Merged: 4750
  Already linked: 150
  Skipped: 50
  Failed: 50
```

**Note:** This can take 30-60 minutes depending on how many upgradable people exist.

---

### Step 5: Verify Final Coverage

```bash
curl https://duxsoup.onrender.com/api/health/parity | jq '{
  people_count: .metrics.people_count,
  coverage_percent: .metrics.coverage_percent,
  ready_for_cutover: .ready_for_cutover,
  blockers: .blockers
}'
```

**Expected results:**
```json
{
  "people_count": 22000,
  "coverage_percent": 90,
  "ready_for_cutover": false,  // Still below 98%
  "blockers": ["Coverage ratio 90.00% below 98% threshold"]
}
```

---

## Why Coverage May Still Be < 98%

After linking, you'll likely have **~90-95% coverage**, not 98%. This is because:

1. **18,000 observations truly lack stable IDs** (no Sales Nav, no numeric ID, only URL)
2. **URL-only people can't be upgraded** (no stable ID in aliases)
3. **This is expected and acceptable** for hybrid mode

---

## Next Steps Based on Coverage

### If Coverage >= 98% ✅
```bash
# Run pre-flight check
./scripts/pre-flight-check.sh

# Execute cutover to people-only
./scripts/cutover.sh
```

### If Coverage 95-98% ⚠️
**Option A: Operate in Hybrid Mode (Recommended)**
- Keep `READ_SOURCE=hybrid`
- 95%+ of reads hit people collection
- 2-5% fall back to legacy (acceptable)
- Safe and production-ready

**Option B: Wait for More Data**
- New observations will have Sales Nav IDs
- Coverage naturally improves over time
- Re-run linking job in 1-2 weeks

### If Coverage 90-95% ⚠️
**Option A: Hybrid Mode (Recommended)**
- Fallback rate 5-10% is acceptable
- System works correctly
- No data loss

**Option B: Investigate Missing IDs**
```bash
# Check why observations lack stable IDs
curl https://duxsoup.onrender.com/api/health/coverage-breakdown | jq '.'
```

### If Coverage < 90% ❌
**Critical Issue - Investigate:**
```bash
# Check for errors
curl https://duxsoup.onrender.com/api/health/ingestion | jq '.metrics'

# Run verification
node scripts/verifyRebuild.js

# Check dead letters
mongo $MONGODB_URI --eval 'db.deadletters.find().limit(10).pretty()'
```

---

## Troubleshooting

### "Found 0 upgradable people"
**Cause:** All URL-fallback people lack stable IDs in aliases
**Solution:** Accept current coverage, use hybrid mode

### "Failed: 50%" (high failure rate)
**Cause:** Merge conflicts or database errors
**Solution:** Check logs, run with `--batch-size=5` for better error isolation

### Linking job hangs
**Cause:** Large batch processing timeout
**Solution:** Reduce batch size: `--batch-size=10`

### Coverage doesn't improve
**Cause:** Merged people were duplicates of existing canonical people
**Solution:** This is correct behavior - no coverage loss

---

## Safety Notes

✅ **Safe to run multiple times** (idempotent)
✅ **No data loss** (merges preserve all observations)
✅ **Rollback not needed** (only improves data quality)
✅ **Can interrupt** (resume by re-running with same limit)

⚠️ **Do NOT run concurrently** (sequential only)
⚠️ **Monitor Render memory** (large batches use more RAM)

---

## Summary

**Current State:**
- Coverage: 21.6% (5,266 people)
- Need: 98% for people-only cutover

**After Linking (Expected):**
- Coverage: 90-95% (22,000-23,000 people)
- Ready: Hybrid mode ✅ | People-only mode ❌

**Decision:**
- If >= 98%: Cutover to people-only
- If 90-98%: Operate in hybrid mode (recommended)
- If < 90%: Investigate issues

---

## Quick Command Reference

```bash
# Preview
node scripts/linkIdentities.js --dry-run --limit=20

# Test batch
node scripts/linkIdentities.js --commit --limit=100 --batch-size=10

# Full run
node scripts/linkIdentities.js --commit --limit=5000 --batch-size=50

# Check coverage
curl https://duxsoup.onrender.com/api/health/parity | jq .metrics.coverage_percent

# Verify data
node scripts/verifyRebuild.js
```
