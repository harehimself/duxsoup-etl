# Cutover Guide: Legacy → People Collection

Safe, reversible cutover from visits/scans to canonical people collection.

## Overview

This system implements a **hybrid cutover** approach:
- **Phase 1**: Hybrid mode (people-first + legacy fallback)
- **Phase 2**: People-only (no fallback)

**Rollback time**: Seconds (just change env var and restart)

## Environment Flag

```bash
READ_SOURCE=hybrid  # Default - try people, fallback to legacy
READ_SOURCE=people  # People-only, no fallback
READ_SOURCE=legacy  # Old behavior (visits/scans only)
```

## Pre-Cutover Checklist

### 1. Run linking job
```bash
# Preview
node scripts/linkIdentities.js --dry-run --limit=10

# Execute (start with small batch)
node scripts/linkIdentities.js --commit --limit=100

# Full run (after testing)
node scripts/linkIdentities.js --commit --limit=500 --batch-size=20
```

### 2. Check cutover gates
```bash
# Parity health
curl http://localhost:3000/api/health/parity

# Should show:
# - coverage_ratio >= 0.98
# - ready_for_cutover: true
# - dead_letters < 10

# Coverage breakdown
curl http://localhost:3000/api/health/coverage-breakdown

# Should show:
# - Low url_fallback_only count
# - Most people have stable IDs
```

### 3. Verify ingestion health
```bash
curl http://localhost:3000/api/health/ingestion

# Should show:
# - success_rate >= 95%
# - dead_letters_pending near zero
```

## Cutover Steps

### Flip A: Enable Hybrid Mode

**1. Set environment:**
```bash
export READ_SOURCE=hybrid
```

**2. Restart service:**
```bash
npm start
# or
pm2 restart duxsoup-etl
```

**3. Verify mode:**
```bash
curl http://localhost:3000/api/health/metrics

# Should show:
# "read_source": "hybrid"
```

**4. Generate traffic:**
```bash
# Test read endpoints
curl http://localhost:3000/api/people/ACwAAABCDEF
curl http://localhost:3000/api/people/by-alias/linkedin.com/in/someone
```

**5. Monitor for 2-6 hours:**
```bash
# Check metrics every 15 minutes
curl http://localhost:3000/api/people/metrics

# Watch for:
# - people_read_success_rate trending up
# - legacy_fallback_hit_rate trending down
# - No spike in errors
```

**6. Check logs for fallbacks:**
```bash
grep "FALLBACK_TO_LEGACY" logs/app.log | tail -20

# Each fallback logs:
# - person_id or alias_value
# - reason (always "not_found" for hybrid)
# - endpoint
```

### Flip B: People-Only Mode

**Only proceed when:**
- ✅ coverage_ratio >= 0.98
- ✅ legacy_fallback_hit_rate_24h <= 0.5% (ideally ~0%)
- ✅ No increase in read errors
- ✅ Dead letters near zero

**1. Set environment:**
```bash
export READ_SOURCE=people
```

**2. Restart service:**
```bash
npm start
# or
pm2 restart duxsoup-etl
```

**3. Verify mode:**
```bash
curl http://localhost:3000/api/health/metrics

# Should show:
# "read_source": "people"
```

**4. Monitor closely for 24 hours:**
```bash
# Check metrics frequently
curl http://localhost:3000/api/people/metrics

# Watch for:
# - people_read_not_found_rate (should be low)
# - No legacy_fallback_hits (mode doesn't allow it)
# - Read errors stable
```

## Rollback

### Instant Rollback (any phase)

```bash
# Revert to legacy mode
export READ_SOURCE=legacy

# Restart
pm2 restart duxsoup-etl

# Verify
curl http://localhost:3000/api/health/metrics
# Should show: "read_source": "legacy"
```

**No data migration needed** - dual-write continues regardless of read mode.

### Rollback from people-only to hybrid

```bash
export READ_SOURCE=hybrid
pm2 restart duxsoup-etl
```

## Monitoring Endpoints

### Health metrics (combined)
```bash
curl http://localhost:3000/api/health/metrics

# Returns:
{
  "read_source": "hybrid",
  "reads": {
    "people_read_success_rate_24h": 99.5,
    "people_read_not_found_rate_24h": 0.3,
    "legacy_fallback_hit_rate_24h": 0.2,
    "legacy_fallback_hits_24h": 15,
    "people_read_attempts": 7500
  },
  "ingestion": { ... },
  "parity": { ... }
}
```

### Read metrics (detailed)
```bash
curl http://localhost:3000/api/people/metrics

# Returns all read counters:
{
  "read_source": "hybrid",
  "metrics": {
    "people_read_attempts": 7500,
    "people_read_success": 7485,
    "people_read_not_found": 15,
    "legacy_fallback_hits": 15,
    "legacy_fallback_success": 12,
    "legacy_fallback_not_found": 3,
    "people_read_success_rate": 99.80,
    "people_read_not_found_rate": 0.20,
    "legacy_fallback_hit_rate": 0.20,
    "last_reset": "2026-01-06T10:00:00.000Z"
  }
}
```

## Success Criteria

### Hybrid Mode (Phase 1)
- ✅ legacy_fallback_hit_rate < 1%
- ✅ people_read_success_rate > 99%
- ✅ No increase in API errors
- ✅ Dual-write success rate stable

### People-Only Mode (Phase 2)
- ✅ people_read_not_found_rate < 0.5%
- ✅ coverage_ratio >= 0.98
- ✅ No legacy fallbacks (metric should be 0)
- ✅ Business metrics unchanged

## Troubleshooting

### High fallback rate in hybrid mode

**Symptom**: `legacy_fallback_hit_rate_24h > 2%`

**Fix**:
```bash
# 1. Check coverage breakdown
curl http://localhost:3000/api/health/coverage-breakdown

# 2. Run linking job again
node scripts/linkIdentities.js --commit --limit=200

# 3. Check for missing observations
# (people may exist in legacy but not in people yet)
```

### Reads failing in people-only mode

**Symptom**: 404 errors increasing

**Fix**:
```bash
# Immediate rollback to hybrid
export READ_SOURCE=hybrid
pm2 restart duxsoup-etl

# Investigate missing people
curl http://localhost:3000/api/health/parity
```

### Dual-write failures spiking

**Symptom**: `dead_letters_pending` increasing

**Fix**:
```bash
# This is independent of read mode
# Run replay worker
node scripts/replayDeadLetters.js --once --limit=100

# If persistent, check PersonController logs
```

## Timeline (Recommended)

**Day 1:**
- Run linking job (morning)
- Enable hybrid mode (afternoon)
- Monitor for 6 hours

**Day 2:**
- Check metrics (morning)
- If fallback rate < 0.5%, proceed to people-only
- Monitor closely for 24 hours

**Day 3+:**
- Continue monitoring
- If stable for 1 week, consider deprecating legacy read paths
- Dual-write continues indefinitely for safety

## Notes

- **Dual-write remains active** regardless of read mode
- **Ingestion (webhooks) unchanged** - still writes to both systems
- **Read mode only affects** GET /api/people/* endpoints
- **Rollback is instant** - just change env var and restart
- **Metrics reset on restart** - track daily for trends
