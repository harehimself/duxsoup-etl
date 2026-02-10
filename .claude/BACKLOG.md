# Project Backlog

> Canonical list of planned work for the DuxSoup ETL system.
>
> **Agents:** Read this file at session start for project context. Check items off as
> you complete them, then move them to the Completed section with a date and commit/PR ref.
> If new work is discovered during a session, add it to the appropriate priority tier.

---

## Active Sprint

### High Priority

- [x] ~~**Fix education object-to-string cast failure in person upsert**~~ — Completed, see Completed section.

- [x] ~~**Merge open Dependabot PR #80** (nodemailer 8.0.0 -> 8.0.1)~~ — Completed, see Completed section.

- [x] ~~**Decode percent-encoded LinkedIn URLs before identity extraction**~~ — Completed, see Completed section.

### Medium Priority

- [x] ~~**Fix CLAUDE.md schema + endpoint docs drift**~~ — Completed, see Completed section.

- [x] ~~**Tighten Sales Navigator ID detection across identity resolution**~~ — Completed, see Completed section.

- [x] ~~**Add URL validation guard to `normalizeUrl()`**~~ — Completed, see Completed section.

- [x] ~~**Add missing indexes to Location model**~~ — Completed, see Completed section.

- [x] ~~**Add TTL index for `recentJobChangeExpiresAt` on Change model**~~ — Completed, see Completed section.

- [x] ~~**Fix fuzzy search over-matching across unrelated names**~~ — Completed, see Completed section.

- [x] ~~**Add `mergedInto` index to Person model for merge tracking**~~ — Completed, see Completed section.

- [x] ~~**Cap unbounded array growth on Person snapshot**~~ — Completed, see Completed section.

- [x] ~~**Adopt semantic versioning with tagged releases**~~ — Completed, see Completed section.

- [x] ~~**Add branch protection rules to `master`**~~ — Completed, see Completed section.

- [x] ~~**Debounce rapid-fire duplicate visits for same profile**~~ — Completed, see Completed section.

- [x] ~~**Investigate absence of scan webhook activity**~~ — Completed, see Completed section.

- [x] ~~**Add request timeout middleware**~~ — Completed, see Completed section.

- [x] ~~**Normalize invalid role dates before save instead of failing**~~ — Completed, see Completed section.

### Low Priority / Tech Debt

- [x] ~~**Parallelize CSV enrichment row processing**~~ — Completed, see Completed section.

- [x] ~~**Cache expensive health metrics aggregations**~~ — Completed, see Completed section.

- [x] ~~**Clean up export temp files on failure**~~ — Completed, see Completed section.

- [ ] **Split adminRoutes.js into focused route modules** — At 826 lines, `adminRoutes.js` handles merge, rebuild, link, and migrate operations in a single file.
  - Priority: `low`
  - Category: `refactor`
  - Files: `src/routes/adminRoutes.js`
  - Context: The file mixes merge endpoints, rebuild endpoints, link endpoints, and migration endpoints. Each group has its own middleware and validation logic.
  - Fix: Split into `mergeRoutes.js`, `rebuildRoutes.js`, `linkRoutes.js`, `migrateRoutes.js` and compose in `adminRoutes.js`.
  - Acceptance: Each route file is under 250 lines. All existing tests pass. No API path changes.

- [ ] **Deduplicate person field normalization into a loop** — `personController.js` has 30+ sequential `normalizeField()` calls that follow an identical pattern and could be driven by a field mapping table.
  - Priority: `low`
  - Category: `refactor`
  - Files: `src/controllers/personController.js:451-713`
  - Context: Each field update is a separate `normalizeField(snapshot, '_meta', 'fieldName', value, source, observedAt, observationId)` call. A mapping array like `[{ field: 'firstName', source: 'First Name' }, ...]` would reduce ~260 lines to ~30.
  - Fix: Create `FIELD_MAPPINGS` array and iterate with a loop.
  - Acceptance: Same snapshot output for identical inputs. Existing tests pass. File reduced by 200+ lines.

- [x] ~~**Reuse SMTP transporter in notification service**~~ — Completed, see Completed section.

- [x] ~~**Add request timeout middleware**~~ — Completed, see Completed section.

