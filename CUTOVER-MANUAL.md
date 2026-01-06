# Production Cutover - Manual Steps

Quick reference for executing cutover in production.

## Prerequisites

- MongoDB running
- Application deployed and running
- Access to production server

## Option 1: Automated Script (Recommended)

```bash
# Dry run (safe, shows what would happen)
API_URL=http://localhost:3000 ./scripts/cutover.sh

# Actual execution
API_URL=http://localhost:3000 DRY_RUN=false ./scripts/cutover.sh
```

## Option 2: Manual Steps

### Step 0: Identity Merge Sweep (10-15 min)

```bash
# Preview
node scripts/linkIdentities.js --dry-run --limit=20

# Execute
node scripts/linkIdentities.js --commit --limit=500 --batch-size=20
```

**Expected output:**
```
Found 150 upgradable people
Sample upgradable people:
  linkedin.com/in/johndoe → ACwAAABCDEF (salesNavId)
  linkedin.com/in/janedoe → ACwAAAXYZ123 (salesNavId)

Progress: 150/150 people processed

✅ Linking job complete!
Statistics:
  Found: 150
  Merged: 145
  Already linked: 3
  Skipped: 0
  Failed: 2
```

### Step 1: Confirm Gates (2 min)

```bash
# Ingestion health (need success_rate >= 95%)
curl http://localhost:3000/api/health/ingestion | jq '.'

# Parity health (need coverage_ratio >= 0.98)
curl http://localhost:3000/api/health/parity | jq '.'

# Coverage breakdown (want low url_fallback_only)
curl http://localhost:3000/api/health/coverage-breakdown | jq '.'

# Current metrics
curl http://localhost:3000/api/health/metrics | jq '.'
```

**Gate checklist:**
- [ ] `people_upsert_success_rate_24h >= 95%`
- [ ] `coverage_ratio >= 0.98` (or >= 0.95 with low fallback rate)
- [ ] `dead_letters_pending < 10`
- [ ] `ready_for_cutover: true`

If gates fail, investigate before proceeding.

### Step 2: Flip to People-Only (1 min)

```bash
# Set environment variable
export READ_SOURCE=people

# Restart service (choose your method)
pm2 restart duxsoup-etl
# OR
systemctl restart duxsoup-etl
# OR
docker-compose restart duxsoup-etl
```

### Step 3: Validate Immediately (5 min)

```bash
# Verify mode
curl http://localhost:3000/api/health/metrics | jq '.read_source'
# Should return: "people"

# Check metrics
curl http://localhost:3000/api/people/metrics | jq '.'

# Test known person by ID
curl http://localhost:3000/api/people/ACwAAABCDEF | jq '.'

# Test known person by alias
curl http://localhost:3000/api/people/by-alias/linkedin.com/in/johndoe | jq '.'
```

**Expected results:**
- `read_source` should be `"people"`
- No fallback hits (metric should be 0)
- Known IDs return successfully
- `people_read_success_rate` should be high

### Step 4: Watch for Regressions (First Hour)

**Monitor every 15 minutes:**
```bash
# Get metrics
curl http://localhost:3000/api/people/metrics | jq '.metrics'

# Check for issues
curl http://localhost:3000/api/health/metrics | jq '.reads'
```

**Warning signs:**
- `people_read_not_found_rate_24h > 1%`
- Unexpected 404s for known-good IDs
- Dead letters rising (shouldn't be impacted, but watch)
- Application errors in logs

**Log monitoring:**
```bash
# Watch for errors
tail -f /var/log/duxsoup-etl/app.log | grep -E '(404|error)'

# Watch access logs
tail -f /var/log/nginx/access.log | grep 'api/people'
```

## Rollback

### Instant Rollback (if anything fails)

```bash
# Revert to legacy mode
export READ_SOURCE=legacy

# Restart
pm2 restart duxsoup-etl

# Verify
curl http://localhost:3000/api/health/metrics | jq '.read_source'
# Should return: "legacy"
```

### Rollback to hybrid (less aggressive)

```bash
export READ_SOURCE=hybrid
pm2 restart duxsoup-etl
```

## Success Criteria

### After 1 hour:
- [ ] `people_read_not_found_rate_24h < 0.5%`
- [ ] No unexpected 404 spikes
- [ ] Application errors stable
- [ ] Dead letters near zero

### After 24 hours:
- [ ] `people_read_success_rate_24h > 99%`
- [ ] Business metrics unchanged
- [ ] User reports normal
- [ ] No rollbacks needed

## Troubleshooting

### High not-found rate

**Symptom:** `people_read_not_found_rate_24h > 1%`

**Actions:**
1. Check coverage breakdown:
   ```bash
   curl http://localhost:3000/api/health/coverage-breakdown | jq '.'
   ```
2. Run linking job again:
   ```bash
   node scripts/linkIdentities.js --commit --limit=200
   ```
3. Consider rolling back to hybrid if rate stays high

### 404s for known IDs

**Symptom:** Specific IDs returning 404 that should exist

**Actions:**
1. Check if person exists:
   ```bash
   mongo duxsoup-etl --eval 'db.people.findOne({_id: "ACwAAABCDEF"})'
   ```
2. Check legacy data:
   ```bash
   mongo duxsoup-etl --eval 'db.visits.findOne({Profile: "ACwAAABCDEF"})'
   ```
3. If exists in legacy but not people, check dead letters:
   ```bash
   mongo duxsoup-etl --eval 'db.dead_letters.find({}).pretty()'
   ```

### Dead letters increasing

**Symptom:** `dead_letters_pending` rising unexpectedly

**Actions:**
1. This is independent of read mode (dual-write continues)
2. Check PersonController logs for errors
3. Run replay worker:
   ```bash
   node scripts/replayDeadLetters.js --once --limit=50
   ```

## Post-Cutover

### After 1 week of stability:

1. **Monitor metrics daily:**
   ```bash
   curl http://localhost:3000/api/health/metrics | jq '.' > metrics-$(date +%Y%m%d).json
   ```

2. **Consider optional cleanup:**
   - Legacy read paths can be deprecated (but keep for safety)
   - Dual-write should continue indefinitely
   - Document READ_SOURCE flag in ops runbook

3. **Update documentation:**
   - Mark cutover as complete
   - Update API docs to reference /api/people/* endpoints
   - Train team on new endpoints

## Notes

- **Dual-write continues**: Ingestion still writes to both systems
- **Rollback is instant**: Just change env var and restart
- **Reads are independent**: Cutover only affects GET endpoints
- **Metrics reset on restart**: Track trends daily
- **Legacy data remains**: Visits/scans collections unchanged
