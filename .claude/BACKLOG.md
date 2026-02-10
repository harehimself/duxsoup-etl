# Project Backlog

> Canonical list of planned work for the DuxSoup ETL system.
>
> **Agents:** Read this file at session start for project context. Check items off as
> you complete them, then move them to the Completed section with a date and commit/PR ref.
> If new work is discovered during a session, add it to the appropriate priority tier.

---

## Active Sprint

### High Priority

- [x] **Fix ajv version mismatch and 8 failing tests** — `package.json` declares `ajv@^8.17.1` but lockfile has `6.12.6` installed. The ajv v6 error format differs from v8, causing all 8 tests in `webhookSchemaValidator.test.js` to fail (error messages show `"dataundefined"` instead of field paths like `"data/VisitTime"`). Run `npm install ajv@latest` to sync, then fix assertions.
  - Priority: `high`
  - Category: `bug`
  - Impact: 8 failing tests on master. Blocks CI trustworthiness.

- [x] **Fix VisitTime schema to accept number or string** — 100% of production webhooks trigger a schema validation warning because DuxSoup sends `VisitTime` as a Unix timestamp (number), but `webhookSchemas.js` expects a string. Update the schema to accept `oneOf: [string, number]` or auto-coerce numbers to ISO date strings. This is the single largest source of log noise in production.
  - Priority: `high`
  - Category: `bug`
  - Impact: Eliminates all current production schema warnings, restoring clean logs for real issue detection.

- [x] **Company/location controllers: eliminate find-modify-save race condition** — Both `companyController.js` and `locationController.js` use a pattern of `findOne() -> modify in JS -> save()`, with a separate `updateOne($addToSet)` in between. Under concurrent webhooks for the same entity, the second `save()` can overwrite changes from a parallel request. Refactor to use atomic `findOneAndUpdate` with `$set`/`$addToSet` in a single operation.
  - Priority: `high`
  - Category: `bug`
  - Impact: Prevents data loss from concurrent webhook processing of the same company/location.

- [x] **Remove `playground-1.mongodb.js` and `.history/` from repo** — Development artifacts committed to the repository. `playground-1.mongodb.js` is a MongoDB playground file and `.history/` contains VSCode local history. Add both to `.gitignore` and remove from tracking.
  - Priority: `high`
  - Category: `cleanup`
  - Impact: Cleaner repo, no development artifacts in production.

- [x] **Fix dead letter replay loop for education cast-to-string errors** — 44+ production errors from DuxSoup rich objects (`{text, textDirection, attributesV2}`) in education fields. The `coerceToString()` fix (commit `389d315`) handles new webhooks, but 11+ dead letter records created before the fix keep replaying and failing with the same validation error. Investigate whether `replayDeadLetters` re-fetches the original observation or uses cached payload. If re-fetch, the replay code path may not apply `coerceToString()`. These records will cycle through retries until `permanently_failed` at 10 attempts, wasting resources.
  - Priority: `high`
  - Category: `bug`
  - Impact: Eliminates 55+ recurring errors (44 upsert + 11 replay) and stops wasted retry cycles.
  - Discovered: 2026-02-10, Render log review.

- [x] **Fix identity resolution for international/locale-suffixed LinkedIn URLs** — 18 production errors from URLs like `linkedin.com/in/flávia-silva/en` being used as person `_id`. Despite the percent-encoding fix (commit `196`), decoded international characters in profiles with `/en` locale suffixes pass through as person IDs. Also seeing fragments `j` and `fl` leak through extraction, suggesting the URL-to-username parser truncates at certain characters. Review `salesNavIdExtractor.js` and `identityMatcher.js` for these edge cases.
  - Priority: `high`
  - Category: `bug`
  - Impact: Eliminates 18+ recurring identity resolution errors and prevents bad person records.
  - Discovered: 2026-02-10, Render log review.

- [x] **Purge permanently-stuck dead letters with validation errors** — 19 dead letter entries are cycling through retries for unfixable Mongoose validation failures (education cast errors, invalid `_id` format). Even after code fixes for new webhooks, these stale records will keep failing. Add a maintenance script or admin endpoint to mark dead letters as `permanently_failed` when the error type is a schema validation failure (not a transient DB/connection error).
  - Priority: `high`
  - Category: `reliability`
  - Impact: Stops wasted retry cycles and cleans up dead letter queue for accurate monitoring.
  - Discovered: 2026-02-10, Render log review.

### Medium Priority

- [x] **Add export job cleanup scheduler** — `EXPORT_TTL_HOURS` (default 24h) is defined in `exportService.js` but there is no background job to actually delete expired export files from `/tmp/duxsoup-exports`. Stale files accumulate on disk indefinitely. Add a scheduled job to the scheduler that prunes files older than `EXPORT_TTL_HOURS`.
  - Priority: `medium`
  - Category: `reliability`
  - Impact: Prevents disk space exhaustion from accumulated export files.

- [x] **Add company/location export endpoints** — Only people can be exported via `POST /api/export/people/csv` and `/json`. Companies and locations have read/query APIs but no export capability. Add `POST /api/export/companies/{csv,json}` and `POST /api/export/locations/{csv,json}` using the same streaming export infrastructure.
  - Priority: `medium`
  - Category: `feature`
  - Impact: Enables bulk data extraction for all entity types.

