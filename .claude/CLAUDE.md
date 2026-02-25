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
src/
├── controllers/    # Webhook handlers, snapshot upsert logic
├── models/         # Mongoose schemas (person, visit, scan, company, location, etc.)
├── routes/         # API route definitions
├── services/       # Identity resolution, change detection, search
├── utils/          # Error classes, validation, ID extraction, logging
├── workers/        # Background job scheduler
└── __tests__/      # Integration tests
__tests__/          # Unit tests
scripts/            # Operational CLI and maintenance scripts
docs/               # Runbook, field reference, webhook payloads
.claude/            # Claude AI instructions and rules
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
  aliases: [{ type: "salesNavId|numericId|duxsoupId|linkedInUsername|vanityName|publicUrl|salesUrl|recruiterUrl", value: "..." }],

  // Snapshot: canonical state (all profile fields nested here)
  snapshot: {
    firstName, middleName, lastName, fullName,
    birthday, birthdayRaw,
    currentTitle, currentCompany, currentCompanyId,
    currentCompanyUrl, currentCompanyProfile,
    parsedSeniority, parsedDepartment,                  // auto-derived from currentTitle
    location,                                            // raw location string
    city, state, stateCode, country, countryCode,        // structured location fields
    province, region, locationType,
    usRegion, usSubregion, timezone, utcOffset,          // US region categorization
    industry, connections, summary,
    email, phone, twitter,
    profilePicture, thumbnail,
    roles: [{ title, companyName, companyId, location, description,
              startDate, endDate, isCurrent, seniority, seniorityRank }],
    education: [{ school, degree, field, startDate, endDate }],
    skills: [String],
    personalWebsite, companyWebsite,
    degree,                                              // connection degree (1st/2nd/3rd)
    _meta: { fieldName: { value, observedAt, source, observationId } },
  },

  observations: { visits: [ObjectId], scans: [ObjectId] },

  // Metadata
  meta: {
    lastObservedAt,
    lastObservation: { type, id, observedAt },
    observationsCount,
  },

  // Derived metrics (computed from roles)
  derived: {
    avgTenureMonths, yearsAtCurrentCompany,
    highestSeniority, highestSeniorityRank,
    highestSeniorityRoleTitle, highestSeniorityRoleCompany,
  },

  mergedInto, mergedAt,                                  // merge audit trail
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
- `POST /api/webhook/batch` - Batch processing (array of payloads, max 50)

### Health & Metrics
- `GET /health` - Basic health check (always 200)
- `GET /api/health/ingestion` - Ingestion statistics
- `GET /api/health/parity` - Visit/Scan parity check
- `GET /api/health/metrics` - Overall system metrics
- `GET /api/health/coverage-breakdown` - Coverage breakdown by identifier type
- `GET /api/health/canonical-coverage` - Canonical ID coverage stats
- `GET /api/health/company-coverage` - Company collection coverage
- `GET /api/health/location-coverage` - Location collection coverage
- `GET /api/health/data-quality` - Data quality metrics
- `GET /api/health/quality` - Structural data quality dashboard (identity, aliases, enrichment, freshness)
- `GET /api/health/dashboard` - Consolidated health dashboard
- `GET /api/health/throughput` - Real-time webhook throughput metrics (1m/5m/15m/1h windows)
- `GET /api/health/data-cleanliness` - Field-level data cleanliness metrics (whitespace, email, skills, education, missing fields)

### Read APIs
- `GET /api/people/:id` - Get person by ID
- `GET /api/people/:id/timeline` - Person activity timeline (visits, scans, changes) with pagination and date range filter
- `GET /api/people/by-alias/:value` - Get person by any alias
- `POST /api/people/by-aliases` - Bulk lookup people by alias values (body: `{ values: string[] }`)
- `GET /api/companies/:id` - Get company by ID
- `GET /api/companies/:id/intelligence` - Company intelligence rollup (headcount, seniority, hires, departures, tenure, velocity, geography)
- `GET /api/companies/by-alias/:value` - Get company by any alias
- `GET /api/locations/:id` - Get location by ID
- `GET /api/locations/by-alias/:value` - Get location by any alias

