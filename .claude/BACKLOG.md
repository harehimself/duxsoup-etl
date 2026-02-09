# Project Backlog

> Canonical list of planned work for the DuxSoup ETL system.
>
> **Agents:** Read this file at session start for project context. Check items off as
> you complete them, then move them to the Completed section with a date and commit/PR ref.
> If new work is discovered during a session, add it to the appropriate priority tier.

---

## Active Sprint

### High Priority

- [ ] **Fix education object-to-string cast failure in person upsert** — DuxSoup occasionally sends rich objects (`{ textDirection, text, attributesV2 }`) instead of plain strings for school names in the `extended.schools` array. `updateEducation()` passes `school.Name` directly without type checking, causing Mongoose validation failure (`Cast to string failed`). This is an active production bug generating dead letters that will never self-heal via replay.
  - Category: `bug`
  - Files: `src/controllers/personController.js:391-434`
  - Context: Observed in Render logs Feb 3-4 (30+ errors). Dead letter replay retries the same bad data every hour, failing each time. The affected person records never get their snapshot updated.
  - Fix: Type-check `school.Name` — if it's an object with a `.text` property, extract that; otherwise `String()` coerce. Apply the same guard to `school.Degree` and `school.Field`.
  - Acceptance: Person upsert succeeds when DuxSoup sends object-typed school fields. Dead letters for this error stop accumulating. Unit test covers object-shaped input.

- [ ] **Merge open Dependabot PR #80** (nodemailer 8.0.0 -> 8.0.1) — Routine patch bump. CI passing. Should be merged promptly to stay current.
  - Category: `maintenance`
  - Acceptance: PR merged, dependency updated on master.

- [ ] **Decode percent-encoded LinkedIn URLs before identity extraction** — Username extraction regex (`/\/in\/([a-zA-Z0-9_-]+)/`) truncates at `%` characters in percent-encoded URLs, producing invalid 1-2 character IDs (e.g., `j`, `fl`). There is zero `decodeURIComponent` usage anywhere in the identity pipeline.
  - Category: `bug`
  - Files: `src/utils/identityMatcher.js:35-113`
  - Context: Root cause of the Feb 5 production errors (`Invalid person ID format: j`, `Invalid person ID format: fl`). DuxSoup occasionally sends URLs with encoded characters. The regex captures everything before the first `%`, which may be only 1-2 characters. The Person `_id` validator (min 3 chars) catches it, but by then the person upsert fails and creates a dead letter.
  - Fix: Add `decodeURIComponent()` to URL inputs before regex extraction in `extractIdentifiers()`. Guard with try/catch for malformed encodings. Add test cases for encoded URLs.
  - Acceptance: URLs like `/in/john%20doe` correctly extract `john doe` or are safely handled. No more single-character ID validation failures. Unit tests cover percent-encoded inputs.

### Medium Priority

- [x] **Fix CLAUDE.md schema + endpoint docs drift** — Align person snapshot example and query/search/export routes with current models and routes
  - Category: `docs`
  - Files: `.claude/CLAUDE.md`, `src/models/person.js`, `src/routes/queryRoutes.js`, `src/routes/searchRoutes.js`, `src/routes/exportRoutes.js`
  - Context: The person model example documents snapshot fields at the top level and lists GET-based query/search/export endpoints that no longer match the implementation. This can mislead users into querying/updating incorrect paths or hitting 404/method errors.
  - Acceptance: Update the Person example to reflect `snapshot`, `snapshot._meta`, and `meta.observationsCount` nesting; correct query/search/export endpoint paths and HTTP verbs.

- [x] ~~**Tighten Sales Navigator ID detection across identity resolution**~~ — Completed, see Completed section.

