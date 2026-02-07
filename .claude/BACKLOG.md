# Project Backlog

> Canonical list of planned work for the DuxSoup ETL system.
>
> **Agents:** Read this file at session start for project context. Check items off as
> you complete them, then move them to the Completed section with a date and commit/PR ref.
> If new work is discovered during a session, add it to the appropriate priority tier.

---

## Active Sprint

### High Priority

- [ ] **Fix numeric zero values rejected as empty in person snapshot upsert** — `isIncomingEmpty()` in `personController.js` treats `0` as falsy, so valid numeric fields like `Connections: 0` are rejected during snapshot updates.
  - Category: `bug`
  - Files: `src/controllers/personController.js:103-105`
  - Context: Any person with `0` connections or `0` degree will have those fields silently dropped during upsert. The `shouldOverwrite()` guard uses `!incomingValue` which is false for `0`, `""`, and `null` alike.
  - Fix: Replace `!incomingValue` with an explicit null/undefined/empty-string check that allows `0` and `false`.
  - Acceptance: `normalizeField()` accepts `0` as a valid value. Unit test confirms `Connections: 0` is written to snapshot.

- [ ] **Fix Scan model index on undefined `userid` field** — `scan.js` defines a compound index on `userid + ScanTime`, but `userid` is not in the Scan schema. The index silently fails to be useful.
  - Category: `bug`
  - Files: `src/models/scan.js`
  - Context: Visit model has `userid` field defined and indexed. Scan model copies the index pattern but lacks the field. Queries filtering scans by userid will not use the index.
  - Fix: Add `userid` field to Scan schema (String, indexed) to match Visit model, or remove the index if userid is not present in scan webhooks.
  - Acceptance: Scan schema includes `userid` if DuxSoup sends it. Index matches defined fields. Integration test confirms filtering by userid works.

- [ ] **Fix JSON deep clone losing Date objects in person snapshot comparison** — `personController.js` uses `JSON.parse(JSON.stringify(existingPerson))` to clone the old snapshot before comparison, which converts Date objects to strings and breaks `_meta.observedAt` comparisons.
  - Category: `bug`
  - Files: `src/controllers/personController.js:445-448`
  - Context: Change detection compares old vs new snapshots. If the clone converts Dates to ISO strings, timestamp comparisons become string comparisons, which may produce incorrect precedence results.
  - Fix: Use `structuredClone()` (available in Node 17+) or Mongoose's `toObject()` to preserve Date types.
  - Acceptance: Old snapshot clone preserves Date instances. Unit test confirms date-based precedence comparison works correctly.

### Medium Priority

- [ ] **Fix CLAUDE.md schema + endpoint docs drift** — Align person snapshot example and query/search/export routes with current models and routes
  - Category: `docs`
  - Files: `.claude/CLAUDE.md`, `src/models/person.js`, `src/routes/queryRoutes.js`, `src/routes/searchRoutes.js`, `src/routes/exportRoutes.js`
  - Context: The person model example documents snapshot fields at the top level and lists GET-based query/search/export endpoints that no longer match the implementation. This can mislead users into querying/updating incorrect paths or hitting 404/method errors.
  - Acceptance: Update the Person example to reflect `snapshot`, `snapshot._meta`, and `meta.observationsCount` nesting; correct query/search/export endpoint paths and HTTP verbs.

- [ ] **Tighten Sales Navigator ID detection across identity resolution** — The prefix-only regex `/^(ACwAA|ACoAA)/` in `determineWinner()` can misclassify username-based `_id` values (e.g., `ACoAAlex`) as Sales Nav IDs, causing incorrect merge winner selection.
  - Category: `bug`
  - Files: `src/services/identityResolverService.js:177` (`determineWinner` regex), `src/utils/salesNavIdExtractor.js` (canonical format)
  - Context: Production impact — merge winner selection could favor a non-Sales-Nav person if their username happens to start with `ACwAA` or `ACoAA`.
  - Fix: Replace prefix-only check with a full canonical format regex (e.g., `^AC[wo]AA[A-Za-z0-9_-]{10,}$` case-insensitive) that requires sufficient length to distinguish from usernames.
  - Acceptance: `determineWinner()` does not match short username-based IDs. Unit tests for edge cases like `ACoAAlex`, `ACwAABob`.

