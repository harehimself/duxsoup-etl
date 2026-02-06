# Project Backlog

> Canonical list of planned work for the DuxSoup ETL system.
>
> **Agents:** Read this file at session start for project context. Check items off as
> you complete them, then move them to the Completed section with a date and commit/PR ref.
> If new work is discovered during a session, add it to the appropriate priority tier.

---

## Active Sprint

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

---

## Recommendations

> New items to consider. Move to Active Sprint when prioritized.

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