### Query/Search
- `POST /api/query/people` - Filter people (body: filter criteria)
- `POST /api/query/companies` - Filter companies (body: filter criteria)
- `GET /api/query/help` - Query API documentation
- `GET /api/search/` - Full-text people search (query param: `q`)

### Export
- `POST /api/export/people/csv` - Create CSV export job
- `POST /api/export/people/json` - Create JSON export job
- `POST /api/export/companies/csv` - Create company CSV export job
- `POST /api/export/companies/json` - Create company JSON export job
- `POST /api/export/locations/csv` - Create location CSV export job
- `POST /api/export/locations/json` - Create location JSON export job
- `GET /api/export/status/:jobId` - Check export job status
- `GET /api/export/download/:jobId` - Download completed export

### Changes
- `GET /api/changes/` - Recent job changes, promotions, title changes
- `GET /api/changes/person/:id` - Changes for a specific person

### Seniority
- `GET /api/seniority/tiers` - List available seniority tiers
- `GET /api/seniority/distribution` - Distribution by seniority tier
- `GET /api/seniority/filter` - Filter people by seniority criteria
- `GET /api/seniority/search` - Search people with seniority filtering
- `GET /api/seniority/stats` - Comprehensive seniority statistics

### Signals
- `GET /api/signals/` - Engagement trigger feed (new roles, promotions, lateral moves, new decision-makers) with ranking, dedup, and action context

### Insights
- `GET /api/insights/enrichment-gaps` - Enrichment gap analysis dashboard (per-field missing counts/percentages, seniority breakdown, cached 10 min)
- `GET /api/insights/enrichment-gaps/revisit-list` - Prioritized revisit list scored by contact value + gap severity (CSV default, JSON optional)
- `GET /api/insights/network-profile` - Network composition analytics (company, seniority, title, industry, geography, department, tenure distributions for 1st-degree connections)
- `GET /api/insights/network-profile/trends` - Network composition trends comparing current state against 30/60/90-day windows (growth rates, insights)

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
5. **Check the backlog** before starting work: `.claude/BACKLOG.md`

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
| API route conventions | `.claude/rules/api.md` |
| JavaScript standards | `.claude/rules/javascript.md` |
| Backlog management | `.claude/rules/backlog.md` |
| Project backlog | `.claude/BACKLOG.md` |

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
ENABLE_SCHEDULER=true              # Enable background jobs
CANONICAL_ID_NAMESPACE=...         # UUID namespace for canonical IDs
LOG_LEVEL=info                     # Winston log level (error/warn/info/debug)
DATA_FRESHNESS_THRESHOLD_HOURS=6   # Hours before stale data warning fires
```

## Webhook Security

The `POST /api/webhook` endpoint is publicly accessible. Protect it:

- **Rate limiting:** `express-rate-limit` is configured — verify limits are appropriate for expected DuxSoup volume
- **Input validation:** `src/utils/validation.js` validates incoming payloads before processing
- **IP allowlisting:** Consider restricting to DuxSoup's outbound IP ranges if available
- **No signature verification:** DuxSoup webhooks are not signed — rely on rate limiting + validation + idempotency as defense-in-depth
- **Idempotency:** Duplicate payloads are safely handled via `event_key` (SHA1 hash)

## Deployment Considerations

- **Scheduler:** If `ENABLE_SCHEDULER=true` and running multiple instances, dead-letter replay and health checks will run on every instance — use a leader-election pattern or disable scheduler on all but one instance
- **MongoDB:** Connection string via `MONGODB_URI` env var — ensure connection pooling is appropriate for instance count
- **CORS:** `ALLOWED_ORIGINS` controls which origins can hit read APIs — set appropriately for production
- **Graceful shutdown:** Ensure the process handles SIGTERM to complete in-flight webhook processing

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
