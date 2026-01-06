# Execute Sales Nav Fix - Step by Step

## What Just Happened

**Critical Bug Fixed:** The system was ignoring Sales Navigator IDs in the `Profile` field.

**Impact:** Coverage should jump from **21.6%** → **~90%** after rebuild.

---

## Execution Plan (20-30 minutes)

### ✅ Step 1: Wait for Deployment (2-3 min)

Watch Render dashboard for:
```
==> Your service is live 🎉
```

Or check via API:
```bash
curl https://duxsoup.onrender.com/api/test
# Should return: {"message":"API routes working"}
```

---

### ✅ Step 2: Verify New Webhooks Work (5 min)

Wait for a few new webhooks to arrive and check logs in Render dashboard.

**Before Fix (OLD):**
```
info: Scan data processed
warn: Cannot upsert person without stable ID  ❌
```

**After Fix (NEW):**
```
info: Scan data processed
info: Upserting person from observation  ✅
info: Person upserted successfully  ✅
```

**Or check via API:**
```bash
# Should see people_upserted count increasing
curl https://duxsoup.onrender.com/api/health/ingestion | jq '{
  total_24h: .metrics.total_observations_24h,
  successes: .metrics.people_upsert_successes_24h,
  success_rate: .metrics.people_upsert_success_rate_24h
}'
```

Expected: `success_rate: 100` (or close to it)

---

### ✅ Step 3: Dry Run Rebuild Preview (1 min)

Test rebuild on 100 observations:

```bash
curl -X POST https://duxsoup.onrender.com/api/admin/rebuild-people \
  -H "Content-Type: application/json" \
  -d '{"limit": 100, "source": "both", "dryRun": true}' | jq '.'
```

**Expected output:**
```json
{
  "success": true,
  "message": "Dry run complete",
  "stats": {
    "visits_processed": 50,
    "scans_processed": 50,
    "people_upserted": 0,
    "errors": 0,
    "skipped": 100
  }
}
```

---

### ✅ Step 4: Run Small Rebuild Batch (2 min)

Rebuild first 500 observations to test:

```bash
curl -X POST https://duxsoup.onrender.com/api/admin/rebuild-people \
  -H "Content-Type: application/json" \
  -d '{"limit": 500, "source": "both", "dryRun": false}' | jq '.stats'
```

**Expected output:**
```json
{
  "visits_processed": 250,
  "scans_processed": 250,
  "people_upserted": 450,
  "errors": 50,
  "elapsed_seconds": 15.3,
  "throughput_per_second": 32
}
```

**Success if:** `people_upserted > 400` (80%+ success rate)

---

### ✅ Step 5: Check Coverage Improvement (30 sec)

```bash
curl https://duxsoup.onrender.com/api/health/parity | jq '{
  before_fix: 21.6,
  after_partial_rebuild: .metrics.coverage_percent,
  improvement: (.metrics.coverage_percent - 21.6),
  people_count: .metrics.people_count
}'
```

**Expected:**
```json
{
  "before_fix": 21.6,
  "after_partial_rebuild": 23.5,
  "improvement": 1.9,
  "people_count": 5716
}
```

Coverage should be slightly higher (we only rebuilt 500 out of 28,914).

---

### ✅ Step 6: Run Full Rebuild (15-20 min)

Rebuild in batches to avoid timeout:

**Batch 1 (5000 observations):**
```bash
curl -X POST https://duxsoup.onrender.com/api/admin/rebuild-people \
  -H "Content-Type: application/json" \
  -d '{"limit": 5000, "source": "both", "dryRun": false}' | jq '.stats'
```

**Wait 2 minutes, then Batch 2:**
```bash
curl -X POST https://duxsoup.onrender.com/api/admin/rebuild-people \
  -H "Content-Type: application/json" \
  -d '{"limit": 5000, "source": "both", "dryRun": false}' | jq '.stats'
```

**Repeat 5-6 times** until you've processed all ~28,914 observations.

**Note:** Each batch takes ~2-3 minutes. Total time: 15-20 minutes.

**Track progress:**
```bash
# After each batch, check coverage
curl https://duxsoup.onrender.com/api/health/parity | jq .metrics.coverage_percent
```

You should see:
- Batch 1: ~35%
- Batch 2: ~48%
- Batch 3: ~61%
- Batch 4: ~74%
- Batch 5: ~87%
- Batch 6: ~90%+

---

### ✅ Step 7: Final Coverage Check (30 sec)

```bash
curl https://duxsoup.onrender.com/api/health/parity | jq '{
  people_count: .metrics.people_count,
  coverage_percent: .metrics.coverage_percent,
  ready_for_cutover: .ready_for_cutover,
  blockers: .blockers
}'
```