- [x] ~~**Add URL validation guard to `normalizeUrl()`**~~ — `normalizeUrl()` in `identityMatcher.js` accepts any string without validating it's a URL. Non-URL identifiers (SalesNav IDs, numeric IDs, usernames) would be mangled if passed through it.
  - Category: `bug`
  - Files: `src/utils/identityMatcher.js:140-160`
  - Context: Current production code only calls `normalizeUrl` on known URL fields, so the risk is contained. But the function has no guard, making it a trap for future callers (backfill scripts, enrichment paths).
  - Fix: Add URL validation (check for `linkedin.com` or URL scheme) inside `normalizeUrl()`, or rename to clarify URL-only purpose and add an assertion.
  - Acceptance: `normalizeUrl('ACwAAA_TEST123')` returns `null` (or the input unchanged). Unit test confirms non-URL inputs are rejected.

- [x] ~~**Add missing indexes to Location model**~~ — Location model lacks indexes on `snapshot.country`, `snapshot.city`, and the compound `city+state+country` that Person model already has.
  - Category: `performance`
  - Files: `src/models/location.js`
  - Context: Person model has a 3-field compound index on `snapshot.city + snapshot.state + snapshot.country`. Location model — the actual geo entity — has none of these. Country-level queries against locations will require collection scans.
  - Fix: Add `snapshot.country` index, `snapshot.city` index, and `snapshot.city + snapshot.state + snapshot.country` compound index.
  - Acceptance: `db.locations.getIndexes()` shows the new indexes. Explain plan for country-based queries uses index scan.

- [x] ~~**Add TTL index for `recentJobChangeExpiresAt` on Change model**~~ — The `recentJobChangeExpiresAt` field exists for auto-expiring the 90-day rolling flag, but no TTL index is defined, so expired records persist indefinitely.
  - Category: `bug`
  - Files: `src/models/change.js`
  - Context: The `recentJobChange` boolean and `recentJobChangeExpiresAt` date were added for a rolling 90-day window, but without a TTL index MongoDB won't auto-delete or flag expired records. The scheduler job `flagExpiry` handles this manually, but the TTL index would be a safety net.
  - Fix: Add TTL index on `recentJobChangeExpiresAt` with `expireAfterSeconds: 0`, or add a partial index + scheduled cleanup if full deletion isn't desired.
  - Acceptance: Expired change records are automatically cleaned up by MongoDB TTL. Unit test verifies TTL index exists.

- [x] ~~**Fix fuzzy search over-matching across unrelated names**~~ — `searchService.js` fuzzy fallback converts "John Doe" into regex `John|Doe`, matching anyone named John regardless of last name, or anyone at a company containing "Doe".
  - Category: `bug`
  - Files: `src/services/searchService.js:131-140`
  - Context: Multi-word queries produce OR-joined regex patterns. "John Doe" matches "John Smith" (via "John") and "Jane Doe" (via "Doe") equally. No result ranking by match quality.
  - Fix: Use AND-joined conditions (all terms must appear in the same document), or weight results by number of matching terms. Consider adding a relevance score.
  - Acceptance: Searching "John Doe" ranks exact matches higher than partial matches. Unit test confirms multi-word queries filter correctly.

- [x] ~~**Add `mergedInto` index to Person model for merge tracking**~~ — Person records have a `mergedInto` field set when merged into another person, but no index exists for finding merged/orphaned records.
  - Category: `performance`
  - Files: `src/models/person.js`
  - Context: Admin operations and health checks need to find all merged persons (`{ mergedInto: { $exists: true } }`). Without an index, this requires a full collection scan.
  - Fix: Add sparse index on `mergedInto`.
  - Acceptance: Query for merged persons uses index scan. Health metrics endpoint performance improves.

- [x] ~~**Cap unbounded array growth on Person snapshot**~~ — Completed, see Completed section.

- [ ] **Adopt semantic versioning with tagged releases** — 80+ PRs merged, zero releases or tags. No way to track what's deployed, roll back to a known version, or correlate deployment issues with code changes.
  - Category: `dx/ops`
  - Context: All work ships directly to `master` with auto-deploy to Render. If a bad commit deploys, there's no tagged version to roll back to. GitHub Releases page is empty.
  - Fix: Create initial `v1.0.0` tag on current master. Tag subsequent deploys. Consider `standard-version` or GitHub Release automation.
  - Acceptance: `git tag -l` shows at least one semver tag. GitHub Releases page has a published release.

