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

- [ ] **Add deployment batching/cooldown policy to reduce canceled Render deploys** — Frequent merge bursts create canceled deploy churn (e.g., 5 merges within 2 minutes triggers 5 deploys, 4 canceled). Introduce merge windows or deploy queue/cooldown policy to batch deploys.
  - Priority: `high`
  - Category: `reliability / platform efficiency`
  - Impact: Eliminates wasted build minutes and deploy churn on the Starter plan.

- [x] **Add route-to-OpenAPI conformance tests in CI (hard failure on drift)** — API surface is expanding rapidly. Add a CI test that validates registered Express routes against the OpenAPI spec in `src/openapi.js`, failing the build on any drift. Protects client integrations from undocumented breaking changes.
  - Priority: `high`
  - Category: `bug prevention`
  - Impact: Prevents API surface drift; catches missing/mismatched routes before merge.

- [x] **Company intelligence rollup API** — Aggregate all people linked to a company into org-level insights: headcount by seniority tier, department distribution, recent hires and departures (via change records), key decision-makers (highest seniority), average tenure, and hiring velocity (new people observed per month). `GET /api/companies/:id/intelligence` returning a structured summary. Built from existing person snapshots, seniority parsing, and change detection — no new data collection needed.
  - Priority: `high`
  - Category: `feature / business intelligence`
  - Impact: Turns individual contact records into account-level intelligence for ABM (Account-Based Marketing) and sales prioritization.

- [x] **Engagement trigger feed** — Surface time-sensitive actionable signals as a consumable feed: recent job changes (first 90 days = buying window), promotions (budget authority shift), lateral moves to target accounts, and newly observed decision-makers. `GET /api/signals/` with filters for signal type, seniority tier, recency window, and company. Built on top of the existing Change collection and seniority data. Returns ranked, deduplicated signals with recommended action context.
  - Priority: `high`
  - Category: `feature / business intelligence`
  - Impact: Answers "who should I reach out to this week and why?" — the highest-value question for sales teams consuming this data.

- [x] **Person activity timeline API** — Chronological feed of all observed events and changes for a single person: when they were first seen, each observation timestamp, every detected change (title change, company change, promotion, lateral move), and snapshot field updates with before/after values. `GET /api/people/:id/timeline` with pagination and optional date range filter. Assembled from the observations array, Change records, and snapshot `_meta` provenance timestamps.
  - Priority: `high`
  - Category: `feature / business intelligence`
  - Impact: Answers "what do we know about this person's career trajectory?" in a single call. Essential for sales prep and relationship context.

- [ ] **Network composition analytics** — Aggregate all 1st-degree connections (people with `snapshot.degree` = "1st") into a profile of the user's network. `GET /api/insights/network-profile` returning distributions across: top companies (ranked by headcount), seniority tier breakdown, most common job titles and title clusters, industry distribution, geographic spread (top cities/countries), department breakdown (from `parsedDepartment`), and average tenure. Support optional filters (industry, location, seniority) to slice the data. Include a `GET /api/insights/network-profile/trends` variant comparing current network composition against 30/60/90-day snapshots to surface growth patterns (e.g., "your fintech connections grew 15% this month"). Built entirely from existing person snapshot fields — no new data collection.
  - Priority: `high`
  - Category: `feature / business intelligence`
  - Impact: Answers "what does my network actually look like?" — reveals concentration gaps, over/under-indexed industries, and informs targeted outreach strategy. Foundational for any network-as-an-asset workflow.

### Medium Priority

- [x] **Comprehensive person data quality backfill script** — Nine data quality improvements were added to the ingestion pipeline (whitespace trimming, email normalization, phone normalization, skill/education dedup, location parsing, US region categorization, seniority parsing, derived metrics) but had no backfill scripts for existing records. Created `scripts/backfillPersonDataQuality.js` — a single-pass backfill that applies all improvements to existing person records via cursor-based iteration with dry-run by default. Supports `--only=STEP` for selective application, `--skip`/`--limit` for chunked execution, and `--verbose` for field-level change logging. 50 unit tests. **Executed against production on 2026-02-12:** 23,654 records processed, 23,255 updated, 0 errors.
  - Priority: `medium`
  - Category: `data quality / backfill`
  - Impact: Applies all recent ingestion pipeline improvements retroactively to every existing person record.

- [x] **Fix Change model TTL index destroying audit trail** — The TTL index on `recentJobChangeExpiresAt` with `expireAfterSeconds: 0` was deleting entire Change documents after 90 days, destroying the audit trail. Removed the TTL behavior since scheduler Job 4 already correctly expires the `recentJobChange` boolean flag daily via `updateMany`. Changed to a plain index for query performance.
  - Priority: `high`
  - Category: `bug / data integrity`
  - Impact: Prevents permanent loss of change audit records after 90 days.

- [x] **Add CompanyID field to Visit model** — Visit model was missing `CompanyID` field (present in Scan model). DuxSoup visit webhooks can include CompanyID but it was only preserved in rawData, not as a first-class field. Added to Visit schema and visit data mapper.
  - Priority: `high`
  - Category: `bug / data completeness`
  - Impact: Company identity resolution now works reliably for visit-sourced observations.

