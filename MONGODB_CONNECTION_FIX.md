# MongoDB Connection Error Fix

## Problem

Webhooks were failing with `MongoNotConnectedError: Client must be connected before running operations` in production (Render).

## Root Causes

### 1. **Short Connection Timeout (5 seconds)**
- `serverSelectionTimeoutMS: 5000` was too short for cloud MongoDB instances
- During deployment, MongoDB can take >5s to respond
- Connection would silently timeout, but server would still start

### 2. **Race Condition in Connection State Tracking**
```javascript
// OLD CODE - Bug:
this.isConnected = true;  // Custom flag
// But mongoose.connection.readyState might still be 2 (connecting)!
```

The custom `isConnected` boolean was **separate** from Mongoose's actual connection state. When MongoDB disconnected/reconnected (common in cloud environments):
- Event listeners would update `isConnected`
- But Mongoose's internal state might not be ready yet
- Webhooks would arrive and fail

### 3. **Event Listeners Registered Too Late**
```javascript
// OLD CODE - Bug:
await mongoose.connect(mongoUri);
// Connection succeeds...
mongoose.connection.on('disconnected', ...) // Registered AFTER connection
```

If MongoDB disconnected during the startup sequence, the event handlers weren't registered yet.

## The Fix

### ✅ 1. Increased Connection Timeout
```javascript
serverSelectionTimeoutMS: 30000  // 5s → 30s
```

Gives MongoDB enough time to respond during slow cloud starts.

### ✅ 2. Use Mongoose's Canonical State
```javascript
// NEW CODE - Fixed:
if (mongoose.connection.readyState !== 1) {
  throw new Error('MongoDB connection not ready');
}

isReady() {
  return mongoose.connection.readyState === 1 && this.connectionReady;
}
```

Now we check **both**:
- `mongoose.connection.readyState === 1` (Mongoose says connected)
- `this.connectionReady` (Our event listeners confirm it's stable)

### ✅ 3. Register Event Listeners BEFORE Connection
```javascript
// NEW CODE - Fixed:
constructor() {
  this.setupEventListeners();  // Register FIRST
}

async connect() {
  await mongoose.connect(...);  // Then connect
}
```

### ✅ 4. Added Request-Level DB Readiness Check
```javascript
// NEW middleware in index.js:
app.use((req, res, next) => {
  if (!database.isReady()) {
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Database not ready. Retry in a few seconds.'
    });
  }
  next();
});
```

**Benefits:**
- Prevents `MongoNotConnectedError` - returns clean 503 instead
- DuxSoup will retry webhooks (they use exponential backoff)
- No data loss - webhooks queue until DB is ready

### ✅ 5. Health Endpoint Now Fails When DB is Down
```javascript
// OLD: Always returned 200, even if DB was down
// NEW: Returns 503 if database.isReady() === false
```

**Benefits:**
- Render's load balancer can detect unhealthy instances
- Auto-restarts if DB connection is permanently lost
- Better monitoring/alerting

## Testing the Fix

### Manual Test (Local)
```bash
# Terminal 1: Start MongoDB
mongod

# Terminal 2: Start app
npm run dev

# Terminal 3: Check health
curl http://localhost:3000/health
# Should show: "status": "ok", "database": { "isConnected": true }

# Terminal 1: Stop MongoDB (Ctrl+C)

# Terminal 3: Check health again
curl http://localhost:3000/health
# Should show: "status": "degraded" (503)

# Try sending a webhook
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"type": "scan", "id": "test"}'
# Should get: 503 "Database not ready"
```

### Production Verification (Render)
```bash
# Check health endpoint
curl https://your-render-app.onrender.com/health

# Should show:
{
  "status": "ok",
  "database": {
    "isConnected": true,
    "connectionReady": true,
    "readyState": 1,
    "readyStateText": "connected"
  }
}
```

## Deployment Checklist

- [x] Increased connection timeout to 30s
- [x] Fixed connection state tracking
- [x] Added request-level DB readiness check
- [x] Health endpoint now returns 503 when unhealthy
- [x] Event listeners registered before connection

## Next Steps (Optional)

Consider adding:
1. **Retry logic** in `database.connect()` with exponential backoff
2. **Circuit breaker** pattern for dead_letters if DB is consistently down
3. **Alerting** when DB disconnection lasts >1 minute
4. **Connection pooling** tuning (currently 2-10 connections)

## Files Changed

- `src/utils/database.js` - Fixed connection management
- `src/index.js` - Added DB readiness middleware + health check updates