- [ ] **Add branch protection rules to `master`** — Commits have been pushed directly to master that broke CI (Feb 5 package-lock.json sync), then immediately fixed. No branch protection enforces CI status checks.
  - Category: `reliability`
  - Fix: GitHub Settings > Branches > Branch protection rule: require status checks to pass, optionally require PR review.
  - Acceptance: Direct pushes to master that fail CI are blocked. PRs require green CI before merge.

- [ ] **Debounce rapid-fire duplicate visits for same profile** — Render logs show DuxSoup sending 3-5 separate webhooks for the same `duxsoupId` within 30-60 seconds, each with a unique `event_key`. These are not idempotency duplicates — they create separate observations and re-run the full person upsert pipeline each time.
  - Category: `data-quality`
  - Files: `src/controllers/observationHandler.js`, `src/controllers/personController.js`
  - Context: Example: `id.67070797` (ingmarpeters) generated 5 visits in 90 seconds on Feb 9. Each triggers a full person upsert, company upsert, and location upsert. The observation still writes (audit trail), but the snapshot re-computation is wasteful.
  - Fix: Add a short debounce window (e.g., skip person/company/location upsert if same `duxsoupId` was processed within last 30 seconds). Use an in-memory Map with TTL, similar to `metricsCache.js`.
  - Acceptance: Rapid-fire visits for the same profile only trigger one person upsert within the debounce window. All observations still write. Unit test confirms debounce behavior.

- [ ] **Investigate absence of scan webhook activity** — Recent Render logs show 100% visit type with zero scans. If scan webhooks are expected from DuxSoup, the scan pipeline may be misconfigured or disabled on the DuxSoup side.
  - Category: `investigation`
  - Context: The codebase has full scan handling (`scanController.js`, `Scan` model) but no scan traffic has been observed in the recent log window. This could be normal (scans not configured) or could indicate a silent failure.
  - Acceptance: Confirmed whether scans are expected. If not, document that scan handling is retained for future use.

- [ ] **Normalize invalid role dates before save instead of failing** — Person model has a Mongoose validator (`endDate >= startDate`) on roles, but validation only fires at save time. When DuxSoup sends a role where `endDate < startDate`, the entire person upsert fails and creates a dead letter.
  - Category: `bug`
  - Files: `src/controllers/personController.js:288-382`, `src/models/person.js:55-67`
  - Context: `updateRolesTimeline()` calls `parseSafeDate()` on `pos.From` and `pos.To` but does not check date ordering. The Mongoose validator catches it at `person.save()`, but by then it's too late — the entire snapshot update is lost. No test coverage for this case.
  - Fix: In `updateRolesTimeline()`, after parsing dates, if `endDate < startDate`, either swap them or null out `endDate` (keep the role with `startDate` only). Log a warning with the original values.
  - Acceptance: Roles with inverted dates are normalized instead of causing upsert failure. Unit test confirms date swap/nullification behavior.

### Low Priority / Tech Debt

- [x] ~~**Parallelize CSV enrichment row processing**~~ — Completed, see Completed section.

- [x] ~~**Cache expensive health metrics aggregations**~~ — Completed, see Completed section.

- [ ] **Clean up export temp files on failure** — `exportService.js` writes CSV/JSON to temp directory but doesn't clean up files when export jobs fail mid-write.
  - Category: `reliability`
  - Files: `src/services/exportService.js`
  - Context: Failed exports leave orphaned files in the temp directory. Over time, this can consume disk space on the Render instance.
  - Fix: Add try/finally cleanup in the export pipeline. Delete temp file if job status is `failed`.
  - Acceptance: Failed export jobs don't leave temp files. Unit test confirms cleanup on error.