- [ ] **Add URL validation guard to `normalizeUrl()`** — `normalizeUrl()` in `identityMatcher.js` accepts any string without validating it's a URL. Non-URL identifiers (SalesNav IDs, numeric IDs, usernames) would be mangled if passed through it.
  - Category: `bug`
  - Files: `src/utils/identityMatcher.js:140-160`
  - Context: Current production code only calls `normalizeUrl` on known URL fields, so the risk is contained. But the function has no guard, making it a trap for future callers (backfill scripts, enrichment paths).
  - Fix: Add URL validation (check for `linkedin.com` or URL scheme) inside `normalizeUrl()`, or rename to clarify URL-only purpose and add an assertion.
  - Acceptance: `normalizeUrl('ACwAAA_TEST123')` returns `null` (or the input unchanged). Unit test confirms non-URL inputs are rejected.

- [ ] **Add missing indexes to Location model** — Location model lacks indexes on `snapshot.country`, `snapshot.city`, and the compound `city+state+country` that Person model already has.
  - Category: `performance`
  - Files: `src/models/location.js`
  - Context: Person model has a 3-field compound index on `snapshot.city + snapshot.state + snapshot.country`. Location model — the actual geo entity — has none of these. Country-level queries against locations will require collection scans.
  - Fix: Add `snapshot.country` index, `snapshot.city` index, and `snapshot.city + snapshot.state + snapshot.country` compound index.
  - Acceptance: `db.locations.getIndexes()` shows the new indexes. Explain plan for country-based queries uses index scan.

- [ ] **Add TTL index for `recentJobChangeExpiresAt` on Change model** — The `recentJobChangeExpiresAt` field exists for auto-expiring the 90-day rolling flag, but no TTL index is defined, so expired records persist indefinitely.
  - Category: `bug`
  - Files: `src/models/change.js`
  - Context: The `recentJobChange` boolean and `recentJobChangeExpiresAt` date were added for a rolling 90-day window, but without a TTL index MongoDB won't auto-delete or flag expired records. The scheduler job `flagExpiry` handles this manually, but the TTL index would be a safety net.
  - Fix: Add TTL index on `recentJobChangeExpiresAt` with `expireAfterSeconds: 0`, or add a partial index + scheduled cleanup if full deletion isn't desired.
  - Acceptance: Expired change records are automatically cleaned up by MongoDB TTL. Unit test verifies TTL index exists.

- [ ] **Fix fuzzy search over-matching across unrelated names** — `searchService.js` fuzzy fallback converts "John Doe" into regex `John|Doe`, matching anyone named John regardless of last name, or anyone at a company containing "Doe".
  - Category: `bug`
  - Files: `src/services/searchService.js:131-140`
  - Context: Multi-word queries produce OR-joined regex patterns. "John Doe" matches "John Smith" (via "John") and "Jane Doe" (via "Doe") equally. No result ranking by match quality.
  - Fix: Use AND-joined conditions (all terms must appear in the same document), or weight results by number of matching terms. Consider adding a relevance score.
  - Acceptance: Searching "John Doe" ranks exact matches higher than partial matches. Unit test confirms multi-word queries filter correctly.

- [ ] **Add `mergedInto` index to Person model for merge tracking** — Person records have a `mergedInto` field set when merged into another person, but no index exists for finding merged/orphaned records.
  - Category: `performance`
  - Files: `src/models/person.js`
  - Context: Admin operations and health checks need to find all merged persons (`{ mergedInto: { $exists: true } }`). Without an index, this requires a full collection scan.
  - Fix: Add sparse index on `mergedInto`.
  - Acceptance: Query for merged persons uses index scan. Health metrics endpoint performance improves.

