# Development To-Do List

Actionable tasks derived from the security, reliability, and operational improvement backlog. Items are ordered by risk (security first, then reliability, then operational improvements).

---

## 1. Fail-Closed Webhook Auth in Production

**File:** `src/middleware/webhookAuth.js:18-23`
**Risk:** High — unauthenticated webhook ingestion in production if `WEBHOOK_SECRET` is unset.

- [ ] Add `NODE_ENV` check at the top of the early-return block (lines 18-23)
- [ ] When `NODE_ENV === 'production'` and `WEBHOOK_SECRET` is unset, return `403` instead of calling `next()`
- [ ] Log an error-level message (not just a warning) when rejecting in production
- [ ] Keep the existing pass-through behavior for `development`/`test` environments
- [ ] Add unit tests covering:
  - Production + no secret → 403
  - Development + no secret → pass-through
  - Any env + valid secret → pass-through
  - Any env + invalid secret → 401

---

## 2. Add Auth to Admin Routes

**File:** `src/routes/apiRoutes.js:168`
**Risk:** High — admin routes (merge, rebuild, bulk operations) protected only by rate limiting.

- [ ] Import `webhookAuth` middleware in `apiRoutes.js` (already imported at line 5 for the replay endpoint)
- [ ] Add `webhookAuth` to the admin route mount: `router.use("/admin", webhookAuth, adminRateLimiter, adminRoutes)`
- [ ] Verify the replay endpoint at line 171 doesn't double-apply auth (it already has `webhookAuth` inline)
- [ ] Add integration test confirming admin routes reject requests without valid auth header

---

## 3. Sanitize RegExp Inputs in Seniority Routes

**File:** `src/routes/seniorityRoutes.js:174, 178, 256`
**Risk:** High — regex injection via `department`, `company`, and `q` query parameters.

- [ ] Create or import an `escapeRegex` helper (same pattern as `searchService.js:117-120`):
  ```js
  const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  ```
- [ ] Apply `escapeRegex()` before `new RegExp()` at:
  - Line 174: `new RegExp(escapeRegex(department), 'i')`
  - Line 178: `new RegExp(escapeRegex(company), 'i')`
  - Line 256: `new RegExp(escapeRegex(q), 'i')`