- [ ] **Add exponential backoff for stuck dead letter replays** — Dead letter replay processes up to 100 pending records hourly but doesn't increase delay for records that repeatedly fail.
  - Priority: `low`
  - Category: `reliability`
  - Files: `src/workers/scheduler.js`, `src/models/deadLetter.js`
  - Context: A record that fails 50 times will be retried every hour indefinitely. The `replay_attempts` counter is tracked but not used for backoff or max-retry decisions.
  - Fix: Skip records where `replay_attempts > MAX_RETRIES` (e.g., 10). Add exponential backoff based on attempt count. Mark records as `permanently_failed` after max retries.
  - Acceptance: Records with 10+ failures are skipped. `permanently_failed` status added to DeadLetter enum. Unit test confirms backoff logic.

- [x] ~~**Webhook payload schema validation**~~ — Completed, see Completed section.

- [x] ~~**Role deduplication during person upsert**~~ — Completed, see Completed section.

- [x] ~~**Add merge safety validation**~~ — Completed, see Completed section.

- [x] ~~**Suppress verbose dead letter replay output when queue is empty**~~ — Completed, see Completed section.

---

## Recommendations

> New items to consider. Move to Active Sprint when prioritized.

- [ ] **Snapshot versioning / change history** — Person and company snapshots are mutated in-place with no version history. There's no way to see what a person's profile looked like 30 days ago.
  - Priority: `backlog`
  - Category: `feature`
  - Impact: Enables temporal queries ("who changed jobs in Q1"), audit trails, and rollback of bad data. Could be implemented as a separate `PersonHistory` collection with snapshot-per-observation or periodic snapshots.

- [ ] **Batch webhook processing endpoint** — Add a `POST /api/webhook/batch` endpoint accepting an array of webhook payloads in a single HTTP request.
  - Priority: `backlog`
  - Category: `feature`
  - Impact: Reduces HTTP overhead for bulk imports. DuxSoup may not use it, but internal tools and CSV importers would benefit from a batch API.

- [ ] **Streaming export for large datasets** — Current export loads all matching documents into memory before writing CSV/JSON. For 100K+ person exports, this will hit memory limits.
  - Priority: `backlog`
  - Category: `performance`
  - Impact: Enables exports of the full database without OOM risk. Use MongoDB cursor streaming + Node.js Transform stream.

- [x] ~~**API documentation (OpenAPI/Swagger)**~~ — Completed, see Completed section.

- [x] ~~**Dead letter alerting integration test**~~ — Completed, see Completed section.

- [ ] **Data quality dashboard** — Expose a `/api/health/quality` endpoint showing: alias coverage, canonical_id coverage, Person records without roles, people without stable IDs (salesNavId or numericId).
  - Priority: `backlog`
  - Category: `observability`
  - Impact: Proactive detection of identity resolution gaps or enrichment drift.

- [x] ~~**Dependency audit**~~ — Completed, see Completed section.

- [ ] **Alert deduplication in notification service** — No check for whether the same alert was recently sent. A flapping health check could spam the same alert every 6 hours.
  - Priority: `backlog`
  - Category: `reliability`
  - Impact: Prevents alert fatigue. Track last alert hash + timestamp, suppress duplicates within a window.

- [x] ~~**Lateral move detection in change service**~~ — Completed, see Completed section.

_(Role deduplication, merge safety validation, and webhook payload schema validation promoted to Active Sprint — see Low Priority section above.)_

- [ ] **Structured log forwarding to external aggregation** — Logs are well-structured JSON but there's no external aggregation beyond Render's 30-day window. Consider forwarding to a log aggregation service (Datadog, Logtail, Betterstack) for alerts, dashboards, and historical analysis.
  - Priority: `backlog`
  - Category: `observability`
  - Impact: Persistent log history, real-time alerting on error spikes, operational dashboards beyond Render's built-in viewer.

---

## Icebox

- ~~**IP allowlisting for webhook endpoint**~~ — Removed from active sprint. DuxSoup does not publish stable outbound IPs, making a static allowlist impractical. The endpoint is already defended by rate limiting (100/min), input validation, idempotency (event_key SHA1), and CORS. Revisit only if DuxSoup publishes IP ranges.

---

## Completed

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
