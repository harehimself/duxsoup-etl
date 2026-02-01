---
paths: "src/routes/**/*.js,src/controllers/**/*Controller.js,src/controllers/**/*Handler.js"
---

# API & Route Standards

## Mandatory Behavior
**When adding or modifying API routes and controllers:**
1. Follow the response envelope format for the endpoint type
2. Apply the correct rate limiter tier
3. Validate all parameters before processing
4. Cap pagination limits with `Math.min()`
5. Use `AppError` for all error responses
6. Protect mutation endpoints with `webhookAuth` middleware

## Response Envelope Formats

This project uses three response styles. Match the style of the endpoint group you're working in.

### CRUD & Query Responses (most endpoints)
```javascript
// Success
res.json({
  success: true,
  data: { ... },
  total: 100,    // Include for list endpoints
  limit: 20,     // Include for paginated endpoints
  offset: 0      // Include for paginated endpoints
});

// Error
res.status(400).json({
  success: false,
  error: 'VALIDATION_ERROR',
  message: 'Human-readable description'
});
```

### Admin & Migration Responses
```javascript
// Success
res.json({
  success: true,
  message: 'Migration completed',
  // Include operation-specific stats
  processed: 500,
  updated: 480,
  skipped: 20,
  timestamp: new Date().toISOString()
});
```

### Webhook Responses (minimal)
```javascript
// Success — 200 with operation details
res.json({ message: 'Visit processed', visitId: '...' });

// Error — 400/500
res.status(400).json({
  error: 'INVALID_TYPE',
  message: 'Missing or invalid webhook type'
});
```

## Pagination

### Standard Pattern
```javascript
// Parse with defaults and caps
const limit = Math.min(parseInt(req.query.limit) || 20, 500);
const offset = parseInt(req.query.offset) || 0;

const [results, total] = await Promise.all([
  Model.find(filter).skip(offset).limit(limit),
  Model.countDocuments(filter)
]);

res.json({ success: true, data: results, total, limit, offset });
```

### Rules
- Default limit: 20–50 (choose based on payload size)
- Max limit: 500 (enforce with `Math.min()`)
- Always return `total`, `limit`, `offset` in response
- Use `offset` (not page numbers) for consistency

## Rate Limiting Tiers

Apply the correct limiter from `src/routes/apiRoutes.js`:

| Tier | Limit | Use For |
|------|-------|---------|
| `webhookRateLimiter` | 100/min | Webhook ingestion (`POST /api/webhook`) |
| `readRateLimiter` | 60/min | Query, search, export, health, changes |
| `adminRateLimiter` | 10/min | Admin, migration, rebuild endpoints |

```javascript
// Apply in route definition
router.get('/api/query/people', readRateLimiter, queryPeopleHandler);
router.post('/api/admin/rebuild', adminRateLimiter, webhookAuth, rebuildHandler);
```

## Parameter Validation

### Do / Don't Rules

```javascript
// ✅ DO: Validate and sanitize early
const limit = Math.min(parseInt(req.query.limit) || 20, 500);
const sortOrder = ['asc', 'desc'].includes(req.query.sortOrder) ? req.query.sortOrder : 'desc';

if (req.query.search && req.query.search.length < 2) {
  throw new AppError('VALIDATION_ERROR', 'Search query must be at least 2 characters');
}

// ✅ DO: Use RegExp for text search (case-insensitive)
const filter = {};
if (req.query.company) {
  filter['currentCompany'] = new RegExp(req.query.company, 'i');
}

// ❌ DON'T: Pass raw query params to MongoDB
const results = await Person.find(req.query); // Injection risk
```

### Numeric Parameters
```javascript
// Always parseInt with fallback and bounds
const minRank = Math.max(parseInt(req.query.minRank) || 1, 1);
const maxRank = Math.min(parseInt(req.query.maxRank) || 8, 8);
```

## Error Handling

### Controller Pattern
```javascript
async function myHandler(req, res) {
  try {
    // Validate
    if (!req.params.id) {
      throw new AppError('VALIDATION_ERROR', 'ID is required');
    }

    // Process
    const result = await doWork(req.params.id);

    if (!result) {
      throw new AppError('NOT_FOUND', `Resource ${req.params.id} not found`);
    }

    // Respond
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode || 400).json({
        success: false,
        error: error.code,
        message: error.message
      });
    }

    logger.error('Unexpected error in myHandler', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred'
    });
  }
}
```

### Standard Error Codes
| Code | Status | When |
|------|--------|------|
| `VALIDATION_ERROR` | 400 | Invalid input, missing required fields |
| `INVALID_TYPE` | 400 | Unknown webhook type |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `DUPLICATE` | 409 | Idempotency key conflict |
| `INTERNAL_ERROR` | 500 | Unexpected failures |

## Mutation Safety

### Dry-Run Pattern (admin/migration endpoints)
```javascript
// Default to dry-run for safety
const dryRun = req.body.dryRun !== false;

if (dryRun) {
  return res.json({
    success: true,
    message: 'Dry run complete — no changes made',
    wouldProcess: count,
    timestamp: new Date().toISOString()
  });
}

// Execute the mutation
```

### Rules
- All admin mutation endpoints default to `dryRun: true`
- Apply `webhookAuth` middleware to all mutation endpoints
- Apply `adminRateLimiter` to admin endpoints
- Log all mutations with Winston

## Authentication

### webhookAuth Middleware
```javascript
// Apply to sensitive endpoints
router.post('/api/webhook', webhookAuth, webhookRateLimiter, webhookHandler);
router.post('/api/admin/rebuild', webhookAuth, adminRateLimiter, rebuildHandler);
```

### Rules
- All `POST`/`PUT`/`DELETE` endpoints require `webhookAuth`
- Read endpoints (`GET`) do not require auth (rate-limited instead)
- Admin endpoints require both `webhookAuth` and `adminRateLimiter`

## Field Selection

### Performance Pattern
```javascript
// ✅ DO: Select only needed fields for list endpoints
const people = await Person.find(filter)
  .select('firstName lastName currentTitle currentCompany lastObservedAt')
  .skip(offset)
  .limit(limit)
  .lean();

// ❌ DON'T: Return full documents for list/search endpoints
const people = await Person.find(filter); // Returns _meta, observations, etc.
```

## Adding a New Route

Checklist:
- [ ] Route defined in appropriate file (`apiRoutes.js`, `queryRoutes.js`, etc.)
- [ ] Correct rate limiter applied
- [ ] Auth middleware applied (if mutation)
- [ ] Parameters validated with bounds
- [ ] Response matches envelope format for endpoint type
- [ ] Errors use `AppError` with standard codes
- [ ] Handler has try/catch with `logger.error()` for unexpected errors
- [ ] Pagination uses `limit`/`offset` with `Math.min()` cap
- [ ] Added to CLAUDE.md API Endpoints section