- [ ] **Cap unbounded array growth on Person snapshot** — Roles, education, and skills arrays can grow without limit. A person observed 1000+ times could accumulate thousands of role entries if deduplication misses edge cases.
  - Category: `reliability`
  - Files: `src/controllers/personController.js:295-323` (roles), `src/controllers/personController.js:727-746` (education)
  - Context: Role deduplication keys on `title|companyId|startDate`, but null startDates cause all untitled roles to collide. Education deduplication is similar. Over time, arrays can grow large enough to impact query performance and document size.
  - Fix: Add configurable max array sizes (e.g., roles: 50, education: 20, skills: 100). Log a warning when limits are reached. Ensure deduplication handles null fields correctly.
  - Acceptance: Arrays are capped. Warning logged when cap is hit. Unit test with >50 roles confirms truncation.

### Low Priority / Tech Debt

- [ ] **`findSalesNavIdDuplicates` misses persons with multiple salesNavId aliases** — `extractSalesNavIdFromPersonRecord()` uses `aliases.find()` which only returns the first `salesNavId` alias; merged persons with multiple salesNavIds are only grouped under one ID
  - Category: `bug`
  - Files: `src/services/identityResolverService.js:632`
  - Context: After merges, a person can carry multiple `salesNavId` values (e.g., `ACwAAA111` and `ACwAAA222`). The function only returns the first match, so duplicates keyed on subsequent IDs are silently missed. This only affects the diagnostic `findSalesNavIdDuplicates()` — the core identity resolution path (`resolveOrCreate`, `findByAnyAlias`) handles multiple aliases correctly.
  - Acceptance: `extractSalesNavIdFromPersonRecord()` returns all salesNavIds for a person. `findSalesNavIdDuplicates()` groups the person under every salesNavId it carries. Existing test updated to cover multi-alias case.

- [ ] **Parallelize CSV enrichment row processing** — Add configurable concurrency for large imports
  - Category: `performance`
  - Files: `scripts/importCsvEnrichment.js:553`
  - Context: Rows are processed sequentially with `for...of` + `await`. Fine for small imports, bottleneck for large ones.
  - Acceptance: `--concurrency=N` flag (default 1). Uses batched Promise.allSettled or similar. Progress logging shows throughput.

- [ ] **Cache expensive health metrics aggregations** — `healthController.js` runs 10+ `countDocuments()` calls and `distinct()` queries on every request with no caching. The dashboard endpoint hits the database heavily.
  - Category: `performance`
  - Files: `src/controllers/healthController.js:109-112, 589-610`
  - Context: Health endpoints are called every 6 hours by the scheduler, but can also be hit manually. Each call runs ~10 parallel count queries. For large collections (100K+ people), this is expensive.
  - Fix: Add in-memory TTL cache (5-minute expiry) for health metrics. Return cached results for repeated requests within the window.
  - Acceptance: Second call within 5 minutes returns cached data. Unit test confirms cache hit/miss behavior.

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

- [ ] **API documentation (OpenAPI/Swagger)** — No machine-readable API spec exists. Adding one would make the read APIs self-documenting and enable client codegen.
  - Category: `dx`
  - Impact: Easier onboarding for any consumers of the people/company/location endpoints.

- [ ] **Dead letter alerting integration test** — The notification service supports email (nodemailer) and SMS (Twilio), but the health check → alert pipeline lacks end-to-end test coverage.
  - Category: `reliability`
  - Impact: Confidence that alerts actually fire when dead letter backlog grows.

- [ ] **Data quality dashboard** — Expose a `/api/health/quality` endpoint showing: alias coverage, canonical_id coverage, Person records without roles, people without stable IDs (salesNavId or numericId).
  - Category: `observability`
  - Impact: Proactive detection of identity resolution gaps or enrichment drift.

- [ ] **Dependency audit** — 3 Dependabot PRs/branches exist. Mongoose 9.x, Express 5.x, and Jest 30.x are current, but a full `npm audit` pass would catch transitive vulnerabilities.
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

---

## Icebox

- ~~**IP allowlisting for webhook endpoint**~~ — Removed from active sprint. DuxSoup does not publish stable outbound IPs, making a static allowlist impractical. The endpoint is already defended by rate limiting (100/min), input validation, idempotency (event_key SHA1), and CORS. Revisit only if DuxSoup publishes IP ranges.

---

## Completed

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
