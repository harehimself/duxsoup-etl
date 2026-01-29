# DuxSoup ETL & LinkedIn Intelligence

> ETL system for processing DuxSoup LinkedIn webhook data into canonical people, company, and location snapshots.

## Quick Reference

| Task | Command |
|------|---------|
| Start dev server | `npm run dev` |
| Run unit tests | `npm test` |
| Run integration tests | `npm run test:integration` |
| Run all tests | `npm run test:all` |
| Single test file | `npm test -- <path>` |
| Coverage report | `npm run test:coverage` |

## Tech Stack

- **Runtime:** Node.js 20+
- **Framework:** Express 5.2.1
- **Database:** MongoDB (Mongoose 9.1.5)
- **Testing:** Jest 30.2.0 + Supertest
- **Logging:** Winston
- **Scheduling:** node-cron

## Project Structure

```
duxsoup-etl/
├── src/
│   ├── index.js              # Entry point - Express server setup
│   ├── controllers/          # Business logic handlers
│   │   ├── observationHandler.js   # Generic webhook processor
│   │   ├── visitController.js      # Visit webhook handler
│   │   ├── scanController.js       # Scan webhook handler
│   │   ├── personController.js     # Person snapshot logic (716 lines, core)
│   │   ├── companyController.js    # Company snapshot logic
│   │   ├── locationController.js   # Location snapshot logic
│   │   ├── healthController.js     # Health/metrics endpoints
│   │   └── *ReadController.js      # Read path controllers
│   ├── models/               # Mongoose schemas
│   │   ├── person.js         # Canonical person snapshots
│   │   ├── visit.js          # Immutable visit observations
│   │   ├── scan.js           # Immutable scan observations
│   │   ├── company.js        # Canonical company snapshots
│   │   ├── location.js       # Canonical location snapshots
│   │   ├── deadLetter.js     # Failed upserts for replay
│   │   └── change.js         # Job changes/promotions tracking
│   ├── routes/               # API route definitions
│   │   ├── apiRoutes.js      # Main routes (webhook, health, CRUD)
│   │   ├── queryRoutes.js    # Search/filter endpoints
│   │   ├── searchRoutes.js   # Full-text search
│   │   ├── exportRoutes.js   # CSV/JSON export
│   │   └── changeRoutes.js   # Job changes queries
│   ├── services/             # Business logic services
│   │   ├── identityResolverService.js  # Identity matching
│   │   ├── changeDetectionService.js   # Detect job changes
│   │   └── *Service.js       # Query, search, export, etc.
│   ├── utils/                # Helpers
│   │   ├── errors.js         # AppError classes
│   │   ├── validation.js     # Webhook validation
│   │   ├── identityResolver.js       # Extract stable IDs
│   │   ├── salesNavIdExtractor.js    # Sales Nav ID regex
│   │   ├── eventKey.js       # Idempotency key generation
│   │   ├── location-parser.js        # Parse location strings
│   │   ├── database.js       # MongoDB connection singleton
│   │   └── logger.js         # Winston logger
│   ├── workers/              # Background job scheduler
│   └── __tests__/            # Integration tests
├── __tests__/                # Unit tests
├── scripts/                  # Migration/maintenance scripts
├── docs/                     # Documentation
└── .claude/                  # Claude AI instructions
    └── rules/                # Code standards
```

## Architecture: Observation-Snapshot Pattern

**This is the core pattern. Understand it before making changes.**

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   DuxSoup       │     │   Observations  │     │    Snapshots    │
│   Webhook       │────▶│ (Visit / Scan)  │────▶│ (Person/Company)│
│                 │     │   Immutable     │     │    Mutable      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Key Concepts

1. **Observations (Visit/Scan):** Append-only event logs. Never modified. Source of truth for "what we saw."

2. **Snapshots (Person/Company/Location):** Canonical state. Updated from observations with precedence rules:
   - Never overwrite with empty/blank values
   - Visit beats Scan (same person, different sources)
   - Newer beats older (same source type)

3. **Identity Resolution:** Use stable identifiers. Priority order:
   - **Sales Navigator ID** (format: `ACwAA...`, most stable)
   - **Numeric ID** (8+ digits)
   - **Profile URL** (fallback only)
   - **Never** rely on Profile URLs for primary identity