- [ ] **Split adminRoutes.js into focused route modules** — At 826 lines, `adminRoutes.js` handles merge, rebuild, link, and migrate operations in a single file.
  - Category: `refactor`
  - Files: `src/routes/adminRoutes.js`
  - Context: The file mixes merge endpoints, rebuild endpoints, link endpoints, and migration endpoints. Each group has its own middleware and validation logic.
  - Fix: Split into `mergeRoutes.js`, `rebuildRoutes.js`, `linkRoutes.js`, `migrateRoutes.js` and compose in `adminRoutes.js`.
  - Acceptance: Each route file is under 250 lines. All existing tests pass. No API path changes.

- [ ] **Deduplicate person field normalization into a loop** — `personController.js` has 30+ sequential `normalizeField()` calls that follow an identical pattern and could be driven by a field mapping table.
  - Category: `refactor`
  - Files: `src/controllers/personController.js:451-713`
  - Context: Each field update is a separate `normalizeField(snapshot, '_meta', 'fieldName', value, source, observedAt, observationId)` call. A mapping array like `[{ field: 'firstName', source: 'First Name' }, ...]` would reduce ~260 lines to ~30.
  - Fix: Create `FIELD_MAPPINGS` array and iterate with a loop.
  - Acceptance: Same snapshot output for identical inputs. Existing tests pass. File reduced by 200+ lines.

- [ ] **Reuse SMTP transporter in notification service** — `notificationService.js` creates a new `nodemailer.createTransport()` for every send, which opens a new TCP connection each time.
  - Category: `performance`
  - Files: `src/services/notificationService.js:65`
  - Context: SMTP connection setup has non-trivial latency. For batch notifications (change digests), this multiplies.
  - Fix: Create transporter once at module initialization, reuse for all sends. Add connection error handling with lazy reconnect.
  - Acceptance: Single transporter instance. Unit test confirms reuse across multiple sends.

- [ ] **Add request timeout middleware** — No global request timeout exists. Long-running queries or exports can hold connections open indefinitely.
  - Category: `reliability`
  - Files: `src/index.js`
  - Context: Express 5 doesn't enforce request timeouts by default. A slow MongoDB query or large export could tie up a connection indefinitely on Render.
  - Fix: Add `connect-timeout` middleware or custom timeout (e.g., 30s for API, 120s for export, 5s for health).
  - Acceptance: Requests exceeding timeout return 503. Unit test confirms timeout behavior.

- [ ] **Add exponential backoff for stuck dead letter replays** — Dead letter replay processes up to 100 pending records hourly but doesn't increase delay for records that repeatedly fail.
  - Category: `reliability`
  - Files: `src/workers/scheduler.js`, `src/models/deadLetter.js`
  - Context: A record that fails 50 times will be retried every hour indefinitely. The `replay_attempts` counter is tracked but not used for backoff or max-retry decisions.
  - Fix: Skip records where `replay_attempts > MAX_RETRIES` (e.g., 10). Add exponential backoff based on attempt count. Mark records as `permanently_failed` after max retries.
  - Acceptance: Records with 10+ failures are skipped. `permanently_failed` status added to DeadLetter enum. Unit test confirms backoff logic.

- [ ] **Suppress verbose dead letter replay output when queue is empty** — Scheduler logs the full replay banner (`DEAD LETTER REPLAY`, `Found 0 dead letters`, `No dead letters to replay`, etc.) every hour even when there's nothing to process. This adds noise to Render logs.
  - Category: `noise-reduction`
  - Files: `src/workers/scheduler.js`, dead letter replay script
  - Fix: When count is 0, log a single info line (`Dead letter replay: 0 pending, skipped`) instead of the full banner output.
  - Acceptance: Hourly replay with 0 records produces at most 2 log lines instead of 10+.

---

## Recommendations

> New items to consider. Move to Active Sprint when prioritized.

- [ ] **Snapshot versioning / change history** — Person and company snapshots are mutated in-place with no version history. There's no way to see what a person's profile looked like 30 days ago.
  - Category: `feature`
  - Impact: Enables temporal queries ("who changed jobs in Q1"), audit trails, and rollback of bad data. Could be implemented as a separate `PersonHistory` collection with snapshot-per-observation or periodic snapshots.