- [x] **Add missing region field to Company model** — Company snapshot was missing the `region` field (present in Person and Location models). Added to schema and company controller snapshot field mappings.
  - Priority: `medium`
  - Category: `data completeness`
  - Impact: Metropolitan area region data no longer silently dropped for companies.

- [x] **Add parsedSeniority index to Person model** — Seniority API endpoints filter by `snapshot.parsedSeniority` but the field was not indexed, requiring collection scans.
  - Priority: `medium`
  - Category: `performance`
  - Impact: Faster seniority filter queries.

- [x] **Cap or replace unbounded observation reference arrays** — Person, Company, and Location models store `observations.visits` and `observations.scans` as unbounded ObjectId arrays that grow with every webhook. High-frequency entities accumulate thousands of refs. Consider capping to last N refs (since `meta.observationsCount` already tracks totals) or replacing with count-only. Location is especially wasteful since common locations like "San Francisco Bay Area" accumulate massive arrays.
  - Priority: `high`
  - Category: `performance / data model`
  - Impact: Reduces document bloat, faster reads/writes, prevents approaching MongoDB 16MB document limit.
  - Discovered: 2026-02-12, data model review.

- [x] **Extract shared shouldOverwrite precedence logic** — `shouldOverwrite()` is independently implemented in personController, companyController, and locationController with identical logic. Extract to `src/utils/precedence.js` to eliminate DRY violation and ensure precedence rules stay synchronized.
  - Priority: `medium`
  - Category: `tech debt`
  - Impact: Single source of truth for precedence rules.
  - Discovered: 2026-02-12, data model review.

- [x] **Trim and collapse whitespace on all snapshot string fields** — The `FIELD_MAPPINGS` loop in `personController.js` passes raw DuxSoup values through to snapshot fields without trimming. Fields affected: `firstName`, `middleName`, `lastName`, `currentTitle`, `currentCompany`, `location`, `industry`, `summary`, `email`, `phone`, `twitter`. DuxSoup scrapes raw LinkedIn HTML, so leading/trailing whitespace and collapsed multi-spaces are common. Add a default `trim()` transform to the field mapping loop and a `collapseWhitespace()` (replace `\s+` with single space) for multi-word text fields. Apply at Phase 2 only — observations should keep raw data for audit. Also trim role `title`, `companyName`, `location`, `description` in `updateRolesTimeline()` before storage (currently only normalized for comparison via `normalizeRoleText()`). Include a backfill script to clean existing records.
  - Priority: `medium`
  - Category: `data quality`
  - Impact: Eliminates whitespace inconsistencies across all snapshot fields. Improves exact-match queries, faceting, deduplication, and downstream CRM sync.
  - Discovered: 2026-02-11, data cleansing review.

- [x] **Case-insensitive skill deduplication** — `updateSkills()` in `personController.js` uses `new Set()` with exact string matching, so "JavaScript" and "javascript" are stored as separate entries. Normalize comparison with `.toLowerCase().trim()` while preserving first-seen casing in the stored value. Include a backfill script to deduplicate existing skill arrays.
  - Priority: `medium`
  - Category: `data quality`
  - Impact: Eliminates duplicate skills caused by casing differences. Improves skill-based filtering and search accuracy.
  - Discovered: 2026-02-11, data cleansing review.

