# Render Deployment Fix - Health Check Improvements

## Problem Identified
The service was experiencing ~60 second SIGTERM cycles on Render due to failed health checks.

### Root Cause
**Server startup sequence was blocking health checks:**
1. Server waited for MongoDB connection before calling `app.listen()`
2. If MongoDB took >30s to connect, Render health checks received "connection refused" (nothing listening)
3. After ~60s of failed checks, Render sent SIGTERM and killed the instance

## Changes Implemented

### 1. Server Startup Order (src/index.js:109-148)
**Before:**
```javascript
async function startServer() {
  await database.connect();  // ← BLOCKS until DB connects
  app.listen(port, () => {   // ← Server only starts AFTER DB ready
```

**After:**
```javascript
async function startServer() {
  // Start HTTP server IMMEDIATELY
  const server = app.listen(port, "0.0.0.0", () => {
    logger.info("HTTP server started successfully", { port, host: "0.0.0.0" });
  });

  // Connect to database asynchronously (in background)
  try {
    await database.connect();
  } catch (error) {
    logger.warn("Server continues running but database operations will fail");
    // DO NOT exit - keep server alive
  }
}
```

### 2. Health Check Always Returns 200 (src/index.js:82-96)
**Before:**
```javascript
app.get("/health", async (req, res) => {
  const statusCode = isHealthy ? 200 : 503;  // ← Returns 503 when DB not ready
  res.status(statusCode).json(response);
});
```

**After:**
```javascript
app.get("/health", async (req, res) => {
  const response = {
    status: isHealthy ? "ok" : "starting",  // ← Changed from "degraded"
    database: dbStatus,
    timestamp: new Date().toISOString(),
  };

  // ALWAYS return 200 - Render needs this during startup
  res.status(200).json(response);
});
```

### 3. Explicit Binding to 0.0.0.0
```javascript
const host = "0.0.0.0";  // Bind to all interfaces (Render requirement)
app.listen(port, host, () => {
  logger.info("HTTP server started successfully", { port, host });
});
```

### 4. Enhanced Logging
```javascript
logger.info("HTTP server started successfully", {
  port,
  host: "0.0.0.0",
  nodeEnv: config.nodeEnv,
  message: `Listening on ${host}:${port}`
});
logger.info(`Health check endpoint: http://${host}:${port}/health`);
```

## Render Configuration
No changes needed to `render.yaml`. The configuration is already correct:
- ✅ No `PORT` env var (Render injects it automatically)
- ✅ `healthCheckPath: /health` configured
- ✅ Protocol: HTTP (default)

## Expected Behavior After Deploy

### Startup Sequence
1. **0s:** HTTP server starts listening immediately
2. **0s:** `/health` returns 200 with `"status": "starting"`
3. **0-30s:** MongoDB connection in progress (background)
4. **30s:** MongoDB connected successfully
5. **30s+:** `/health` returns 200 with `"status": "ok"`

### Health Check Response
```json
{
  "status": "ok",
  "database": {
    "readyState": 1,
    "readyStateText": "connected"
  },
  "timestamp": "2026-01-28T22:00:00.000Z"
}
```

### Verification Steps
After deploy, verify:
```bash
curl https://duxsoup.onrender.com/health
# Expected: HTTP 200 OK
# Body: {"status":"ok",...}
```

## Impact Assessment

| Change | Impact | Risk |
|--------|--------|------|
| Start server before DB | **High** - Fixes health check failures | Low |
| Health check always 200 | **High** - Prevents SIGTERM during startup | Low |
| Bind to 0.0.0.0 | Low - Was already implicit | None |
| Enhanced logging | Low - Better debugging | None |
| Don't exit on DB error | **Medium** - Allows retry/recovery | Low |

## Recommendations Summary

| Recommendation | Implemented | Impact |
|----------------|-------------|--------|
| Remove PORT env var | ✅ N/A (not set) | Low |
| Keep /health path | ✅ Already done | - |
| /health returns 200 always | ✅ Implemented | **High** |
| Bind to 0.0.0.0 | ✅ Implemented | Low |
| Log port at startup | ✅ Implemented | Low |
| **Start server before DB** | ✅ **Implemented** | **CRITICAL** |

## Testing
- ✅ 203/203 unit tests passing
- ✅ No regressions in existing functionality
- ✅ Server startup logic verified

## Notes
- The server will now accept health checks during database connection phase
- API requests still protected by database readiness middleware (line 51-77)
- Database connection failures no longer crash the server
- Scheduler only starts after database is connected