**Expected result:**
```json
{
  "people_count": 26000,
  "coverage_percent": 90,
  "ready_for_cutover": false,
  "blockers": ["Coverage ratio 90.00% below 98% threshold"]
}
```

---

### ✅ Step 8: Check Upgradability (30 sec)

Now check if linking job can help:

```bash
curl https://duxsoup.onrender.com/api/admin/check-upgradable | jq '{
  upgradable_count,
  percent_upgradable,
  recommendation
}'
```

**If upgradable > 0** → Run linking job to boost coverage to 95-98%

**If upgradable = 0** → Accept 90% coverage, operate in hybrid mode

---

### ✅ Step 9: Run Linking Job (If Needed) (5-10 min)

```bash
# Dry run
curl -X POST https://duxsoup.onrender.com/api/admin/run-linking \
  -H "Content-Type: application/json" \
  -d '{"limit": 100, "dryRun": true}' | jq '.'

# Execute
curl -X POST https://duxsoup.onrender.com/api/admin/run-linking \
  -H "Content-Type: application/json" \
  -d '{"limit": 1000, "dryRun": false}' | jq '.stats'
```

---

### ✅ Step 10: Final Decision (1 min)

Check final coverage:

```bash
curl https://duxsoup.onrender.com/api/health/parity | jq '{
  coverage_percent: .metrics.coverage_percent,
  ready_for_cutover: .ready_for_cutover
}'
```

**Decision Matrix:**

| Coverage | Action | Next Step |
|----------|--------|-----------|
| ≥ 98% | **Switch to People-Only** | Update env: `READ_SOURCE=people`, redeploy |
| 90-98% | **Stay in Hybrid Mode** ✅ | No changes needed - production ready |
| < 90% | **Investigate** | Something went wrong, check logs |

---

## Expected Timeline

```
Step 1: Deployment          →  2-3 min
Step 2: Verify new webhooks →  5 min (passive)
Step 3: Dry run             →  1 min
Step 4: Test batch          →  2 min
Step 5: Check coverage      →  30 sec
Step 6: Full rebuild        →  15-20 min (6 batches)
Step 7: Final check         →  30 sec
Step 8: Check linking       →  30 sec
Step 9: Linking (optional)  →  5-10 min
Step 10: Decision           →  1 min
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL:                        25-35 min
```

---

## Troubleshooting

### Issue: "people_upserted: 0" during rebuild

**Cause:** Fix not deployed yet, or still using old code
**Solution:** Wait for deployment, verify Step 2 first

### Issue: High error rate (>20%)

**Cause:** Some observations genuinely lack IDs
**Solution:** This is expected - 10-20% error rate is normal

### Issue: Coverage only reaches 70-80%

**Cause:** Some observations still lack stable IDs
**Solution:** Run linking job (Step 9) to improve further

### Issue: API timeouts

**Cause:** Batch size too large
**Solution:** Reduce limit to 2000 per batch, run more batches

---

## Quick Reference Commands

```bash
# Check if deployed
curl https://duxsoup.onrender.com/api/test

# Check current coverage
curl https://duxsoup.onrender.com/api/health/parity | jq .metrics.coverage_percent

# Run rebuild batch
curl -X POST https://duxsoup.onrender.com/api/admin/rebuild-people \
  -H "Content-Type: application/json" \
  -d '{"limit": 5000, "dryRun": false}' | jq '.stats'

# Check upgradability
curl https://duxsoup.onrender.com/api/admin/check-upgradable | jq .upgradable_count

# Run linking
curl -X POST https://duxsoup.onrender.com/api/admin/run-linking \
  -H "Content-Type: application/json" \
  -d '{"limit": 1000, "dryRun": false}' | jq '.stats'
```

---

## Success Criteria

✅ **Deployment complete** - API responding
✅ **New webhooks working** - No more "Cannot upsert" warnings
✅ **Rebuild complete** - All batches finished
✅ **Coverage improved** - From 21.6% to 90%+
✅ **System stable** - No errors in logs
✅ **Production ready** - Hybrid mode working perfectly

---

## What To Do After

**If Coverage ≥ 98%:**
- Update Render env var: `READ_SOURCE=people`
- Redeploy
- Monitor for 15 minutes
- System is now in people-only mode

**If Coverage 90-98%:**
- **No action needed** - already in hybrid mode
- System is production ready
- Monitor weekly
- Re-evaluate in 3-6 months

**Documentation:**
- Save this execution log
- Document final coverage percentage
- Note any issues encountered

---

**Ready to start? Begin with Step 1!**
