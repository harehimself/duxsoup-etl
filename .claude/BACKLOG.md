# Project Backlog

> Canonical list of planned work for the DuxSoup ETL system.
>
> **Agents:** Read this file at session start for project context. Check items off as
> you complete them, then move them to the Completed section with a date and commit/PR ref.
> If new work is discovered during a session, add it to the appropriate priority tier.

---

## Active Sprint

### Medium Priority

- [ ] **Fix stale parsedSeniority/parsedDepartment on title changes** — When a person's title changes from a parsable role to one that doesn't match any patterns, the old `parsedSeniority`/`parsedDepartment` values remain in the snapshot because `normalizeField` is only called when `parseTitle` returns non-null. Additionally, `normalizeField` itself refuses to overwrite with null (via `shouldOverwrite`), so the fix must directly clear these derived fields and their `_meta` entries when the parser returns no match.
  - Category: `bug`
  - Files: `src/controllers/personController.js:463-482`
  - Context: These are derived (not observed) fields — the "never overwrite with empty" rule designed for observed data should not apply. Stale classifications will skew downstream filters/analytics that rely on `parsedSeniority` or `parsedDepartment`.
  - Acceptance: When `parseTitle` returns null for seniority or department, the corresponding snapshot field is set to `null` and `_meta` is updated. Unit test confirms clearing behavior when title changes from parsable to unparsable.

- [ ] **Fix undefined pagination fields in fuzzy search fallback** — When text search finds no results and `smartSearch` falls back to `fuzzySearchPeople`, the metadata lacks `limit`, `totalCount`, `hasMore`, and `nextSkip`. The search controller reads these fields unconditionally, producing a pagination envelope with `undefined` values.
  - Category: `bug`
  - Files: `src/services/searchService.js:139-147`, `src/controllers/searchController.js:47-54`
  - Context: Breaks the standardized pagination contract for any query that only matches via fuzzy search. Clients relying on `hasMore` or `nextSkip` for pagination will mis-handle the response.
  - Acceptance: `fuzzySearchPeople` returns `limit`, `totalCount`, `hasMore`, and `nextSkip` in its metadata. Alternatively, the controller computes them from the request/response. Unit test covers the fuzzy fallback pagination envelope.

- [ ] **Birthday field: reject year-less date strings** — `parseSafeDate("March 14")` silently returns `2001-03-14` because Node's `new Date()` defaults missing years to 2001. LinkedIn commonly shows birthdays without a year.
  - Category: `data-quality`
  - Files: `src/controllers/personController.js:437`, `src/utils/date-parser.js`
  - Context: The `parseSafeDate` utility has no awareness of year-less inputs. When the webhook `Birthday` field contains "March 14" or similar, Node produces a valid Date with a fabricated 2001 year, which gets stored in `Person.snapshot.birthday` as if it were a real date.
  - Fix: Add a date-validation guard before `parseSafeDate` (or inside it) that detects inputs without a 4-digit year. For year-less strings, either store `null` (discard) or store as a `birthdayRaw` string field (month/day only) rather than coercing to a full Date. Also consider a migration to null out any existing 2001-year birthdays that lack a real year.
  - Acceptance: Year-less birthday strings (e.g., "March 14", "January 5") do not produce a Date with a fabricated year. Includes unit tests for edge cases. Existing 2001-year birthdays reviewed/corrected.

- [ ] **Fix CLAUDE.md schema + endpoint docs drift** — Align person snapshot example and query/search/export routes with current models and routes
  - Category: `docs`
  - Files: `.claude/CLAUDE.md`, `src/models/person.js`, `src/routes/queryRoutes.js`, `src/routes/searchRoutes.js`, `src/routes/exportRoutes.js`
  - Context: The person model example documents snapshot fields at the top level and lists GET-based query/search/export endpoints that no longer match the implementation. This can mislead users into querying/updating incorrect paths or hitting 404/method errors.
  - Acceptance: Update the Person example to reflect `snapshot`, `snapshot._meta`, and `meta.observationsCount` nesting; correct query/search/export endpoint paths and HTTP verbs.

- [ ] **Sunset hybrid read mode** — Evaluate whether `READ_SOURCE=hybrid` and the legacy personReadService fallback are still needed
  - Category: `tech-debt`
  - Files: `src/services/personReadService.js` (lines 155-179 contain a "simplified example" placeholder)
  - Context: The Person collection should be well-populated by now. If all people have snapshots, hybrid mode adds complexity with no benefit. The legacy read path has a comment acknowledging it's incomplete ("adjust based on your actual legacy structure").
  - Acceptance: Run a coverage query — if >99% of visits/scans have corresponding Person records, remove hybrid mode and delete the legacy fallback code. If gaps exist, backfill first, then remove.

### Low Priority / Tech Debt

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