- [ ] **Batch webhook processing endpoint** — Add a `POST /api/webhook/batch` endpoint accepting an array of webhook payloads in a single HTTP request.
  - Category: `feature`
  - Impact: Reduces HTTP overhead for bulk imports. DuxSoup may not use it, but internal tools and CSV importers would benefit from a batch API.

- [ ] **Streaming export for large datasets** — Current export loads all matching documents into memory before writing CSV/JSON. For 100K+ person exports, this will hit memory limits.
  - Category: `performance`
  - Impact: Enables exports of the full database without OOM risk. Use MongoDB cursor streaming + Node.js Transform stream.

- [x] ~~**API documentation (OpenAPI/Swagger)**~~ — Completed, see Completed section.
  - Category: `dx`
  - Impact: Easier onboarding for any consumers of the people/company/location endpoints.

- [x] **Dead letter alerting integration test** — ~~The notification service supports email (nodemailer) and SMS (Twilio), but the health check → alert pipeline lacks end-to-end test coverage.~~ Done.
  - Category: `reliability`
  - Impact: Confidence that alerts actually fire when dead letter backlog grows.

- [ ] **Data quality dashboard** — Expose a `/api/health/quality` endpoint showing: alias coverage, canonical_id coverage, Person records without roles, people without stable IDs (salesNavId or numericId).
  - Category: `observability`
  - Impact: Proactive detection of identity resolution gaps or enrichment drift.

- [x] ~~**Dependency audit**~~ — Completed, see Completed section.
  - Category: `security`

- [ ] **Alert deduplication in notification service** — No check for whether the same alert was recently sent. A flapping health check could spam the same alert every 6 hours.
  - Category: `reliability`
  - Impact: Prevents alert fatigue. Track last alert hash + timestamp, suppress duplicates within a window.

- [ ] **Lateral move detection in change service** — `changeDetectionService.js` detects promotions (seniority upgrade) and company changes but not lateral moves (same seniority, different company or role).
  - Category: `feature`
  - Impact: More complete job change intelligence. Useful for sales intelligence ("VP moved to competitor").

- [ ] **Role deduplication during person upsert** — Role deduplication keys on `title|companyId|startDate`, but null `startDate` causes all undated roles at the same title+company to collide. Roles can also accumulate if title or company varies slightly.
  - Category: `data-quality`
  - Impact: Prevents role array bloat and improves person snapshot accuracy.

- [ ] **Add `mergedInto` index and merge safety validation** — `identityResolverService.js` merge does not validate that the winner is the better record before deleting the loser. If a loser has 9000 observations and the winner has 10, the merge proceeds anyway.
  - Category: `reliability`
  - Impact: Prevents accidental data loss from incorrect merge winner selection.

- [ ] **Webhook payload schema validation** — The education object-casting bug reveals that DuxSoup's payload format can change without warning. Add JSON Schema validation (e.g., `ajv`) on incoming webhooks to detect and log schema drift before it causes downstream failures.
  - Category: `reliability`
  - Impact: Early warning system for DuxSoup API changes. Schema violations logged as warnings without rejecting the webhook, allowing graceful degradation.

- [ ] **Structured log forwarding to external aggregation** — Logs are well-structured JSON but there's no external aggregation beyond Render's 30-day window. Consider forwarding to a log aggregation service (Datadog, Logtail, Betterstack) for alerts, dashboards, and historical analysis.
  - Category: `observability`
  - Impact: Persistent log history, real-time alerting on error spikes, operational dashboards beyond Render's built-in viewer.

---

## Icebox

- ~~**IP allowlisting for webhook endpoint**~~ — Removed from active sprint. DuxSoup does not publish stable outbound IPs, making a static allowlist impractical. The endpoint is already defended by rate limiting (100/min), input validation, idempotency (event_key SHA1), and CORS. Revisit only if DuxSoup publishes IP ranges.

---

## Completed

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
