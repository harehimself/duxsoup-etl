# Execute Cutover Now - Production Commands

**Status**: ✅ All code ready and tested
**Environment**: Production (requires MongoDB)
**Estimated time**: 20-30 minutes
**Rollback time**: 10 seconds

## Prerequisites

- [ ] SSH access to production server
- [ ] Production MongoDB running
- [ ] Application deployed and running
- [ ] Backup recent (recommended)

## Step-by-Step Execution

### 1. SSH to Production

```bash
ssh production-server
cd /path/to/duxsoup-etl
```

### 2. Run Pre-Flight Check (2 min)

```bash
# Validate system is ready
./scripts/pre-flight-check.sh

# Expected output:
# ✓ API is responding
# ✓ MongoDB connection active
# ✓ Success rate >= 95%
# ✓ Coverage >= 98%
# ✓ System ready for cutover
```

**If pre-flight fails:**
- Fix issues shown in output
- Re-run pre-flight check
- Do not proceed until all green

### 3. Run Identity Linking Job (10-15 min)

```bash
# Preview first (safe)
node scripts/linkIdentities.js --dry-run --limit=20

# Review output, then execute
node scripts/linkIdentities.js --commit --limit=500 --batch-size=20

# Expected output:
# Found 150 upgradable people
# Merged: 145
# Already linked: 3
# Failed: 2
# ✅ Linking job complete
```

### 4. Verify Gates Again (1 min)

```bash
curl http://localhost:3000/api/health/parity | jq '.ready_for_cutover, .metrics.coverage_percent'

# Should show:
# true
# 98.5  (or higher)
```

### 5. Execute Cutover (1 min)

```bash
# Set environment
export READ_SOURCE=people

# Restart service (choose your method):
pm2 restart duxsoup-etl
# OR
systemctl restart duxsoup-etl
# OR
docker-compose restart duxsoup-etl
```

### 6. Immediate Validation (2 min)

```bash
# Verify mode switched
curl http://localhost:3000/api/health/metrics | jq '.read_source'
# Expected: "people"

# Check initial metrics
curl http://localhost:3000/api/people/metrics | jq '.metrics | {
  people_read_success_rate,
  people_read_not_found_rate,
  legacy_fallback_hit_rate
}'

# Test known person (replace with real ID from your system)
curl http://localhost:3000/api/people/ACwAAABCDEF | jq '.success, .source'
# Expected: true, "people"
```

### 7. Monitor for 15 Minutes

```bash
# Run this every 5 minutes for 15 minutes
watch -n 300 'curl -s http://localhost:3000/api/people/metrics | jq ".metrics | {
  attempts: .people_read_attempts,
  success_rate: .people_read_success_rate,
  not_found_rate: .people_read_not_found_rate
}"'

# Watch for:
# - success_rate staying > 99%
# - not_found_rate staying < 1%
# - attempts increasing (proving it's working)
```

### 8. Check Logs

```bash
# Watch for errors
tail -f /var/log/duxsoup-etl/app.log | grep -E '(404|error|ERROR)'

# Should see normal traffic, no spike in errors
```

## Success Criteria

After 15 minutes of monitoring:

- [ ] `read_source` shows `"people"`
- [ ] `people_read_success_rate > 99%`
- [ ] `people_read_not_found_rate < 1%`
- [ ] No unexpected 404 spikes in logs
- [ ] Application responding normally

## If Issues Occur - ROLLBACK

**Instant rollback (10 seconds):**

```bash
# Revert to legacy mode
export READ_SOURCE=legacy

# Restart
pm2 restart duxsoup-etl

# Verify
curl http://localhost:3000/api/health/metrics | jq '.read_source'
# Should show: "legacy"
```

**Then investigate:**
```bash
# Check what went wrong
curl http://localhost:3000/api/people/metrics | jq '.'
curl http://localhost:3000/api/health/parity | jq '.'

# Review logs
tail -100 /var/log/duxsoup-etl/app.log
```

## Alternative: Hybrid Mode First (Conservative Approach)

If nervous about direct cutover:

```bash
# Step 1: Flip to hybrid
export READ_SOURCE=hybrid
pm2 restart duxsoup-etl

# Step 2: Monitor fallback rate for 1-2 hours
watch -n 900 'curl -s http://localhost:3000/api/people/metrics | jq ".metrics.legacy_fallback_hit_rate"'

# Step 3: When fallback rate < 0.5%, flip to people
export READ_SOURCE=people
pm2 restart duxsoup-etl
```

## Post-Cutover (After 1 Hour)

```bash
# Collect metrics
curl http://localhost:3000/api/people/metrics > metrics-$(date +%Y%m%d-%H%M).json

# Check health
curl http://localhost:3000/api/health/metrics | jq '.'

# Verify success criteria:
# - people_read_success_rate_24h > 99%
# - people_read_not_found_rate_24h < 0.5%
# - No rollbacks needed
```

## Troubleshooting

### High Not-Found Rate

```bash
# Check coverage
curl http://localhost:3000/api/health/coverage-breakdown | jq '.'

# Run linking job again
node scripts/linkIdentities.js --commit --limit=200

# Or rollback to hybrid
export READ_SOURCE=hybrid && pm2 restart duxsoup-etl
```

### Specific 404s

```bash
# Check if person exists
mongo duxsoup-etl --eval 'db.people.findOne({_id: "ACwAAABCDEF"})'

# Check legacy
mongo duxsoup-etl --eval 'db.visits.findOne({Profile: "ACwAAABCDEF"})'

# Check dead letters
curl http://localhost:3000/api/health/ingestion | jq '.metrics.dead_letters_pending'
```

## Timeline

| Time | Action | Expected Result |
|------|--------|----------------|
| T+0 | Pre-flight check | All green |
| T+2 | Run linking job | 100-500 merges |
| T+15 | Flip to people mode | read_source="people" |
| T+17 | Immediate validation | Success rate > 99% |
| T+30 | 15min monitoring | Metrics stable |
| T+75 | 1hr checkpoint | All success criteria met |

## Notes

- **Dual-write continues**: Ingestion unchanged, both systems stay updated
- **Reads only affected**: Only GET /api/people/* endpoints use new mode
- **Instant rollback**: Change env var and restart (10 seconds)
- **No data loss risk**: Legacy data untouched, people data complete
- **Metrics reset on restart**: Track trends, expect growth

## Help

If stuck:
1. Check CUTOVER-MANUAL.md for detailed troubleshooting
2. Review pre-flight check output
3. Rollback to legacy if uncertain
4. Dual-write ensures no data loss during investigation

---

**Ready to execute. All infrastructure tested and committed.**