- [x] **Normalize email addresses on person snapshot** — Email is passed through as-is from DuxSoup with no lowercasing, trimming, or format validation. "John@Gmail.com" and "john@gmail.com" appear as different values. Add a `normalizeEmail` transform: `trim().toLowerCase()` with optional RFC 5322 regex validation in warn-only mode (log invalid formats, don't reject the webhook). Include a backfill script to normalize existing email values.
  - Priority: `medium`
  - Category: `data quality`
  - Impact: Enables reliable email-based deduplication and CRM matching. Surfaces invalid email data for cleanup.
  - Discovered: 2026-02-11, data cleansing review.

- [x] **Case-insensitive education deduplication** — `updateEducation()` in `personController.js` compares `school`, `degree`, and `field` with strict `===` equality. "MIT" vs "mit" or " Harvard University" vs "Harvard University" create duplicate entries. Normalize comparison values with `.toLowerCase().trim()` while storing original casing. Include a backfill script to merge duplicate education entries.
  - Priority: `medium`
  - Category: `data quality`
  - Impact: Eliminates duplicate education entries caused by casing and whitespace differences.
  - Discovered: 2026-02-11, data cleansing review.

- [x] **Company name normalization utility** — Company names in person snapshots and the companies collection have no normalization. "Microsoft", " Microsoft ", "Microsoft Corporation", and "microsoft" are treated as different entities. Add a `normalizeCompanyName()` utility that trims, collapses whitespace, and optionally strips common suffixes (Inc., LLC, Ltd., Corp., Co.) for canonical matching. Apply during company identity resolution and person snapshot upsert.
  - Priority: `medium`
  - Category: `data quality`
  - Impact: Improves company-based grouping, deduplication, and cross-entity linking accuracy.
  - Discovered: 2026-02-11, data cleansing review.

- [x] **Data cleanliness metrics endpoint** — Health endpoints don't expose field-level quality metrics. Add `GET /api/health/data-cleanliness` that samples person records and reports: % of names with leading/trailing whitespace, % of emails failing format validation, % of skill arrays with case-insensitive duplicates, % of education arrays with trimming-sensitive duplicates, % of records missing key fields (email, phone, title). Uses `metricsCache` with 10-minute TTL.
  - Priority: `medium`
  - Category: `observability / data quality`
  - Impact: Makes data quality issues measurable and trackable over time. Validates effectiveness of cleansing improvements.
  - Discovered: 2026-02-11, data cleansing review.

- [x] **Phone number normalization** — Phone stored as raw string with no formatting. "+1 (555) 123-4567", "5551234567", "555-123-4567" are all different values for the same number. Add a `normalizePhone()` utility that strips non-digit characters (except leading `+`) and stores a normalized form. Keep raw value in `_meta` provenance for audit. Include a backfill script.
  - Priority: `medium`
  - Category: `data quality`
  - Impact: Enables reliable phone-based deduplication and CRM matching.
  - Discovered: 2026-02-11, data cleansing review.

- [ ] **Expose webhook processing warnings in API responses and persisted telemetry** — Capacity-limit drops (`MAX_ROLES`/`MAX_EDUCATION`/`MAX_SKILLS`) and soft errors are currently only logged. Return structured `warnings[]` in webhook responses and persist warning counters for visibility in monitoring.
  - Priority: `medium`
  - Category: `feature`
  - Impact: Makes data truncation and soft errors visible to callers and monitoring dashboards.

- [ ] **Introduce durable metrics sink (Redis/Postgres) for throughput tracker snapshots** — In-memory rolling metrics (`throughputTracker.js`) reset on restarts/deploys. Persist key aggregates for continuity and trend analysis across deploys.
  - Priority: `medium`
  - Category: `feature / reliability`
  - Impact: Metrics survive restarts; enables historical trend analysis.

- [ ] **Add admin-safe correction APIs with audit trail** — Add `PATCH /api/people/:id` (and optional company/location variants) for manual snapshot corrections with full audit trail. Reduces direct DB edits and improves operational governance.
  - Priority: `medium`
  - Category: `feature`
  - Impact: Enables ops corrections without SSH/database access.

- [ ] **Implement replay impact dashboard (before/after entity counts and failure reasons)** — Replay scripts exist but provide no visibility on recovery effectiveness. Add a dashboard or API endpoint showing before/after entity counts and recurring root causes per replay run.
  - Priority: `medium`
  - Category: `feature / observability`
  - Impact: Visibility on recovery effectiveness and recurring failure root causes.

- [ ] **Add configurable circuit breaker for external notification channels (email/SMS)** — Prevent alert storms or provider-side failures from amplifying incidents. Add circuit breaker pattern to notification service with configurable thresholds and recovery windows.
  - Priority: `medium`
  - Category: `reliability`
  - Impact: Prevents cascading failures from notification provider outages.

- [ ] **Add query/search integration benchmark suite with representative datasets** — Query complexity is rising; establish guardrails for latency and pagination behavior. Create a benchmark suite with representative datasets to catch performance regressions.
  - Priority: `medium`
  - Category: `performance`
  - Impact: Establishes latency baselines and catches query performance regressions.

- [x] **Enrichment gap analysis report** — Identify high-value contacts (by seniority tier, company, or custom criteria) that are missing critical fields (email, phone, company ID, roles, education). `GET /api/insights/enrichment-gaps` returning ranked gaps grouped by field and filterable by seniority/company. Includes a `GET /api/insights/enrichment-gaps/revisit-list` endpoint that outputs a DuxSoup-compatible CSV of profile URLs to re-visit, prioritized by contact value and gap severity.
  - Priority: `medium`
  - Category: `feature / business intelligence`
  - Impact: Closes the feedback loop — tells the user exactly which profiles to re-visit with DuxSoup to fill data gaps, maximizing the value of each scan cycle.

- [ ] **Tag and list management for people segments** — User-defined tags (free-form labels like `"Q1-outreach"`, `"champions"`) and lists (named collections of person IDs) with full CRUD APIs. Support both static lists (manually curated) and dynamic lists (auto-populated from a saved query that re-evaluates on read or on schedule). `POST /api/lists`, `GET /api/lists/:id/members`, `PATCH /api/people/:id/tags`. Requires a `List` model and a `tags` array on Person.
  - Priority: `medium`
  - Category: `feature / business intelligence`
  - Impact: Enables segmentation and campaign targeting without external tooling. Foundation for CRM-like workflows on top of the intelligence layer.

- [ ] **Saved searches with change-triggered alerts** — Allow consumers to save a query (e.g., "VP+ in fintech, Bay Area") and subscribe to notifications when new people match or existing matches undergo job changes, promotions, or lateral moves. Requires a `SavedSearch` model storing query criteria + notification preferences, and a scheduled job that re-evaluates saved searches against recent changes. Notification delivery via the existing notification service (email/SMS).
  - Priority: `medium`
  - Category: `feature / business intelligence`
  - Impact: Transforms the system from pull-only to push — users get alerted to relevant signals without polling. Core enabler for sales and recruiting workflows.

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

- [x] **Set `ALLOWED_ORIGINS` environment variable on Render** — Fires a warning on every deploy/restart: "ALLOWED_ORIGINS not set - CORS will reject all cross-origin browser requests." While server-to-server webhooks are unaffected, any browser-based API consumers (Swagger UI at `/api/docs`, future dashboards) are blocked by CORS. Set to `https://duxsoup.onrender.com` at minimum.
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

- [x] **Twitter handle normalization** — Twitter field stored as-is from DuxSoup. Could be "@handle", "handle", or "https://twitter.com/handle". Add a `normalizeTwitter()` transform that extracts the bare handle (strip `@` prefix, extract username from URL). Store normalized handle in snapshot, raw value in `_meta`.
  - Priority: `low`
  - Category: `data quality`
  - Impact: Consistent Twitter handle format for downstream integrations.
  - Discovered: 2026-02-11, data cleansing review.

- [x] **URL validation on profile picture, thumbnail, and website fields** — `profilePicture`, `thumbnail`, `personalWebsite`, `companyWebsite` have maxlength constraints but no URL format validation. Non-URLs are accepted silently. Add a lightweight URL validation guard (check for `http`/`https` scheme) similar to the existing guard in `normalizeUrl()`. Log invalid values as warnings, store null instead.
  - Priority: `low`
  - Category: `data quality`
  - Impact: Prevents non-URL strings from polluting snapshot fields used by downstream consumers.
  - Discovered: 2026-02-11, data cleansing review.

- [ ] **Strip HTML tags from summary and description fields** — `summary` (up to 5000 chars) and role `description` fields are stored without any HTML tag stripping. LinkedIn data occasionally includes HTML artifacts from scraping. Add a `stripHtmlTags()` utility (simple regex: `/<[^>]*>/g`) applied to summary and role description fields during snapshot upsert.
  - Priority: `low`
  - Category: `data quality`
  - Impact: Cleaner text fields for display and search. Mitigates potential XSS if data is rendered in a browser.
  - Discovered: 2026-02-11, data cleansing review.

- [ ] **Industry field standardization** — `industry` is a free-form string. "Information Technology", "IT", "information technology", "Technology" all refer to similar categories. Create an industry normalization map (similar to `US_STATES` in location-parser) mapping common variations to canonical LinkedIn industry values. Store original in `_meta`, normalized value in snapshot. Include a backfill script.
  - Priority: `low`
  - Category: `data quality`
  - Impact: Enables reliable industry-based filtering, faceting, and analytics.
  - Discovered: 2026-02-11, data cleansing review.

- [x] **Expand health endpoint test coverage** — Only `healthController.cache.test.js` and `healthController.dataQuality.test.js` exist. Missing tests for `/api/health/dashboard`, `/api/health/parity`, `/api/health/coverage-breakdown`, `/api/health/metrics`, and other health routes.
  - Priority: `low`
  - Category: `testing`
  - Impact: Catches regressions in health monitoring endpoints.

- [x] **Add export stream integration tests** — Export service has unit tests but no integration tests verifying cursor -> transform -> file pipeline with real MongoDB data. Should test CSV/JSON generation end-to-end, row limits, empty results, and error handling during streaming.
  - Priority: `low`
  - Category: `testing`
  - Impact: Validates export pipeline with real database interactions.

- [ ] **Add query/search integration tests** — `queryBuilder.test.js` covers unit logic but complex MongoDB aggregations (text search with facets, seniority filtering, pagination) lack integration-level validation against a real database.
  - Priority: `low`
  - Category: `testing`
  - Impact: Catches aggregation pipeline regressions.

- [ ] **Network proximity and relationship mapping** — Surface connection-degree data and shared attributes (same company history, same school, shared skills) between people in the dataset. `GET /api/people/:id/network` returning 1st-degree connections (from LinkedIn degree field), people with overlapping company tenures, and alumni connections. No new data collection — derived from existing roles, education, and degree fields across the people collection.
  - Priority: `low`
  - Category: `feature / business intelligence`
  - Impact: Enables warm-intro discovery and relationship mapping for sales outreach. Leverages existing data relationships that are currently invisible.

- [x] **Update mongoose 9.1.6 -> 9.2.0** — Minor patch available. Run `npm update mongoose` and verify all tests pass.
  - Priority: `low`
  - Category: `deps`
  - Impact: Bug fixes, minor improvements.

- [x] **Update nodemailer 8.0.0 -> 8.0.1** — Patch available (was previously bumped via Dependabot PR #80 but lockfile may have drifted).
  - Priority: `low`
  - Category: `deps`
  - Impact: Bug fixes.


- [x] **Add error classification to dead letter records** — Dead letters store the raw error message but don't categorize errors. Adding a `errorClass` field (`transient` vs `permanent`) would enable smarter replay (skip `ValidationError` patterns, only retry transient failures like timeouts/connection errors) and better monitoring of true failure rates vs known-bad data.
  - Priority: `low`
  - Category: `reliability`
  - Impact: Smarter dead letter replay, cleaner error metrics.
  - Discovered: 2026-02-10, Render log review.


---

## Recommendations

> New items to consider. Move to Active Sprint when prioritized.

- [ ] **Snapshot versioning with lightweight change timeline API** — Person and company snapshots are mutated in-place with no version history. Add versioning to enable historical analysis and easier debugging of precedence behavior. Could be implemented as a separate `PersonHistory` collection with snapshot-per-observation or periodic snapshots, plus a timeline query API.
  - Priority: `low`
  - Category: `feature`
  - Impact: Enables temporal queries ("who changed jobs in Q1"), audit trails, rollback of bad data, and precedence debugging.

- [ ] **Structured log forwarding to external aggregation** — Logs are well-structured JSON but there's no external aggregation beyond Render's 30-day window. Consider forwarding to a log aggregation service (Datadog, Logtail, Betterstack) for alerts, dashboards, and historical analysis.
  - Priority: `low`
  - Category: `observability`
  - Impact: Persistent log history, real-time alerting on error spikes, operational dashboards beyond Render's built-in viewer.

- [x] **Webhook replay from dead letters should also upsert company/location** — When `replayDeadLetters.js` replays a failed observation, it calls `upsertFromObservation()` for the person but does not replay `upsertCompanyFromObservation()` or `upsertLocationFromObservation()`. If the original Phase 2 company/location upsert also failed, replay won't recover those entities.
  - Priority: `medium`
  - Category: `feature`
  - Impact: Complete recovery of all entity types during dead letter replay.


- [ ] **Add webhook delivery acknowledgment/retry protocol** — DuxSoup fires webhooks without delivery guarantees. If the server returns 5xx or times out, DuxSoup may not retry. Consider adding a webhook receipt log and a reconciliation job that compares DuxSoup's expected delivery count against received webhooks.
  - Priority: `low`
  - Category: `reliability`
  - Impact: Detects silent webhook data loss.


- [ ] **Person merge REST endpoint** — Merging people currently requires admin scripts or direct DB access. A `POST /api/admin/merge` endpoint would enable ops workflows without SSH. Should support dry-run mode and safety validation.
  - Priority: `medium`
  - Category: `feature`
  - Impact: Enables merge operations through the API.

- [ ] **GraphQL read layer pilot for composite profile views** — As the read API surface grows (people, companies, locations, changes, seniority), a GraphQL layer could reduce over-fetching and simplify client integrations. Useful once REST read complexity materially increases for consumers. Would sit alongside REST, not replace it.
  - Priority: `low`
  - Category: `feature`
  - Impact: Flexible querying for frontend/integration consumers.

- [ ] **Idempotency hash migration plan (SHA-1 to SHA-256) with dual-write period** — `event_key` is computed with SHA1 (`src/utils/eventKey.js`), which is cryptographically weak. Current use is non-crypto-critical, but migration improves long-term robustness. Plan a dual-write period where both hashes are checked for deduplication before fully cutting over.
  - Priority: `low`
  - Category: `security hardening`
  - Impact: Stronger collision resistance for idempotency keys with zero-downtime migration.

---

## Recommended Next-Sprint Pack

> If capacity is limited, execute this 5-item pack first. This mix delivers the highest-ROI data quality improvements alongside operational reliability.

1. ~~**Replay parity test + fix**~~ — Done (2026-02-11).
2. ~~**OpenAPI drift test gate**~~ — Done (2026-02-11).
3. ~~**Trim and collapse whitespace on all snapshot string fields**~~ — Done (2026-02-11).
4. ~~**Case-insensitive skill dedup + email normalization**~~ — Done (2026-02-11).
5. ~~**Data cleanliness metrics endpoint**~~ — Done (2026-02-11).

---

## Icebox

- ~~**IP allowlisting for webhook endpoint**~~ — Removed from active sprint. DuxSoup does not publish stable outbound IPs, making a static allowlist impractical. The endpoint is already defended by rate limiting (100/min), input validation, idempotency (event_key SHA1), and CORS. Revisit only if DuxSoup publishes IP ranges.

---

## Completed

- [x] **URL validation on profile picture, thumbnail, and website fields** — 2026-02-25. Created `src/utils/urlValidator.js` with `validateUrl()` (checks for `http://`/`https://` scheme, case-insensitive; logs warning for invalid values, returns null) and `validateAndEnsureHttps()` (composes validation with `ensureHttps()` upgrade). Replaced `ensureHttps` transform on 5 Person `FIELD_MAPPINGS` URL fields (`profilePicture`, `thumbnail`, `personalWebsite`, `companyWebsite`, `currentCompanyProfile`) and 2 Company controller URL fields (`website`, `companyProfileUrl`) with `validateAndEnsureHttps`. Non-URL strings (bare domains, plain text, ftp://) now rejected with warning and stored as null instead of being silently accepted. 36 new validator tests + 4 personController tests + 2 companyController tests. All 1,679 tests pass.
- [x] **Cap or replace unbounded observation reference arrays** — 2026-02-12. Introduced `MAX_OBSERVATION_REFS` constant (default 100, env-configurable) in `src/constants/limits.js`. Updated Person, Company, and Location controllers to use `$push` + `$slice: -MAX_OBSERVATION_REFS` for atomic capping during webhook upserts. Updated `identityResolverService.js` to cap merged observation arrays. Updated 4 legacy import scripts (`import-csv-visits.js`, `import-historical-csv.js`, `link-orphaned-observations.js`, `migrate-url-to-stable-ids.js`) to enforce the same cap. Created `scripts/backfillObservationCap.js` to trim existing oversized arrays. 19 new tests in `observationRefCapping.test.js`. All tests pass.
- [x] **Enrichment gap analysis report** — 2026-02-12. Added `GET /api/insights/enrichment-gaps` gap analysis dashboard and `GET /api/insights/enrichment-gaps/revisit-list` prioritized revisit list. Gap analysis runs aggregation pipeline computing per-field missing counts/percentages for 8 weighted fields (email 30, phone 20, currentCompanyId 15, roles 15, education 10, skills 5, industry 3, location 2), with seniority-tier breakdown. Revisit list scores each person by gap severity (0-100) + contact value (seniority 0-50, recency 0-30, connections 0-20) = priority score (0-200), returns CSV (DuxSoup-compatible, default) or JSON. Supports filters: seniority, minRank, company, companyId, fields. Gap dashboard cached 10 min via `metricsCache`. Created `enrichmentGapService.js` (scoring, aggregation), `enrichmentGapController.js` (HTTP handlers), `insightsRoutes.js` (Express router). Exported `escapeCsvField` from `exportService.js`. Added `Insights` tag + 2 endpoint specs to OpenAPI. Added `insights` probe to conformance test. 62 new tests (47 service + 15 controller). All 1,449 tests pass.
- [x] **Twitter handle normalization** — 2026-02-24. Created `src/utils/twitterNormalizer.js` with `normalizeTwitter()` that trims, strips `@` prefix, extracts username from twitter.com/x.com URLs, lowercases, and warns on invalid format (non-blocking). Integrated into `personController.js` FIELD_MAPPINGS as transform for twitter field + added twitter to SKIP_CLEAN_FIELDS. Created `scripts/backfillTwitterNormalization.js` with --dry-run/--commit/--limit/--batch-size following backfillPhoneNormalization pattern. Added `backfill:twitter` npm script. 24 normalizer tests + 7 backfill tests.
- [x] **Company name normalization utility** — 2026-02-24. Created `src/utils/companyNormalizer.js` with `normalizeCompanyName()` that trims, collapses whitespace, and strips trailing legal suffixes (Inc., LLC, Ltd., Corp., GmbH, AG, S.A., B.V., etc.) via precompiled case-insensitive regex. Handles comma-separated suffixes (", Inc.") and "& Co." patterns. Preserves original casing. Integrated into `personController.js` (FIELD_MAPPINGS transform for currentCompany + SKIP_CLEAN_FIELDS, normalizeCompanyName for role companyName in updateRolesTimeline), `companyController.js` (snapshot name field), and `identityMatcher.js` (company name alias in resolveCompanyIdentity). Created `scripts/backfillCompanyNames.js` with 3 passes: Person currentCompany, Person roles[].companyName, Company snapshot.name + name aliases. Supports --dry-run/--commit/--limit/--batch-size/--target. 64 new tests. All 1,561 tests pass.
- [x] **Ensure HTTPS protocol on all URL references** — 2026-02-12. Created `src/utils/urlNormalizer.js` with `ensureHttps()` utility that converts `http://` to `https://` and trims whitespace. Applied as transform to 5 URL fields in Person `FIELD_MAPPINGS` (`companyWebsite`, `personalWebsite`, `profilePicture`, `thumbnail`, `currentCompanyProfile`) and 2 fields in Company controller (`website`, `companyProfileUrl`). Created `scripts/backfillHttpsUrls.js` using native driver aggregation pipeline `$replaceOne` for efficient bulk updates of Person `snapshot.companyWebsite` and Company `snapshot.website` (including `_meta` provenance values). Supports `--dry-run` (default) and `--commit` flags. 30 new tests (13 utility, 7 backfill, 8 personController, 2 companyController). All 1,376 tests pass. **Backfill executed against production on 2026-02-12:** 6,513 active Person + 3,347 merged Person + 1,315 Company = 11,175 records updated, 0 remaining `http://` URLs.
- [x] **Engagement trigger feed** — 2026-02-12. Added `GET /api/signals/` engagement trigger feed surfacing time-sensitive signals: new roles (90-day buying window), promotions (budget authority shift), lateral moves (new relationship opportunity), and newly observed decision-makers (VP+ rank >= 5). Composite ranking score (0-100) weighted by seniority (40%), recency (35%), and signal type (25%), mapped to high/medium/low priority. Deduplicates new_role + lateral_move at same timestamp (keeps lateral_move as more specific). Each signal includes human-readable `actionContext` string. Supports filters: type, minRank, company, companyId, days (max 180), pagination. Uses `metricsCache` with 5-min TTL and `?fresh=true` bypass. Created `signalFeedService.js` (core query/rank/dedup logic), `signalFeedController.js` (HTTP handler with validation), `signalRoutes.js` (Express router). Added `Signal` schema and `/api/signals` path to OpenAPI spec. 55 new tests (41 service + 14 controller). All tests pass.
- [x] **Extract shared shouldOverwrite precedence logic** — 2026-02-11. Extracted `shouldOverwrite()` and `SOURCE_PRECEDENCE` from personController, companyController, and locationController into `src/utils/precedence.js`. Fixes latent NaN bug in company/location controllers (missing `isNaN()` guard). Created 20 dedicated unit tests in `__tests__/precedence.test.js`. Removed duplicated tests from `personController.test.js`. All 1,291 tests pass.
- [x] **Comprehensive person data quality backfill + data model fixes** — 2026-02-12. Created `scripts/backfillPersonDataQuality.js` applying 9 data quality improvements (whitespace, email, phone, skills, education, location, US regions, seniority, derived metrics) to existing person records in a single pass. Fixed 3 critical data model issues: removed destructive TTL index on Change model `recentJobChangeExpiresAt` that was deleting audit records after 90 days, added missing `CompanyID` field to Visit model/controller, added missing `region` field to Company model/controller. Added `parsedSeniority` index to Person model for seniority API query performance. 50 new tests. All 1,254 tests pass. **Backfill executed against production on 2026-02-12:** 23,654 people processed, 23,255 updated (98.3%), 0 errors. Changes: 75,177 derived metrics, 71,183 location fields, 32,671 seniority/department, 18,005 whitespace, 5,480 education dedup, 5,080 phone normalization, 205 email normalization, 200 skill dedup.
- [x] **Company intelligence rollup API** — 2026-02-11. Added `GET /api/companies/:id/intelligence` aggregating all people linked to a company into org-level insights. Runs 9 parallel queries via `Promise.all()`: company doc, seniority distribution, department distribution, decision makers (VP+ rank >= 5, top 10), tenure stats (avg/median), geography (top 20 city/country), recent hires/departures (6-month window from Change collection), and hiring velocity (monthly new people with trend detection). Created `companyIntelligenceService.js` (core aggregation with `calculateMedian()` and `determineTrend()` helpers), `companyIntelligenceController.js` (HTTP handler with `metricsCache` 5-min TTL, `?fresh=true` bypass). Added `snapshot.currentCompanyId` index to Person model, `toCompanyId`/`fromCompanyId` compound indexes to Change model. Added OpenAPI spec. 28 new tests (18 service + 10 controller).
- [x] **Person activity timeline API** — 2026-02-11. Added `GET /api/people/:id/timeline` returning a chronological feed of all visits, scans, changes (company_change, promotion, title_change, lateral_move), and a synthetic `first_seen` event for a person. Supports `limit` (default 50, max 500), `offset`, `from`/`to` ISO date range filters. In-memory merge of Visit, Scan, and Change collections via parallel queries with `.lean()` and `.select()` for minimal payload. Created `timelineService.js` (core merge/sort/filter/paginate logic), `timelineController.js` (HTTP handler with validation), registered route in `apiRoutes.js` with `readRateLimiter`, added OpenAPI spec. 24 new tests (16 service + 8 controller). All 1,204 tests pass.
- [x] **Categorize US regions on all location-bearing collections** — 2026-02-11. Created `src/utils/us-regions.js` mapping all 50 US states + DC to region (Northeast/Midwest/Southeast/Southwest/West), subregion (New England, Mid-Atlantic, East North Central, West North Central, Lower South, Upper South, Delta, Four Corners, Southern Plains, Great Basin, Pacific, Mountain), IANA timezone, and UTC offset. Integrated into `location-parser.js` via `enrichWithUSRegion()` — every parsed US location now includes `usRegion`, `usSubregion`, `timezone`, `utcOffset`. Added 4 new fields to Person, Location, and Company models. Updated `personController.js` LOCATION_FIELDS, `locationController.js` snapshot fields, and `companyController.js` (now parses location and populates structured location + region fields with provenance tracking). 65 new unit tests for US regions utility. All 1,108 tests pass.
- [x] **Phone number normalization** — 2026-02-11. Added `normalizePhone()` utility using `libphonenumber-js/min` to normalize phone numbers to E.164 format (`+15551234567`). Integrated as a `transform` on the FIELD_MAPPINGS phone entry, with phone added to `SKIP_CLEAN_FIELDS`. Added phone format metrics to `GET /api/health/data-cleanliness` (6th pipeline counting non-E.164 phones). Created `scripts/backfillPhoneNormalization.js` with `--dry-run`/`--commit` modes, uses person's `countryCode` as default country. Updated OpenAPI spec, FIELD_REFERENCE.md, and package.json. 37 new tests (26 normalizer, 4 personController, 1 healthController, 7 backfill script).
- [x] **Data cleanliness metrics endpoint** — 2026-02-11. Added `GET /api/health/data-cleanliness` with 5 parallel aggregation pipelines measuring whitespace issues (sampled 1000 records), invalid emails (RFC 5322 basic check), case-insensitive skill duplicates, case-insensitive education duplicates, and missing key fields (email, phone, currentTitle). Uses `metricsCache` with 10-minute TTL. Registered in `apiRoutes.js` with `readRateLimiter`, added OpenAPI spec. 5 new tests. All 1077 tests pass.
- [x] **Case-insensitive skill deduplication** — 2026-02-11. Updated `updateSkills()` in `personController.js` to use `.toLowerCase().trim()` normalization for comparison while preserving first-seen casing. Incoming skills are cleaned via `cleanString()` before storage. Null/empty skills after cleaning are skipped. 5 new tests. All 1077 tests pass.
- [x] **Case-insensitive education deduplication** — 2026-02-11. Updated `updateEducation()` in `personController.js` to use `.toLowerCase()` comparison for school, degree, and field. Education values are cleaned via `cleanString(coerceToString(...))` before storage and comparison. 3 new tests. All 1077 tests pass.
- [x] **Normalize email addresses on person snapshot** — 2026-02-11. Added `normalizeEmail()` function to `personController.js`: `trim().toLowerCase()` with warn-only RFC 5322 basic regex check. Integrated as `transform` on the email FIELD_MAPPINGS entry. Email field added to `SKIP_CLEAN_FIELDS` since it has its own transform. 6 new tests. All 1077 tests pass.
- [x] **Trim and collapse whitespace on all snapshot string fields** — 2026-02-11. Added `cleanString()` helper (`trim()` + `replace(/\s+/g, ' ')`) and `SKIP_CLEAN_FIELDS` set (URL/ID/email fields). Applied in FIELD_MAPPINGS loop after transform and before normalizeField. Also applied `cleanString()` to role fields (title, company, location, description) in both extended positions and single current-role paths of `updateRolesTimeline()`. Education fields cleaned via `cleanString(coerceToString(...))`. 16 new tests. All 1077 tests pass.
- [x] **Add export stream integration tests** — 2026-02-11, commit `025a754`. Added 20 integration tests in `src/__tests__/exportStream.integration.test.js` covering the full export streaming pipeline (MongoDB cursor → Transform → file) against a real database. Tests cover: people/company/location CSV and JSON exports (6), empty results (2), filters (2), custom field subsets (1), CSV escaping and data integrity (4), row limit enforcement via `jest.isolateModulesAsync` (1), job lifecycle (3), and error handling (1). All 20 tests pass.
- [x] **Webhook replay from dead letters should also upsert company/location** — 2026-02-11. After person replay succeeds, `replayDeadLetters.js` now also calls `upsertCompanyFromObservation()` and `upsertLocationFromObservation()` as best-effort (failures logged, don't affect dead letter status). Same pattern added to `replayController.js` admin endpoint (`POST /api/admin/replay/:observationId`), which now returns `company_replayed` and `location_replayed` booleans. Company/location are NOT attempted if person fails. Stats report includes 4 new counters (companySucceeded/Failed, locationSucceeded/Failed). 18 new tests (10 replay script + 8 controller). All 1043 tests pass.
- [x] **Add route-to-OpenAPI conformance tests in CI (hard failure on drift)** — 2026-02-11. Created `__tests__/openapiConformance.test.js` with 3 assertions: no phantom docs (OpenAPI routes must exist in Express), no undocumented routes (Express routes must exist in OpenAPI, minus exclusions), and no stale exclusions. Route extraction handles Express 5 matcher-function internals via path probing. Added 9 missing routes to `src/openapi.js`: `POST /api/webhook/batch`, `GET /api/health/throughput`, `GET /api/health/test-notifications`, `POST /api/admin/test-notifications`, `POST /api/people/by-aliases`, and 4 company/location export endpoints. All 1025 tests pass.
- [x] **Add error classification to dead letter records** — 2026-02-11. Created `src/utils/errorClassifier.js` extracting 7 permanent error patterns into a shared utility. Added `errorClass` field (`transient`/`permanent`) to DeadLetter model. `createFromFailure()` classifies at creation time. `markReplayFailed()` fast-tracks permanent errors to `permanently_failed` (skips remaining retries). `findEligibleForReplay()`/`countEligibleForReplay()` exclude permanent records via `$ne: 'permanent'` (backward-compatible with legacy records missing the field). Updated `purgeStuckDeadLetters.js` to use shared classifier and set `errorClass: 'permanent'`. Updated `resurrectDeadLetters.js` to set `errorClass: 'transient'`. Added `permanentPendingDeadLetters` metric to health check. 22 new tests. All 1022 tests pass.
- [x] **Expand health endpoint test coverage** — 2026-02-11. Added 43 unit tests in `healthController.endpoints.test.js` covering 9 previously-untested endpoints: `getIngestionHealth` (business logic), `getParityHealth`, `getCoverageBreakdown`, `getCompanyCoverage`, `getLocationCoverage`, `getMetrics`, `getDataQuality`, `getDashboard`, `testNotifications`. Tests cover success paths, error handling (500), edge cases (zero records), status thresholds (healthy/degraded/unhealthy), cutover gate logic, and recommendation generation. All 1000 tests pass.
- [x] **Update mongoose 9.1.6 -> 9.2.0** — 2026-02-11. Bumped mongoose from 9.1.6 to 9.2.0 via `npm update mongoose`. All 1000 unit tests pass, no breaking changes.
- [x] **Update nodemailer 8.0.0 -> 8.0.1** — 2026-02-11. Already at 8.0.1 in lockfile — no changes needed. Verified installed version matches package.json spec.
- [x] **Set `ALLOWED_ORIGINS` environment variable on Render** — 2026-02-10. Set `ALLOWED_ORIGINS=https://duxsoup.onrender.com` via Render MCP env var update (merge mode). Eliminates startup CORS warning, enables browser-based access to Swagger UI at `/api/docs`. No code changes — config-only.
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
