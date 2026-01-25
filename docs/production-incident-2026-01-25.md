# Production Incident Report: Scheduled Job Disconnecting Database

**Date:** 2026-01-25
**Status:** ✅ RESOLVED
**Severity:** CRITICAL
**Duration:** ~37 minutes (07:00:00 - 07:38:12)

## Summary

Scheduled dead letter replay job was disconnecting the shared MongoDB connection, causing all webhook requests to fail after the job completed.

## Timeline

- **07:00:00** - Dead letter replay scheduled job runs
- **07:00:00** - Job completes, disconnects MongoDB (`database.disconnect()`)
- **07:00:00** - Main application now has no database connection
- **07:38:12** - First webhook requests arrive, rejected with "database not ready"
- **07:38:12** - Multiple webhook failures logged (13+ requests rejected)

## Root Cause

The `replayDeadLetters` script was designed for both:
1. **CLI usage** - Should connect and disconnect its own database connection
2. **Scheduler usage** - Should use the shared database connection

However, the script **always disconnected** after completing:

```javascript
// scripts/replayDeadLetters.js (before fix)
async function replayDeadLetters(options = {}) {
  await database.connect();     // ← Connects
  // ... process dead letters ...
  await database.disconnect();  // ← Always disconnects (WRONG for scheduler!)
  return stats;
}
```

When called from the scheduler:
```javascript
// src/workers/scheduler.js (before fix)
cron.schedule('0 * * * *', async () => {
  const stats = await replayDeadLetters({ dryRun: false, limit: 100 });
  // ← Script just disconnected the shared connection!
});
```

## Impact

**Webhooks failed for 37+ minutes:**
- All POST `/api/webhook` requests rejected with 503 Service Unavailable
- Error message: "Database connection not ready"
- Data loss: Incoming webhook data was rejected (not queued)

**Affected requests:**
```
warn: Request rejected - database not ready
  path: /api/webhook
  method: POST
  dbState: disconnected
```

Logs show 13+ rejected requests in the window shown, likely more throughout the hour.

## Fix

Added `managedConnection` option to control connection lifecycle:

```javascript
// scripts/replayDeadLetters.js (after fix)
async function replayDeadLetters(options = {}) {
  const { managedConnection = false } = options;

  // Only connect if not using managed connection (CLI mode)
  if (!managedConnection) {
    await database.connect();
  }

  // ... process dead letters ...

  // Only disconnect if we connected (CLI mode)
  if (!managedConnection) {
    await database.disconnect();
  }

  return stats;
}
```

Scheduler now passes `managedConnection: true`:

```javascript
// src/workers/scheduler.js (after fix)
cron.schedule('0 * * * *', async () => {
  const stats = await replayDeadLetters({
    dryRun: false,
    limit: 100,
    managedConnection: true  // ← Don't disconnect shared connection
  });
});
```

## Deployment

**Commit:** `a49ace0` - fix(scheduler): Prevent scheduled jobs from disconnecting shared DB connection
**Pushed:** 2026-01-25 07:42 UTC
**Deploy:** Automatic via Render (monitor logs for next hourly run)

## Prevention

### Immediate
- ✅ Fixed scheduler to use `managedConnection: true`
- ✅ CLI mode continues to work (manages own connection)

### Long-term

1. **Add connection state monitoring:**
   ```javascript
   // In scheduler, after job completes:
   const dbStatus = database.getConnectionStatus();
   if (!database.isReady()) {
     logger.error('CRITICAL: Job disconnected database!', dbStatus);
     await database.connect(); // Reconnect immediately
   }
   ```

2. **Add database connection health check:**
   ```javascript
   // In health check job:
   if (!database.isReady()) {
     report.criticalIssues.push({
       type: 'database_disconnected',
       severity: 'critical',
       message: 'Database connection lost'
     });
   }
   ```

3. **Add integration test:**
   ```javascript
   test('scheduled job should not disconnect database', async () => {
     await database.connect();
     expect(database.isReady()).toBe(true);

     // Run job
     await replayDeadLetters({ managedConnection: true });

     // Connection should still be alive
     expect(database.isReady()).toBe(true);
   });
   ```

## Monitoring

**Watch for this pattern in logs:**
```
info: Scheduled dead letter replay complete
warn: MongoDB disconnected
warn: Request rejected - database not ready
```

**Next scheduled run:** Every hour at :00
**Next verification:** 2026-01-25 08:00 UTC (watch logs)

## Related Issues

- Commit `5fcf1f7` - Fixed MongoDB connection race conditions (different issue)
- This issue was introduced when scheduler was added (commit unknown)
- No similar issues in health check job (doesn't manage connection)

## Lessons Learned

1. **Shared resources need lifecycle management** - Scripts that can be called both standalone and as library functions need to handle connection management carefully

2. **Test both modes** - When a function supports multiple usage patterns (CLI vs library), test both

3. **Monitor critical paths** - Database connection state should be monitored and alerted

4. **Fail fast on disconnection** - Consider adding automatic reconnection logic when connection is lost unexpectedly

---

**Related Files:**
- `scripts/replayDeadLetters.js` - Dead letter replay script
- `src/workers/scheduler.js` - Background job scheduler
- `src/utils/database.js` - Database connection singleton