4. **Aliases:** Each person/company has an aliases array for deduplication. Query by any alias.

5. **Provenance Tracking:** Each snapshot field tracks: `{ value, observedAt, source, observationId }`

### Dual-Write System

```
Webhook → Phase 1: Visit/Scan (must succeed) → Phase 2: Person/Company (best-effort)
                        │                              │
                        ▼                              ▼
              Return 200 on success          DeadLetter on failure
```

- **Phase 1:** Legacy collections (Visit/Scan). System of record. Must succeed for 200 response.
- **Phase 2:** New collections (Person/Company/Location). Non-blocking. Failures captured in DeadLetter.

## Data Models

### Person (`src/models/person.js`)
```javascript
{
  _id: "sales-nav-id-or-numeric-id",
  canonical_id: "uuid-v5-deterministic",
  aliases: [{ type: "salesNavId|numericId|profileUrl", value: "..." }],
  // Snapshot fields
  firstName, lastName, fullName,
  currentTitle, currentCompany, currentCompanyId,
  location: { city, state, country, ... },
  email, phone, profilePicture,
  roles: [{ title, companyName, companyId, startDate, endDate, isCurrent }],
  education: [...],
  skills: [...],
  // Metadata
  _meta: { fieldName: { value, observedAt, source, observationId } },
  observations: { visits: [ObjectId], scans: [ObjectId] },
  lastObservedAt, observationsCount
}
```

### Visit (`src/models/visit.js`)
```javascript
{
  id: "duxsoup-profile-id",
  userid: "duxsoup-user",
  VisitTime: Date,
  Profile, SalesProfile, RecruiterProfile,  // URLs (unstable)
  "First Name", "Last Name", Title, Company, Location,
  extended: { positions, skills, schools },
  rawData: { /* original webhook */ },
  event_key: "sha1-hash"  // Idempotency
}
```

### Scan, Company, Location, DeadLetter, Change
See `src/models/` for full schemas.

## API Endpoints

### Webhook Ingestion
- `POST /api/webhook` - Main entry point (routes to visit/scan handler)

### Health & Metrics
- `GET /health` - Basic health check (always 200)
- `GET /api/health/ingestion` - Ingestion statistics
- `GET /api/health/parity` - Visit/Scan parity check
- `GET /api/health/metrics` - Overall system metrics

### Read APIs
- `GET /api/people/:id` - Get person by ID
- `GET /api/people/by-alias/:value` - Get person by any alias
- `GET /api/companies/:id` - Get company by ID
- `GET /api/locations/:id` - Get location by ID

### Query/Search
- `GET /api/query/people` - Filter people
- `GET /api/search/people` - Full-text search
- `GET /api/export/people` - CSV/JSON export

## Code Style & Patterns

### Async/Await
```javascript
// DO: Always use async/await
async function processWebhook(data) {
  const result = await Visit.create(data);
  return result;
}

// DON'T: No raw .then() blocks
function processWebhook(data) {
  return Visit.create(data).then(result => result);  // ❌
}
```

### Error Handling
```javascript
const { AppError, ValidationError, NotFoundError } = require('../utils/errors');

// Throw specific errors
if (!data.id) {
  throw new ValidationError('MISSING_ID', 'Webhook missing required ID field');
}

// Response format: { success: false, error: "CODE", message: "..." }
```

### Models
```javascript
// Export with PascalCase
const Visit = mongoose.model('Visit', visitSchema);
module.exports = Visit;
```

### Identity Check
```javascript
// If no stable ID, log warning and skip person upsert
if (!salesNavId && !numericId) {
  logger.warn('Webhook missing stable identity', { profileUrl });
  // Continue with observation write, skip person upsert
}
```

## Testing Requirements

**New features MUST include tests.** See `.claude/rules/testing.md` for full details.

### Test Commands
```bash
npm test                          # Unit tests
npm test -- path/to/file.test.js  # Single file
npm run test:integration          # Integration tests
npm run test:all                  # Both
npm run test:coverage             # Coverage report
```