- [x] **Add webhook throughput metrics endpoint** — No endpoint exposes processing latency, throughput rate, or error rates over time. Add `GET /api/health/throughput` returning recent processing stats (webhooks/min, avg latency, debounce rate, Phase 2 success rate) using in-memory counters with rolling windows.
  - Priority: `medium`
  - Category: `observability`
  - Impact: Enables monitoring dashboards and alerting on processing degradation.

- [x] **Add data freshness alerting** — No alert fires when webhooks stop arriving. Add a scheduled job checking "time since last observation" and alerting (via existing notification service) when it exceeds a configurable threshold (default 6 hours). Would catch DuxSoup outages, webhook config drift, or Render ingress issues.
  - Priority: `medium`
  - Category: `reliability`
  - Impact: Detects silent data pipeline failures before they become stale-data problems.

- [x] **Bulk alias lookup endpoint** — `GET /api/people/by-alias/:value` handles one alias at a time. Add `POST /api/people/by-aliases` accepting an array of alias values and returning matched people in a single response. Reduces N+1 API calls for CRM sync use cases.
  - Priority: `medium`
  - Category: `feature`
  - Impact: Enables efficient batch lookups for integrations.

- [x] **Configurable Winston log level via env var** — No `LOG_LEVEL` environment variable exists. All log levels are emitted in production. Add `LOG_LEVEL` (default `info` in production, `debug` in development) to reduce noise without code changes. Particularly useful after fixing the VisitTime schema issue to verify logs are clean.
  - Priority: `medium`
  - Category: `observability`
  - Impact: Operational control over log verbosity without redeployment.

- [ ] **Set `ALLOWED_ORIGINS` environment variable on Render** — Fires a warning on every deploy/restart: "ALLOWED_ORIGINS not set - CORS will reject all cross-origin browser requests." While server-to-server webhooks are unaffected, any browser-based API consumers (Swagger UI at `/api/docs`, future dashboards) are blocked by CORS. Set to `https://duxsoup.onrender.com` at minimum.
  - Priority: `medium`
  - Category: `config`
  - Impact: Eliminates startup warning, enables browser-based API access to Swagger UI.
  - Discovered: 2026-02-10, Render log review.

- [x] **Add per-type webhook freshness monitoring (visit vs scan)** — Current data freshness alerting (backlog item) would check overall "time since last observation." Extend to monitor visit and scan types independently. Recent log windows show 100% visit traffic despite scans being active in the DB (42,926 scans). Per-type monitoring would detect if one pipeline silently stops while the other masks the gap.
  - Priority: `medium`
  - Category: `observability`
  - Impact: Detects single-pipeline failures that overall freshness monitoring would miss.
  - Discovered: 2026-02-10, Render log review.

### Low Priority / Tech Debt

- [ ] **Expand health endpoint test coverage** — Only `healthController.cache.test.js` and `healthController.dataQuality.test.js` exist. Missing tests for `/api/health/dashboard`, `/api/health/parity`, `/api/health/coverage-breakdown`, `/api/health/metrics`, and other health routes.
  - Priority: `low`
  - Category: `testing`
  - Impact: Catches regressions in health monitoring endpoints.

- [ ] **Add export stream integration tests** — Export service has unit tests but no integration tests verifying cursor -> transform -> file pipeline with real MongoDB data. Should test CSV/JSON generation end-to-end, row limits, empty results, and error handling during streaming.
  - Priority: `low`
  - Category: `testing`
  - Impact: Validates export pipeline with real database interactions.

- [ ] **Add query/search integration tests** — `queryBuilder.test.js` covers unit logic but complex MongoDB aggregations (text search with facets, seniority filtering, pagination) lack integration-level validation against a real database.
  - Priority: `low`
  - Category: `testing`
  - Impact: Catches aggregation pipeline regressions.

- [ ] **Update mongoose 9.1.6 -> 9.2.0** — Minor patch available. Run `npm update mongoose` and verify all tests pass.
  - Priority: `low`
  - Category: `deps`
  - Impact: Bug fixes, minor improvements.