- [ ] Audit the rest of `seniorityRoutes.js` for any other raw `RegExp()` from user input
- [ ] Add unit tests for special-character inputs (`.*+?^${}()|[]\`) confirming they are treated as literals

---

## 4. Add express-mongo-sanitize

**Risk:** Medium — NoSQL injection guard for endpoints not covered by `queryValidation.js`.

- [ ] Install: `npm install express-mongo-sanitize`
- [ ] Add `mongoSanitize()` middleware in `src/index.js` after `express.json()` and before route mounting
- [ ] Verify existing query validation in `queryValidation.js` still functions (no conflicts)
- [ ] Add a smoke test confirming `$gt`/`$where` payloads are stripped from request body and query params

---

## 5. Add Compression Middleware

**Risk:** Low — performance improvement, no security impact.

- [ ] Install: `npm install compression`
- [ ] Add `app.use(compression())` in `src/index.js` before route handlers (after `helmet()`, before `cors()`)
- [ ] Verify health endpoints and webhook ingestion still function with compressed responses
- [ ] Optional: configure threshold (default 1kb is reasonable)

---

## 6. Request Correlation IDs

**Risk:** Low — observability improvement for production tracing.

- [ ] Create `src/middleware/correlationId.js`:
  - Generate UUID v4 per request (or use incoming `X-Request-ID` header if present)
  - Attach to `req.correlationId`
  - Set `X-Request-ID` response header
- [ ] Integrate with Winston logger context:
  - Update the request logging middleware in `src/index.js:52-58` to include `correlationId`
  - Use Winston child logger or `defaultMeta` override per request
- [ ] Pass `correlationId` into controller/service layers (attach to `req` object, read downstream)
- [ ] Add `correlationId` to error responses (alongside existing `error` and `message` fields)
- [ ] Add unit test confirming:
  - Response includes `X-Request-ID` header
  - Incoming `X-Request-ID` is respected
  - Logs contain the correlation ID

---

## 7. Coverage Thresholds in CI

**Risk:** Low — prevents test coverage regression.

- [ ] Add `coverageThreshold` to `jest.config.unit.js`:
  ```js
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80
    }
  }
  ```
- [ ] Run `npm run test:coverage` to confirm current coverage meets or exceeds thresholds
- [ ] Adjust thresholds to match current baseline (round down to nearest 5%)
- [ ] Ensure CI pipeline runs coverage and fails on threshold violations

---

## 8. Data Quality Dashboard + Alerting Thresholds

**Context:** Health endpoints exist (`/api/health/ingestion`, `/api/health/parity`, `/api/health/metrics`) but no automated alerting. Scheduler and notification service are already in place.

### 8a. Define threshold configuration
- [ ] Create `src/config/alertThresholds.js` with configurable thresholds:
  - Duplicate rate (% of webhook events hitting existing `event_key`)
  - Orphaned observations (visits/scans without corresponding person snapshot)
  - Missing canonical IDs (persons without `canonical_id`)
  - Phase 2 failure rate (dead letter entries / total webhooks over rolling window)
- [ ] Source threshold values from environment variables with sensible defaults

### 8b. Implement threshold checks
- [ ] Create `src/services/dataQualityService.js`:
  - Query existing health endpoints / collections for current metrics
  - Compare against thresholds
  - Return array of violations with severity (warning/critical)
- [ ] Add unit tests for threshold comparison logic (mock DB queries)

### 8c. Wire into scheduler
- [ ] Add a new scheduled job in `src/workers/scheduler.js` (e.g., every 2 hours)
- [ ] On threshold violation, use existing notification service to send alerts
- [ ] Implement alert deduplication (don't re-alert on same violation within cooldown period)

### 8d. Dashboard endpoint
- [ ] Add `GET /api/health/quality` endpoint returning current metrics + threshold status
- [ ] Include trend data (last 24h, 7d) if feasible

---

## 9. Export Job TTL Cleanup

**Context:** `ExportJob` model already has a TTL index on `expiresAt` (line 77). MongoDB handles document expiry. However, exported **files on disk** are not cleaned up.

- [ ] Verify the TTL index is active and functioning (check MongoDB index list)
- [ ] Identify where export files are written to disk (check `exportService.js` or `exportRoutes.js`)
- [ ] Add a scheduled cleanup job in `src/workers/scheduler.js`:
  - Run daily
  - Query for export files older than retention period
  - Delete files from disk
  - Log cleanup summary (files deleted, space reclaimed)
- [ ] Add `EXPORT_FILE_TTL_DAYS` env var (default: 7)
- [ ] Add unit test for cleanup logic (mock filesystem)

---

## 10. Winston JSON Format + Log Sampling

### 10a. JSON format for production
- [ ] Update `src/utils/logger.js` production transport to use `winston.format.json()` (remove `colorize` and `simple` for production)
- [ ] Ensure all log entries include: `timestamp`, `level`, `message`, `service`, `correlationId` (after item 6)
- [ ] Test log output is valid JSON (parse a sample line)

### 10b. Log sampling for high-volume endpoints
- [ ] Create sampling middleware or logger wrapper:
  - Sample rate configurable per route (e.g., `/api/webhook` logs 1-in-10 success responses)
  - Always log errors and warnings at full rate
  - Always log slow requests (>1s) at full rate
- [ ] Add `LOG_SAMPLE_RATE` env var (default: 1.0 = log everything)
- [ ] Apply to webhook and health check endpoints

---

## 11. Progress Indicators + Resumability for Long-Running Scripts

**Context:** 88 scripts in `scripts/` — backfill, migration, rebuild scripts process entire collections.

### 11a. Shared progress utility
- [ ] Create `scripts/lib/progress.js`:
  - Accept total count, emit progress every N% or N seconds
  - Log: `[42% | 4200/10000 | 12.3/sec | ETA 8m]`
  - Flush final summary on completion

### 11b. Checkpoint/resume support
- [ ] Create `scripts/lib/checkpoint.js`:
  - Save last-processed `_id` to a checkpoint file (e.g., `.checkpoints/<script-name>.json`)
  - On restart, read checkpoint and resume with `{ _id: { $gt: lastId } }`
  - Accept `--fresh` flag to ignore checkpoint and start over
- [ ] Store checkpoint metadata: script name, started at, last ID, count processed

### 11c. Retrofit high-value scripts
- [ ] Integrate progress + checkpoint into:
  - `backfillCanonicalId.js`
  - `rebuildCompanies.js`
  - `rebuildLocations.js`
  - `migrateLocationStructure.js`
  - `dedupeAliases.js`
- [ ] Test resume behavior (interrupt mid-run, restart, confirm no duplicates)

---

## 12. Consolidate Operational Scripts into a CLI

**Context:** 88 scripts with overlapping DB connection logic, argument parsing, and dry-run patterns.

### 12a. CLI framework setup
- [ ] Install a CLI framework (e.g., `commander` or `yargs`)
- [ ] Create `src/cli.js` (or `bin/ops.js`) as the entry point
- [ ] Add `bin` field to `package.json`: `"ops": "./bin/ops.js"`
- [ ] Implement shared infrastructure:
  - MongoDB connection (connect once, share across commands)
  - `--dry-run` flag (global, default: true)
  - `--verbose` flag for debug logging
  - Summary output (records processed, errors, duration)

### 12b. Define command groups
- [ ] `ops backfill <target>` — canonical IDs, seniority, aliases, etc.
- [ ] `ops rebuild <collection>` — companies, locations, people
- [ ] `ops migrate <migration>` — location structure, URL-to-stable-ids, etc.
- [ ] `ops dedupe <target>` — aliases, people, companies
- [ ] `ops analyze <report>` — duplicates, orphans, health checks
- [ ] `ops export <format>` — CSV/JSON exports

### 12c. Migrate scripts incrementally
- [ ] Start with the 5-6 most-used scripts (backfill, rebuild, dedupe)
- [ ] Wrap existing script logic as command handlers (don't rewrite internals)
- [ ] Keep original scripts working during transition (deprecation notice on run)
- [ ] Add `--help` for each command with description and examples

### 12d. Documentation
- [ ] Add `ops --help` global help listing all commands
- [ ] Update `docs/` and `CLAUDE.md` with new CLI usage
- [ ] Add examples to operational runbook

---

## 13. Merge Audit Trail + Rollback Mechanism

**Context:** `Merge` model exists (`src/models/merge.js`) tracking winner/loser IDs and reason. No versioned snapshots or rollback capability.

### 13a. Pre-merge snapshot capture
- [ ] Before executing a merge, serialize the full state of both winner and loser person documents
- [ ] Store in the `Merge` record as `preState: { winner: {...}, loser: {...} }`
- [ ] Include all fields: aliases, roles, observations, `_meta` provenance

### 13b. Post-merge snapshot
- [ ] After merge completes, capture the resulting winner document
- [ ] Store as `postState: { winner: {...} }`
- [ ] Record which fields were modified (diff between pre and post)

### 13c. Rollback mechanism
- [ ] Create `src/services/mergeRollbackService.js`:
  - Accept a merge ID
  - Restore loser document from `preState.loser`
  - Restore winner document from `preState.winner`
  - Remove the loser's aliases from winner's alias array
  - Update observation references back to their original person
- [ ] Add `POST /api/admin/merges/:id/rollback` endpoint
- [ ] Mark the merge record as `status: 'rolled_back'` with timestamp

### 13d. Audit query endpoints
- [ ] Add `GET /api/admin/merges` — list merges with pagination, date filters
- [ ] Add `GET /api/admin/merges/:id` — full merge detail with pre/post state
- [ ] Add `GET /api/admin/people/:id/merge-history` — all merges involving a person (as winner or loser)

### 13e. Testing
- [ ] Integration test: merge two people → verify audit record → rollback → verify both restored
- [ ] Test rollback of a merge where the winner was subsequently merged again (should warn/block)
- [ ] Test concurrent merge + rollback safety

---

## Priority Order (Suggested)

| Priority | Item | Effort | Risk Mitigated |
|----------|------|--------|----------------|
| P0 | 1. Fail-closed webhook auth | ~30 min | Unauthenticated production ingestion |
| P0 | 2. Admin route auth | ~15 min | Unprotected admin operations |
| P0 | 3. Sanitize RegExp inputs | ~30 min | Regex injection |
| P0 | 4. express-mongo-sanitize | ~15 min | NoSQL injection |
| P1 | 5. Compression middleware | ~15 min | Response size / bandwidth |
| P1 | 6. Correlation IDs | ~1-2 hrs | Production debuggability |
| P1 | 7. Coverage thresholds | ~15 min | Test regression |
| P1 | 8. Data quality alerting | ~4-6 hrs | Silent data quality degradation |
| P1 | 9. Export file cleanup | ~1-2 hrs | Unbounded disk growth |
| P2 | 10. Winston JSON + sampling | ~2-3 hrs | Log aggregation / cost |
| P2 | 11. Script progress + resume | ~4-6 hrs | Long-running script reliability |
| P2 | 12. CLI consolidation | ~2-3 days | Operational complexity |
| P2 | 13. Merge audit + rollback | ~1-2 days | Merge safety / reversibility |
