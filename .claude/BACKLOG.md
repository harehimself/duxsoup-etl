# Project Backlog

> Canonical list of planned work for the DuxSoup ETL system.
>
> **Agents:** Read this file at session start for project context. Check items off as
> you complete them, then move them to the Completed section with a date and commit/PR ref.
> If new work is discovered during a session, add it to the appropriate priority tier.

---

## Active Sprint

### High Priority

- [x] **Remove `child_process.exec` from `/api/version` endpoint** — Already resolved. The endpoint now reads from `process.env.GIT_COMMIT || "unknown"` with no shell exec.

- [x] **Remove unused `csv-writer` dependency** — Already removed during streaming export rewrite (PR #89). No action needed.

- [x] **Company/location controllers: eliminate find-modify-save race condition** — 2026-02-10, commit `f677e54`. Replaced multi-step find→mutate→updateOne→findById→save with two atomic `findOneAndUpdate` operations: (1) upsert with `$setOnInsert` for find-or-create, (2) single `$set` + `$addToSet` for all updates. Eliminates E11000 race, separate reload, and non-atomic `save()`. 19 updated unit tests.

### Medium Priority

- [ ] **Add provenance tracking (`_meta`) to company snapshots** — Person snapshots track per-field provenance (`_meta.fieldName.observedAt`, `.source`, `.observationId`) but company snapshots use a simple `applySnapshotValue()` with no metadata. This means there's no way to audit when or from which observation a company field was last updated.
  - Priority: `medium`
  - Category: `feature`
  - Impact: Parity with person model, enables debugging "where did this company name come from?"

- [ ] **Add provenance tracking (`_meta`) to location snapshots** — Same gap as company: location snapshots have no per-field provenance. The location controller blindly overwrites fields with `parsed.X || location.snapshot.X`.
  - Priority: `medium`
  - Category: `feature`
  - Impact: Audit trail for location data sources.

- [ ] **Company controller: apply source precedence rules (visit > scan)** — `companyController.js` applies snapshot values unconditionally (any non-empty value overwrites). Unlike the person controller, there's no visit-beats-scan or newer-beats-older logic. A stale scan could overwrite a fresh visit's company name.
  - Priority: `medium`
  - Category: `bug`
  - Impact: Ensures company snapshots follow the same precedence rules as person snapshots.

- [ ] **Read endpoints missing rate limiting** — `GET /api/people/:id` and `GET /api/people/by-alias/:value` (and their company/location counterparts at `apiRoutes.js:131-140`) are not wrapped in `readRateLimiter`. All other read endpoints have rate limiting applied. An attacker could enumerate all person records at unrestricted speed.
  - Priority: `medium`
  - Category: `security`
  - Impact: Closes a rate-limiting gap for entity lookup endpoints.

- [ ] **Scheduler `stopScheduler()` does not actually cancel cron jobs** — `src/workers/scheduler.js:204-213` sets `schedulerStarted = false` but doesn't call `task.stop()` on any cron task. The comment says "Tasks will naturally stop when process exits" but during graceful shutdown there's a window where jobs could fire after `stopScheduler()` is called but before `process.exit()`.
  - Priority: `medium`
  - Category: `bug`
  - Impact: Prevents orphaned cron jobs from running during shutdown, especially dead letter replays that touch the database.

- [ ] **`isDuplicate` detection is unreliable in `observationHandler.js`** — `isDuplicate` is set to `false` after a successful `findOneAndUpdate` upsert (`observationHandler.js:94`), but `findOneAndUpdate` with `$setOnInsert` returns the existing document on conflict rather than throwing E11000. The flag is only set to `true` in the E11000 catch branch. This means re-processed webhooks silently pass as "new" and trigger redundant Phase 2 upserts.
  - Priority: `medium`
  - Category: `bug`
  - Impact: Reduces unnecessary Phase 2 work and provides accurate duplicate metrics.

### Low Priority / Tech Debt

- [ ] **Add integration tests for batch webhook endpoint** — The batch endpoint (`batchWebhookHandler.js`) has unit tests but no integration tests hitting a real MongoDB instance. The existing integration test suite (`api.integration.test.js`) doesn't cover `POST /api/webhook/batch`.
  - Priority: `low`
  - Category: `testing`
  - Impact: Validates batch processing end-to-end with real database interactions.

- [ ] **Add integration tests for company and location upsert** — No integration tests exist for `companyController.js` or `locationController.js`. These are Phase 2 upserts that run on every webhook but are only covered by the person controller integration tests indirectly.
  - Priority: `low`
  - Category: `testing`
  - Impact: Catches regressions in company/location identity resolution and snapshot updates.

- [ ] **Debounce cache has no upper bound** — `src/utils/upsertDebounce.js` uses an unbounded `Map` with lazy cleanup on each `shouldSkip()` call. Under sustained high volume (thousands of unique profiles), the cache grows without limit until entries expire. Add a max-size eviction policy or periodic sweep.
  - Priority: `low`
  - Category: `reliability`
  - Impact: Prevents unbounded memory growth under high webhook volume.

- [ ] **Metrics cache has no upper bound** — `src/utils/metricsCache.js` (used by health endpoints) similarly has no cap on the number of cached keys. While the current key set is small and fixed, there's no guard against future misuse.
  - Priority: `low`
  - Category: `tech-debt`
  - Impact: Defensive coding against future cache key proliferation.

- [ ] **Health check `searchPeople` does separate `countDocuments` for total** — `src/services/searchService.js:78-80` runs `Person.countDocuments({ $text: ... })` as a separate query after the main search. For large collections this is expensive. Consider using `$facet` in an aggregation pipeline to get results + count in one query, or return an estimated count.
  - Priority: `low`
  - Category: `performance`
  - Impact: Reduces MongoDB load for search queries by ~50%.

- [x] **Export service still requires `csv-writer` in `package.json`** — Already removed during streaming export rewrite (PR #89). Cross-ref with high-priority item above.

- [x] **Version endpoint contains hardcoded regex test output** — Already resolved. The debug regex_test output has been removed.

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

---

## Icebox

- ~~**IP allowlisting for webhook endpoint**~~ — Removed from active sprint. DuxSoup does not publish stable outbound IPs, making a static allowlist impractical. The endpoint is already defended by rate limiting (100/min), input validation, idempotency (event_key SHA1), and CORS. Revisit only if DuxSoup publishes IP ranges.

---

## Completed

- [x] **Streaming export for large datasets** — 2026-02-10. Replaced in-memory `Person.find().lean().exec()` with MongoDB cursor streaming piped through Node.js Transform streams. CSV and JSON generation now use `stream.pipeline()` with backpressure support: cursor → row-counter/limit-enforcer → format transform → file write stream. Removed `csv-writer` dependency for CSV generation in favor of built-in `escapeCsvField()`. Row limit (100K) enforced during streaming instead of after full load. Empty cursors produce valid empty files (`[]` for JSON). 24 unit tests (17 for processExportJob streaming, 4 for createExportJob, 3 for getExportFile).
- [x] **Batch webhook processing endpoint** — 2026-02-09. Added `POST /api/webhook/batch` accepting an array of payloads (max 50, env-configurable `MAX_BATCH_SIZE`). Extracted `processObservationPayload()` from `observationHandler.js` for reuse by both single and batch endpoints. Sequential processing, per-item error isolation, summary response with succeeded/failed counts. 120s timeout, `webhookRateLimiter` applied. Exported `getVisitConfig()`/`getScanConfig()` config factories. 12 new unit tests.
- [x] **Alert deduplication in notification service** — 2026-02-09, commit `5c1911c`. Added deduplication to suppress repeated health notifications within a configurable window.
- [x] **Data quality dashboard** — 2026-02-09. Added `GET /api/health/quality` endpoint with 4 parallel aggregation pipelines: identity resolution coverage (salesNavId/numericId/stableId/canonicalId), alias type distribution, enrichment depth (roles/education/skills/email/phone), and freshness buckets (7d/30d/90d). Excludes merged records. Uses metricsCache with 5-minute TTL. 11 new unit tests.
- [x] **Split adminRoutes.js into focused route modules** — 2026-02-10. Split 829-line monolith into 3 focused sub-routers: `adminLinkingRoutes.js` (check-upgradable, run-linking), `adminRebuildRoutes.js` (rebuild-people, rebuild-people-full), `adminMaintenanceRoutes.js` (drop-id-index, fix-alias-types, inspect-observations). Hub `adminRoutes.js` reduced to 40 lines mounting sub-routers + health + test-notifications. All 772 tests pass. No API path changes.
- [x] **Deduplicate person field normalization into a loop** — 2026-02-09. Replaced 27 sequential `normalizeField()` calls (19 direct field mappings + 8 location sub-fields) with data-driven `FIELD_MAPPINGS` array and `LOCATION_FIELDS` array iterated by loops. Supports optional `transform` functions (parseConnections, parseDegree) and fallback source keys (array of webhook keys). Complex fields (birthday, fullName, title parsing, company URL) remain inline. Reduced `upsertFromObservation()` normalization section from ~260 lines to ~110. 11 new unit tests verifying mapping completeness, no duplicates, transforms, fallback resolution, and location field coverage.
- [x] **Add exponential backoff for stuck dead letter replays** — 2026-02-09. Found already implemented: `permanently_failed` status in DeadLetter enum, `MAX_RETRY_ATTEMPTS = 10` with env override in `src/constants/limits.js`, exponential backoff (2m → 4m → 8m → ... → 720m cap) in `src/utils/backoff.js`, `markReplayFailed()` transitions to `permanently_failed` at 10 attempts, `findEligibleForReplay()` / `countEligibleForReplay()` skip ineligible records, scheduler uses backoff-aware eligibility check. 6 backoff unit tests + 8 dead letter model tests.
- [x] **Add merge safety validation** — 2026-02-09. Added `validateMergeSafety(winner, losers)` method to `identityResolverService.js` with pre-merge checks: observation disparity blockers (0-vs-N and 10x ratio), name contradiction blockers (both first+last differ), partial name mismatch warnings, and company mismatch warnings. Integrated into `mergePeople()` — blocked merges return winner unchanged, warnings attach to Merge audit `metadata.safetyWarnings`. Added `force` bypass via admin routes, `--force` CLI flag in `linkIdentities.js` and `merge-duplicates.js`. `MERGE_OBS_RATIO_THRESHOLD` env-configurable (default 10). 22 new unit tests, 3 new integration tests.
- [x] **Add branch protection rules to `master`** — 2026-02-09. Enabled branch protection via GitHub API requiring `build-and-test` CI check to pass before merge. Strict mode enabled (branch must be up-to-date with master). Force pushes and branch deletion blocked. Admin enforcement left off to allow emergency hotfixes.
- [x] **Investigate absence of scan webhook activity** — 2026-02-09. Investigation found scans are actively flowing: 42,926 scans vs 37,274 visits in production MongoDB. Most recent scan created Feb 9 20:38 UTC. The earlier observation of "zero scans" was an artifact of a limited Render log window that happened to contain only visit traffic. Code review confirmed the scan pipeline is fully wired: `POST /api/webhook` correctly routes `type: "scan"` to `handleScan()`, the Scan model is feature-complete with indexes, and no silent filtering exists. No dead letter failures for scan type. No code changes needed.
- [x] **Webhook payload schema validation** — 2026-02-09. Added JSON Schema validation (ajv) for incoming DuxSoup webhooks in warn-only mode. Validates envelope structure, visit data fields, scan data fields, and extended data (positions, schools, skills) against known schemas. Detects two categories of drift: type violations (known field has unexpected type, logged as warning) and unknown fields (new fields DuxSoup added, logged as info). Integrated into `observationHandler.js` before existing validation — never blocks webhook processing. Schemas defined in `webhookSchemas.js`, validator in `webhookSchemaValidator.js`. 41 new unit tests.
- [x] **Lateral move detection in change service** — 2026-02-09. Added `lateral_move` change type to detect company switches at the same seniority level (e.g., VP at Google → VP at Meta). Uses `titleParser.parseTitle()` to compare seniority ranks. Lateral move records include full enrichment (fromCompanyId, toCompanyId, fromTitle, toTitle, seniority tier, tenure, recentJobChange flag). Recorded alongside `company_change` for backward compatibility. Added `fromTitle`, `toTitle`, `seniority`, `seniorityRank` fields to Change schema. 8 new unit tests.
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
- [x] **Dependency audit** — 2026-02-07, branch `claude/dependency-audit-security-7jUZc`. Full `npm audit` pass: 0 vulnerabilities. Updated patch deps (dotenv 17.2.4, mongoose 9.1.6, twilio 5.12.1), major deps (nodemailer 8.0.0, eslint 10.0.0, @eslint/js 10.0.1). Fixed ESLint 10 `no-useless-assignment` lint error. Deprecated transitive deps (scmp, inflight, glob@7) not actionable — upstream in twilio and jest.
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
- [x] **Remove webhook auth** — DuxSoup cannot send credentials — `8e9bcb0`
- [x] **Trust proxy for Render** — Correct client IP behind reverse proxy — `288feb5`
- [x] **Query param secret for webhook providers** — `49b7474`
- [x] **Express 5 sanitize compatibility** — PR #57, `79535e9`
- [x] **Remove accumulated bloat** — 65 unused scripts, 38 stale docs — `525d110`
- [x] **Security hardening and test coverage** — `8db738d`
- [x] **Fail-closed webhook auth and admin route protection** — `bbf480d`