### Test Structure
```javascript
describe('PersonController', () => {
  describe('upsertFromObservation()', () => {
    it('should update snapshot when observation has new role', async () => {
      // Arrange
      const observation = { salesNavId: 'ACwAAABCDEF', ... };

      // Act
      const person = await upsertFromObservation(observation, 'visit');

      // Assert
      expect(person.roles).toContainEqual(expect.objectContaining({ ... }));
    });
  });
});
```

### Critical Test Scenarios
1. **Identity resolution:** Sales Nav ID vs numeric ID vs missing
2. **Observation-Snapshot:** Appending observations, updating snapshots
3. **Precedence rules:** Visit beats Scan, newer beats older
4. **Idempotency:** Duplicate event_key handling
5. **Error handling:** AppError with correct codes

## Agent Guidelines

### Always Do
1. **Run tests** after modifying logic: `npm test -- <path>`
2. **Read before modifying:** Use Read tool before editing any file
3. **Update docs** if changing data schema (see `docs/`)
4. **Use environment variables:** Never commit secrets

### Never Do
1. **Skip tests** for "small changes"
2. **Rely on Profile URLs** for identity (use Sales Nav ID or Numeric ID)
3. **Overwrite with empty values** in snapshot updates
4. **Commit secrets** or hardcoded credentials

### Idempotency Pattern
```javascript
// event_key = SHA1(userid + type + time + id)
// Used with upsert to prevent duplicate processing
const result = await Visit.findOneAndUpdate(
  { event_key },
  { $setOnInsert: documentData },
  { upsert: true, new: true }
);
```

## Key Files Reference

| Purpose | File |
|---------|------|
| Entry point | `src/index.js` |
| Webhook processing | `src/controllers/observationHandler.js` |
| Person snapshot logic | `src/controllers/personController.js` |
| Identity resolution | `src/services/identityResolverService.js` |
| Error classes | `src/utils/errors.js` |
| Webhook validation | `src/utils/validation.js` |
| Sales Nav ID extraction | `src/utils/salesNavIdExtractor.js` |
| Database connection | `src/utils/database.js` |
| Testing rules | `.claude/rules/testing.md` |

## Environment Variables

### Required
```bash
MONGODB_URI=mongodb+srv://...      # MongoDB connection string
```

### Optional
```bash
NODE_ENV=development               # development | production
PORT=3000                          # Server port
ALLOWED_ORIGINS=http://localhost   # CORS origins (comma-separated)
READ_SOURCE=hybrid                 # hybrid | people | legacy
ENABLE_SCHEDULER=true              # Enable background jobs
CANONICAL_ID_NAMESPACE=...         # UUID namespace for canonical IDs
```

## Common Workflows

### Adding a New Webhook Field
1. Add field to model schema (`src/models/visit.js` or `scan.js`)
2. Update mapping in controller (`visitController.js` or `scanController.js`)
3. If needed for Person snapshot, update `personController.js`
4. Add tests for the new field
5. Run `npm test` to verify

### Debugging Identity Issues
1. Check `aliases` array in Person document
2. Verify Sales Nav ID extraction: `src/utils/salesNavIdExtractor.js`
3. Check `identityResolverService.js` for matching logic
4. Review DeadLetter collection for failed upserts

### Running Migrations
```bash
# All migrations default to dry-run
npm run backfill:canonical-id     # Add canonical IDs
npm run rebuild:companies         # Rebuild company snapshots
npm run dedupe:aliases            # Deduplicate alias arrays

# Remove --dry-run in scripts/ to execute
```

## Maintenance Scripts

Located in `scripts/`:
- `backfillCanonicalId.js` - Add missing canonical IDs
- `backfillCompanyCanonicalId.js` - Company canonical IDs
- `rebuildCompanies.js` - Rebuild company collection from observations
- `rebuildLocations.js` - Rebuild location collection
- `migrateLocationStructure.js` - Migrate location format
- `dedupeAliases.js` - Remove duplicate aliases

## Background Jobs

Scheduler runs if `ENABLE_SCHEDULER !== 'false'`:
- **Dead letter replay:** Hourly - retries failed person upserts
- **Health check:** Every 6 hours - system health monitoring