- [ ] **Update nodemailer 8.0.0 -> 8.0.1** — Patch available (was previously bumped via Dependabot PR #80 but lockfile may have drifted).
  - Priority: `low`
  - Category: `deps`
  - Impact: Bug fixes.

- [ ] **Surface capacity-limit warnings to webhook response** — When `MAX_ROLES`/`MAX_EDUCATION`/`MAX_SKILLS` caps are hit, new entries are silently dropped with only a log warning. Consider adding a `warnings` array to the webhook response or recording in the dead letter queue so data loss is detectable by the caller or during monitoring.
  - Priority: `low`
  - Category: `reliability`
  - Impact: Makes data truncation visible rather than silent.

- [ ] **Add error classification to dead letter records** — Dead letters store the raw error message but don't categorize errors. Adding a `errorClass` field (`transient` vs `permanent`) would enable smarter replay (skip `ValidationError` patterns, only retry transient failures like timeouts/connection errors) and better monitoring of true failure rates vs known-bad data.
  - Priority: `low`
  - Category: `reliability`
  - Impact: Smarter dead letter replay, cleaner error metrics.
  - Discovered: 2026-02-10, Render log review.

- [ ] **Reduce rapid-fire deploy noise from auto-deploy** — When multiple PRs merge in rapid succession (e.g., 5 merges within 2 minutes on Feb 10), Render triggers 5 deploys, 4 of which are immediately canceled. Consider adding a deploy cooldown via Render blueprint settings, or batching PR merges to reduce wasted build minutes on the Starter plan.
  - Priority: `low`
  - Category: `ops`
  - Impact: Fewer wasted deploys, cleaner deploy history.
  - Discovered: 2026-02-10, Render deploy history review.

---

## Recommendations

> New items to consider. Move to Active Sprint when prioritized.

- [ ] **Snapshot versioning / change history** — Person and company snapshots are mutated in-place with no version history. There's no way to see what a person's profile looked like 30 days ago.
  - Priority: `backlog`
  - Category: `feature`
  - Impact: Enables temporal queries ("who changed jobs in Q1"), audit trails, and rollback of bad data. Could be implemented as a separate `PersonHistory` collection with snapshot-per-observation or periodic snapshots.

- [ ] **Structured log forwarding to external aggregation** — Logs are well-structured JSON but there's no external aggregation beyond Render's 30-day window. Consider forwarding to a log aggregation service (Datadog, Logtail, Betterstack) for alerts, dashboards, and historical analysis.
  - Priority: `backlog`
  - Category: `observability`
  - Impact: Persistent log history, real-time alerting on error spikes, operational dashboards beyond Render's built-in viewer.

- [ ] **Webhook replay from dead letters should also upsert company/location** — When `replayDeadLetters.js` replays a failed observation, it calls `upsertFromObservation()` for the person but does not replay `upsertCompanyFromObservation()` or `upsertLocationFromObservation()`. If the original Phase 2 company/location upsert also failed, replay won't recover those entities.
  - Priority: `backlog`
  - Category: `feature`
  - Impact: Complete recovery of all entity types during dead letter replay.

- [ ] **Webhook idempotency relies on SHA1 (event_key)** — `event_key` is computed with SHA1 (`src/utils/eventKey.js`), which is cryptographically weak. While this is used for idempotency (not security), consider migrating to SHA-256 for defense in depth against collision attacks on webhook deduplication.
  - Priority: `backlog`
  - Category: `security`
  - Impact: Stronger collision resistance for idempotency keys.

- [ ] **Add `PATCH /api/people/:id` for manual corrections** — Currently there's no way to manually correct a person's snapshot data through the API. Admin corrections require direct MongoDB access. A PATCH endpoint with webhookAuth protection would enable operational corrections without database access.
  - Priority: `backlog`
  - Category: `feature`
  - Impact: Enables ops team to fix data quality issues without SSH/database access.

- [ ] **Add webhook delivery acknowledgment/retry protocol** — DuxSoup fires webhooks without delivery guarantees. If the server returns 5xx or times out, DuxSoup may not retry. Consider adding a webhook receipt log and a reconciliation job that compares DuxSoup's expected delivery count against received webhooks.
  - Priority: `backlog`
  - Category: `reliability`
  - Impact: Detects silent webhook data loss.

- [ ] **OpenAPI spec drift detection** — The OpenAPI spec in `src/openapi.js` is manually maintained. It can drift from the actual routes. Consider generating the spec from route definitions or adding a test that validates the spec against registered Express routes.
  - Priority: `backlog`
  - Category: `testing`
  - Impact: Ensures API documentation stays accurate.

- [ ] **Person merge REST endpoint** — Merging people currently requires admin scripts or direct DB access. A `POST /api/admin/merge` endpoint would enable ops workflows without SSH. Should support dry-run mode and safety validation.
  - Priority: `backlog`
  - Category: `feature`
  - Impact: Enables merge operations through the API.

- [ ] **GraphQL API layer** — As the read API surface grows (people, companies, locations, changes, seniority), a GraphQL layer could reduce over-fetching and simplify client integrations. Would sit alongside REST, not replace it.
  - Priority: `backlog`
  - Category: `feature`
  - Impact: Flexible querying for frontend/integration consumers.

---

## Icebox

- ~~**IP allowlisting for webhook endpoint**~~ — Removed from active sprint. DuxSoup does not publish stable outbound IPs, making a static allowlist impractical. The endpoint is already defended by rate limiting (100/min), input validation, idempotency (event_key SHA1), and CORS. Revisit only if DuxSoup publishes IP ranges.

---

## Completed

- [x] **Configurable Winston log level via env var** — 2026-02-10. Added `LOG_LEVEL` env var override to `src/utils/logger.js`. Defaults to `info` in production, `debug` in development; any valid Winston level can be set via env var without redeployment. 4 new tests.
- [x] **Bulk alias lookup endpoint** — 2026-02-10. Added `POST /api/people/by-aliases` accepting `{ values: string[] }` (max 50, deduped). Single `$in` query on `aliases.value` multikey index. Returns `{ success, total, found, notFound, results: [{ value, found, person }] }`. Added `findPeopleByAliases` to `personReadService.js`, `getPersonsByAliases` to `personReadController.js`. 13 new tests (4 service + 9 controller).
- [x] **Add data freshness alerting** — 2026-02-10. Added `checkDataFreshness()` to health check job, monitoring visit and scan pipelines independently. Queries most recent Visit/Scan records in parallel. Fires `stale_visits`/`stale_scans` warnings when age exceeds `DATA_FRESHNESS_THRESHOLD_HOURS` (default 6h, env-configurable). Also fires `no_visits`/`no_scans` warnings when no records exist. Covers both "data freshness alerting" and "per-type webhook freshness monitoring" backlog items. 8 new tests.
- [x] **Add per-type webhook freshness monitoring (visit vs scan)** — 2026-02-10. Implemented as part of data freshness alerting above.
- [x] **Add webhook throughput metrics endpoint** — 2026-02-10. Added `GET /api/health/throughput` with real-time processing stats across 1m/5m/15m/1h windows. Created `src/utils/throughputTracker.js` using circular buffer of 3600 per-second buckets (~300KB memory). Tracks total, success, failure, debounced, duplicate, phase2Failure counts, per-type breakdown, rate/min, success rate, and avg latency. Instrumented `observationHandler.js` with `finally`-block recording on every code path. Uses `metricsCache` with 30s TTL for near-real-time data. 17 new tests.
- [x] **Add company/location export endpoints** — 2026-02-10. Extended streaming export infrastructure to support companies and locations. Added `entityType` field to ExportJob model. Created `COMPANY_FIELD_MAPPING`/`LOCATION_FIELD_MAPPING` with entity-specific defaults. Added `ENTITY_CONFIG` registry mapping entity types to models, fields, and ID formatters. Refactored `exportController.js` with `createExportHandler(entityType, format)` factory pattern. Added 4 new routes: `POST /api/export/{companies,locations}/{csv,json}`. Uses `checkForDangerousOperators` for entity-agnostic filter validation. 39 new tests.
- [x] **Add export job cleanup scheduler** — 2026-02-10. Added `src/workers/jobs/exportCleanup.js` that deletes export temp files older than `EXPORT_TTL_HOURS` (default 24h). Handles missing directory, skips subdirectories, isolates per-file errors. Added Job 5 to scheduler running every 6 hours (`0 */6 * * *`). 6 new tests.
- [x] **Fix identity resolution for international/locale-suffixed LinkedIn URLs** — 2026-02-10, commit `d8df92f`. Added locale suffix stripping (`/en`, `/fr`, etc.) to LinkedIn URL parsing in `salesNavIdExtractor.js` and `identityMatcher.js`. Prevents locale-suffixed URLs from leaking through as person `_id` values.
- [x] **Fix dead letter replay loop for education cast-to-string errors** — 2026-02-10. Investigation confirmed the replay path already goes through the same `upsertFromObservation()` with `coerceToString()` — the original hypothesis was incorrect. The real issue: dead letters purged as `permanently_failed` by `purgeStuckDeadLetters.js` can't benefit from the code fix. Added `scripts/resurrectDeadLetters.js` to reset permanently_failed dead letters matching now-fixed error patterns (Cast to string) back to `pending` for retry. Also extended `coerceToString()` to education date fields (`school.From`/`school.To`) to prevent silent data loss when DuxSoup sends rich objects for dates. Dry-run by default, `--commit` to execute, `--pattern` for custom error matching. 15 unit tests for resurrect script + 2 new education date tests. All 880 tests pass.
- [x] **Company/location controllers: eliminate find-modify-save race condition** — 2026-02-10, PR #103. Replaced multi-step find→mutate→save with atomic `findOneAndUpdate` operations. Eliminates E11000 race, separate reload, and non-atomic `save()`. Also fixed export service CSV header edge case for empty cursors.
- [x] **Purge permanently-stuck dead letters with validation errors** — 2026-02-10. Added `scripts/purgeStuckDeadLetters.js` with `isPermanentError()` classifier matching 7 permanent error patterns (CastError, ValidationError, invalid _id, E11000, etc.). Dry-run by default, `--commit` to execute. Skips transient errors (timeouts, connection failures). Falls back to `last_replay_error` when `error.message` is absent. 16 unit tests. All 858 tests pass.
- [x] **Remove `playground-1.mongodb.js` and `.history/` from repo** — 2026-02-10. Investigation found files exist locally but were never committed — `.gitignore` already had patterns for both (`playground-*.mongodb.js` and `.history/`). No git changes needed.
- [x] **Fix VisitTime/ScanTime schema to accept number or string** — 2026-02-10. DuxSoup sends timestamps as Unix numbers but schema only allowed strings, causing 100% of webhooks to trigger validation warnings. Updated `webhookSchemas.js` to accept `['string', 'number']` for both `VisitTime` and `ScanTime`. Flipped test from "detect number as error" to "accept number". Added ScanTime number test. All 842 tests pass.
- [x] **Fix ajv version mismatch and 8 failing tests** — 2026-02-10. Lockfile had ajv 6.12.6 despite `package.json` declaring `^8.17.1`. ajv v6 uses `dataPath` while the validator code uses v8's `instancePath`, causing all 8 type-error tests to produce `"dataundefined"` paths. Fixed by running `npm install ajv@latest` to sync to v8.17.1. All 841 tests pass.
- [x] **Remove `child_process.exec` from `/api/version` endpoint** — 2026-02-10, PR #91. Replaced shell exec with build-time `GIT_COMMIT` env var. Also removed hardcoded regex test debug output from the version response.
- [x] **Remove unused `csv-writer` dependency** — 2026-02-10, PR #92. Removed from `package.json` after the streaming export rewrite made it unnecessary.
- [x] **Add provenance tracking (`_meta`) to company snapshots** — 2026-02-10, PR #98. Company snapshots now track per-field provenance with `_meta` metadata matching the person model pattern.
- [x] **Add provenance tracking (`_meta`) to location snapshots** — 2026-02-10, PR #99. Location snapshots now track per-field provenance.
- [x] **Company controller: apply source precedence rules (visit > scan)** — 2026-02-10, PR #98. Company snapshots now follow the same visit-beats-scan, newer-beats-older precedence rules as person snapshots.
- [x] **Read endpoints missing rate limiting** — 2026-02-10, PR #93. Applied `readRateLimiter` to `GET /api/people/:id`, `/by-alias/:value`, and their company/location counterparts.
- [x] **Scheduler `stopScheduler()` does not actually cancel cron jobs** — 2026-02-10, PR #94. Now calls `task.stop()` on all cron tasks during shutdown.
- [x] **`isDuplicate` detection is unreliable in `observationHandler.js`** — 2026-02-10, PR #95. Uses `includeResultMetadata` to detect whether `findOneAndUpdate` created a new document or matched an existing one.
- [x] **Add integration tests for batch webhook endpoint** — 2026-02-10, PR #100. Integration tests for batch webhook processing and company/location entity upsert.
- [x] **Add integration tests for company and location upsert** — 2026-02-10, PR #100. Same PR as batch integration tests.
- [x] **Debounce cache has no upper bound** — 2026-02-10, PR #96. Added max-size bounds to both debounce and metrics caches.
- [x] **Metrics cache has no upper bound** — 2026-02-10, PR #96. Same PR as debounce cache bounds.
- [x] **Health check `searchPeople` does separate `countDocuments` for total** — 2026-02-10, PR #97. Parallelized search results and count queries.
- [x] **Export service still requires `csv-writer` in `package.json`** — 2026-02-10, PR #92. Same as csv-writer removal above.
- [x] **Version endpoint contains hardcoded regex test output** — 2026-02-10, PR #91. Same as exec removal above — debug output removed.
- [x] **Streaming export for large datasets** — 2026-02-10. Replaced in-memory `Person.find().lean().exec()` with MongoDB cursor streaming piped through Node.js Transform streams. CSV and JSON generation now use `stream.pipeline()` with backpressure support: cursor -> row-counter/limit-enforcer -> format transform -> file write stream. Removed `csv-writer` dependency for CSV generation in favor of built-in `escapeCsvField()`. Row limit (100K) enforced during streaming instead of after full load. Empty cursors produce valid empty files (`[]` for JSON). 24 unit tests (17 for processExportJob streaming, 4 for createExportJob, 3 for getExportFile).
- [x] **Batch webhook processing endpoint** — 2026-02-09. Added `POST /api/webhook/batch` accepting an array of payloads (max 50, env-configurable `MAX_BATCH_SIZE`). Extracted `processObservationPayload()` from `observationHandler.js` for reuse by both single and batch endpoints. Sequential processing, per-item error isolation, summary response with succeeded/failed counts. 120s timeout, `webhookRateLimiter` applied. Exported `getVisitConfig()`/`getScanConfig()` config factories. 12 new unit tests.
- [x] **Alert deduplication in notification service** — 2026-02-09, commit `5c1911c`. Added deduplication to suppress repeated health notifications within a configurable window.
- [x] **Data quality dashboard** — 2026-02-09. Added `GET /api/health/quality` endpoint with 4 parallel aggregation pipelines: identity resolution coverage (salesNavId/numericId/stableId/canonicalId), alias type distribution, enrichment depth (roles/education/skills/email/phone), and freshness buckets (7d/30d/90d). Excludes merged records. Uses metricsCache with 5-minute TTL. 11 new unit tests.
- [x] **Split adminRoutes.js into focused route modules** — 2026-02-10. Split 829-line monolith into 3 focused sub-routers: `adminLinkingRoutes.js` (check-upgradable, run-linking), `adminRebuildRoutes.js` (rebuild-people, rebuild-people-full), `adminMaintenanceRoutes.js` (drop-id-index, fix-alias-types, inspect-observations). Hub `adminRoutes.js` reduced to 40 lines mounting sub-routers + health + test-notifications. All 772 tests pass. No API path changes.
- [x] **Deduplicate person field normalization into a loop** — 2026-02-09. Replaced 27 sequential `normalizeField()` calls (19 direct field mappings + 8 location sub-fields) with data-driven `FIELD_MAPPINGS` array and `LOCATION_FIELDS` array iterated by loops. Supports optional `transform` functions (parseConnections, parseDegree) and fallback source keys (array of webhook keys). Complex fields (birthday, fullName, title parsing, company URL) remain inline. Reduced `upsertFromObservation()` normalization section from ~260 lines to ~110. 11 new unit tests verifying mapping completeness, no duplicates, transforms, fallback resolution, and location field coverage.
- [x] **Add exponential backoff for stuck dead letter replays** — 2026-02-09. Found already implemented: `permanently_failed` status in DeadLetter enum, `MAX_RETRY_ATTEMPTS = 10` with env override in `src/constants/limits.js`, exponential backoff (2m -> 4m -> 8m -> ... -> 720m cap) in `src/utils/backoff.js`, `markReplayFailed()` transitions to `permanently_failed` at 10 attempts, `findEligibleForReplay()` / `countEligibleForReplay()` skip ineligible records, scheduler uses backoff-aware eligibility check. 6 backoff unit tests + 8 dead letter model tests.
- [x] **Add merge safety validation** — 2026-02-09. Added `validateMergeSafety(winner, losers)` method to `identityResolverService.js` with pre-merge checks: observation disparity blockers (0-vs-N and 10x ratio), name contradiction blockers (both first+last differ), partial name mismatch warnings, and company mismatch warnings. Integrated into `mergePeople()` -- blocked merges return winner unchanged, warnings attach to Merge audit `metadata.safetyWarnings`. Added `force` bypass via admin routes, `--force` CLI flag in `linkIdentities.js` and `merge-duplicates.js`. `MERGE_OBS_RATIO_THRESHOLD` env-configurable (default 10). 22 new unit tests, 3 new integration tests.
- [x] **Add branch protection rules to `master`** — 2026-02-09. Enabled branch protection via GitHub API requiring `build-and-test` CI check to pass before merge. Strict mode enabled (branch must be up-to-date with master). Force pushes and branch deletion blocked. Admin enforcement left off to allow emergency hotfixes.
- [x] **Investigate absence of scan webhook activity** — 2026-02-09. Investigation found scans are actively flowing: 42,926 scans vs 37,274 visits in production MongoDB. Most recent scan created Feb 9 20:38 UTC. The earlier observation of "zero scans" was an artifact of a limited Render log window that happened to contain only visit traffic. Code review confirmed the scan pipeline is fully wired: `POST /api/webhook` correctly routes `type: "scan"` to `handleScan()`, the Scan model is feature-complete with indexes, and no silent filtering exists. No dead letter failures for scan type. No code changes needed.
- [x] **Webhook payload schema validation** — 2026-02-09. Added JSON Schema validation (ajv) for incoming DuxSoup webhooks in warn-only mode. Validates envelope structure, visit data fields, scan data fields, and extended data (positions, schools, skills) against known schemas. Detects two categories of drift: type violations (known field has unexpected type, logged as warning) and unknown fields (new fields DuxSoup added, logged as info). Integrated into `observationHandler.js` before existing validation -- never blocks webhook processing. Schemas defined in `webhookSchemas.js`, validator in `webhookSchemaValidator.js`. 41 new unit tests.
- [x] **Lateral move detection in change service** — 2026-02-09. Added `lateral_move` change type to detect company switches at the same seniority level (e.g., VP at Google -> VP at Meta). Uses `titleParser.parseTitle()` to compare seniority ranks. Lateral move records include full enrichment (fromCompanyId, toCompanyId, fromTitle, toTitle, seniority tier, tenure, recentJobChange flag). Recorded alongside `company_change` for backward compatibility. Added `fromTitle`, `toTitle`, `seniority`, `seniorityRank` fields to Change schema. 8 new unit tests.
- [x] **Role deduplication during person upsert** — 2026-02-09. Replaced naive `title|company|startDate` dedup key with `findMatchingRole()` using case/whitespace-normalized comparison and multi-dimensional matching. When startDate is null, uses isCurrent + location + description as secondary discriminators to avoid collapsing genuinely distinct undated roles. Added `mergeRoleFields()` to backfill empty fields on existing matched roles (companyId, location, description, dates). Removed unused `_roleKey` variable. 25 new unit tests covering null startDate collision, text normalization, field merging, and current-role matching.
- [x] **Add request timeout middleware** — 2026-02-09. Created `src/middleware/requestTimeout.js` factory returning Express middleware that sends 503 after configurable deadline. Applied: 5s for `/health`, 30s default for `/api`, 120s for `/api/export`. Timer cleared on `res.close`. 5 new unit tests.
- [x] **Reuse SMTP transporter in notification service** — 2026-02-09. Replaced per-send `nodemailer.createTransport()` with lazy-initialized module-level singleton via `getTransporter()`. Exposed `_resetTransporter()` for testing. 2 new unit tests confirm single instance across multiple sends.
- [x] **Clean up export temp files on failure** — 2026-02-09. Added `finally` block in `processExportJob()` that calls `fs.unlink()` on the temp file when job status is `failed`. Silently ignores ENOENT if the file was never created. 4 new unit tests.
- [x] **Suppress verbose dead letter replay output when queue is empty** — 2026-02-09. Added `DeadLetter.countDocuments()` early-exit in scheduler: when 0 pending, logs a single line (`Dead letter replay: 0 pending, skipped`) and skips the full replay call. Full banner preserved for CLI usage. 4 new unit tests.
- [x] **Adopt semantic versioning with tagged releases** — 2026-02-09, tag `v1.0.0`. Created annotated tag on master and published GitHub Release with full capability summary. Establishes baseline for future version tracking.
- [x] **Merge Dependabot PR #80** (nodemailer 8.0.0 -> 8.0.1) — 2026-02-09, commit `44d7139`. Squash-merged routine patch bump via GitHub API.
- [x] **Debounce rapid-fire duplicate visits for same profile** — 2026-02-09. Added in-memory debounce utility (`src/utils/upsertDebounce.js`) with configurable TTL window (default 30s, env `DEBOUNCE_WINDOW_MS`). Phase 1 observations still write for audit trail; Phase 2 entity upserts (person/company/location) are skipped within the debounce window. Response includes `debounced: true` flag for observability. 10 new unit tests.
- [x] **Normalize invalid role dates before save** — 2026-02-09, commit `4036883`. Added date inversion guard in `updateRolesTimeline()`: when `endDate < startDate`, nullifies `endDate` and logs a warning instead of letting the Mongoose validator reject the entire `person.save()`. 3 new unit tests.
- [x] **Decode percent-encoded LinkedIn URLs before identity extraction** — 2026-02-09. Added `safeDecode()` helper wrapping `decodeURIComponent` with try/catch. Widened username regex from `[a-zA-Z0-9_-]+` to `[^/?#]+?` to support decoded international characters (e, o). Applied decode to all 5 URL-consuming functions: `extractLinkedInUsername`, `extractVanityName`, `normalizeUrl`, `extractPublicProfileUrl`, `extractCompanyProfileUrl`. 15 new unit tests.
- [x] **Fix education object-to-string cast failure in person upsert** — 2026-02-09, commit `389d315`. Added `coerceToString()` helper to extract `.text` from DuxSoup rich objects (`{ text, textDirection, attributesV2 }`) and applied it to `school.Name`, `school.Degree`, and `school.Field` in `updateEducation()`. 11 new unit tests.
- [x] **Cache expensive health metrics aggregations** — 2026-02-09, commit `8b256c8`. Added in-memory TTL cache (`src/utils/metricsCache.js`) with 5-minute expiry for health metrics. Cached results returned for repeated requests within the window.
- [x] **Cap unbounded array growth on Person snapshot** — 2026-02-09. Added configurable caps (MAX_ROLES=50, MAX_EDUCATION=20, MAX_SKILLS=100) with env-var overrides in `src/constants/limits.js`. Extracted `updateEducation()` and `updateSkills()` helpers. Warnings logged with dropped-entry details when caps are hit. 14 new unit tests.
- [x] **Fix fuzzy search over-matching across unrelated names** — 2026-02-08. Replaced OR-joined regex (`John|Doe`) with AND-joined conditions requiring all terms to match. Added aggregation pipeline with relevance scoring (fullName 3x weight). 4 new unit tests.
- [x] **Add URL validation guard to `normalizeUrl()`** — 2026-02-08. Added guard clause rejecting non-URL strings (Sales Nav IDs, numeric IDs, usernames) that lack `https?://` scheme or `linkedin.com`. 8 new unit tests.
- [x] **Add missing indexes to Location model** — 2026-02-08. Added `snapshot.country`, `snapshot.city`, and compound `snapshot.city + snapshot.state + snapshot.country` indexes to match Person model.
- [x] **Add TTL index for `recentJobChangeExpiresAt` on Change model** — 2026-02-08. Added TTL index with `expireAfterSeconds: 0` so MongoDB auto-deletes expired change records.
- [x] **Add `mergedInto` index to Person model for merge tracking** — 2026-02-08. Added sparse index on `mergedInto` for efficient queries of merged/orphaned records.
- [x] **Tighten Sales Navigator ID detection across identity resolution** — 2026-02-08, commit `7dc2e34`. Strengthened `SALES_NAV_ID_PATTERN` to require 10+ chars after prefix (`{10,}` instead of `+`). Replaced inline regex in `determineWinner()` with shared constant. 4 new integration tests for edge cases (`ACoAAlex`, `ACwAABob`, bare prefix, real IDs).
- [x] **Fix numeric zero values rejected as empty in person snapshot upsert** — 2026-02-08, commit `e791f97`. `shouldOverwrite()` treated existing `0` as falsy via `!existingMeta.value`. Replaced with explicit null/undefined check. 2 new unit tests.
- [x] **Fix Scan model index on undefined `userid` field** — 2026-02-08, commit `e791f97`. Added `userid` field to Scan schema and `scanController.mapScanData()` to match Visit model pattern.
- [x] **Fix JSON deep clone losing Date objects in person snapshot comparison** — 2026-02-08, commit `e791f97`. Replaced `JSON.parse(JSON.stringify())` with `structuredClone(snapshot.toObject())`. 2 new unit tests.
- [x] **Fix CLAUDE.md schema + endpoint docs drift** — 2026-02-06. Updated Person model example to reflect `snapshot.*`, `snapshot._meta`, `meta.observationsCount` nesting, full alias type enum, `derived` section, role/education sub-fields. Fixed query (POST not GET), search (GET /api/search/ not /api/search/people), export (POST csv/json + status/download). Added missing endpoints: companies/locations by-alias, query/companies, changes, seniority, and 6 additional health endpoints.
- [x] **`findSalesNavIdDuplicates` misses persons with multiple salesNavId aliases** — 2026-02-07, branch `claude/review-backlog-D0qNE`, commit `46b93ff`. Renamed `extractSalesNavIdFromPersonRecord()` to `extractSalesNavIdsFromPersonRecord()` to return array of ALL salesNavIds. Updated `findSalesNavIdDuplicates()` to add merged persons to multiple groups. Added test case for multi-alias scenario.
- [x] **Dead letter alerting integration test** — 2026-02-07, branch `claude/dead-letter-alerting-test-VVEmP`. 17 integration tests covering threshold boundaries, alert routing (email for warning+critical, SMS for critical only), notification failure resilience, and health check error handling.
- [x] **API documentation (OpenAPI/Swagger)** — 2026-02-07, branch `claude/add-openapi-docs-zGEre`. Added OpenAPI 3.0 spec (`src/openapi.js`) covering all 40+ endpoints with schemas, examples, and rate-limit annotations. Swagger UI served at `/api/docs`, raw spec at `/api/docs/openapi.json`.
- [x] **Dependency audit** — 2026-02-07, branch `claude/dependency-audit-security-7jUZc`. Full `npm audit` pass: 0 vulnerabilities. Updated patch deps (dotenv 17.2.4, mongoose 9.1.6, twilio 5.12.1), major deps (nodemailer 8.0.0, eslint 10.0.0, @eslint/js 10.0.1). Fixed ESLint 10 `no-useless-assignment` lint error. Deprecated transitive deps (scmp, inflight, glob@7) not actionable -- upstream in twilio and jest.
- [x] **Parallelize CSV enrichment row processing** — 2026-02-07, branch `claude/parallelize-csv-enrichment-pyx6D`. Replaced sequential `for...of` loop with worker-pool `processWithConcurrency()` (default 10). Added `--concurrency` CLI flag. 5 new unit tests.
- [x] **CSV enrichment: create new person records** — 2026-02-06. Implemented `createPersonFromCsv()` with full snapshot, aliases, `_meta` provenance, derived metrics, E11000 race-condition handling. 19 unit tests.
- [x] **Birthday field: reject year-less date strings** — 2026-02-06, branch `claude/birthday-field-date-validation-7Kjts`. Added `containsYear()` and `parseBirthdayDate()` to date-parser.js; added `birthdayRaw` field to Person model.
- [x] **Fix stale parsedSeniority/parsedDepartment on title changes** — 2026-02-06, branch `claude/review-queue-items-AnAP2`. Added `clearDerivedField()` to bypass the "never overwrite with empty" rule for derived fields, clearing stale values when `parseTitle` returns null.
- [x] **Sunset hybrid read mode** — 2026-02-06, branch `claude/sunset-hybrid-read-mode-3nGbp`. Removed `READ_SOURCE` env var, hybrid/legacy read modes, legacy fallback code, cutover metrics, `/api/people/metrics` endpoint, and cutover scripts. All reads now go directly to people/company/location collections.
- [x] **Fix Atlas Search index targets wrong database** — 2026-02-06, branch `claude/fix-atlas-search-index-AoyDV`. JSON config hardcoded `"duxsoup"` instead of `"duxsoup-etl"`; `--create` now derives database from `MONGODB_URI` at runtime.
- [x] **Fix undefined pagination fields in fuzzy search fallback** — 2026-02-06, branch `claude/review-next-task-DOaSc`. `fuzzySearchPeople` now returns `totalCount`, `limit`, `skip`, `hasMore`, and `nextSkip` in metadata; supports `skip` param for pagination. 3 new unit tests.
- [x] **Fix case-sensitive CXO/GM/MD regex patterns in titleParser** — 2026-02-06, branch `claude/fix-cxo-pattern-HxciY`. Four patterns in `SENIORITY_TIERS` lacked the `i` flag, causing lowercase/mixed-case C-suite abbreviations (e.g., "ceo", "Cto") to misclassify as Individual Contributor.
- [x] **Eliminate legacy identityResolver.js wrapper** — 2026-02-06, migrated 23 callers (8 production, 7 scripts, 8 tests) to `identityMatcher.js`, deleted 525-line wrapper
- [x] **Clean up stale remote branches** — 2026-02-06, deleted 8 remote + 2 local stale branches, pruned 18 tracking refs
- [x] **Leader-election for multi-instance scheduler** — 2026-02-05, `cf5b696`
- [x] **Replace uuid with crypto.randomUUID()** — 2026-02-05, `c6e494e`
- [x] **Audit and label TODO comments** — 2026-02-04, branch `claude/audit-todo-comments-jrdRA`
- [x] **Graceful shutdown handler (SIGTERM/SIGINT)** — Already implemented in `src/index.js:212-241`
- [x] **Remove webhook auth** — DuxSoup cannot send credentials -- `8e9bcb0`
- [x] **Trust proxy for Render** — Correct client IP behind reverse proxy -- `288feb5`
- [x] **Query param secret for webhook providers** — `49b7474`
- [x] **Express 5 sanitize compatibility** — PR #57, `79535e9`
- [x] **Remove accumulated bloat** — 65 unused scripts, 38 stale docs -- `525d110`
- [x] **Security hardening and test coverage** — `8db738d`
- [x] **Fail-closed webhook auth and admin route protection** — `bbf480d`
