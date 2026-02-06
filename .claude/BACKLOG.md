# Project Backlog

> Canonical list of planned work for the DuxSoup ETL system.
>
> **Agents:** Read this file at session start for project context. Check items off as
> you complete them, then move them to the Completed section with a date and commit/PR ref.
> If new work is discovered during a session, add it to the appropriate priority tier.

---

## Active Sprint

### Medium Priority

- [ ] **Guard `normalizeUrl` against non-URL alias values** — The `normalizeUrl` function in `identityMatcher.js` accepts any string without validating it's a URL. Any backfill or tooling that calls `normalizeUrl` on all alias values (regardless of type) and adds a `profileUrl` alias when the result differs will misclassify non-URL identifiers (e.g., SalesNav IDs, numeric IDs) as `profileUrl`, corrupting alias data and risking incorrect identity merges.
  - Category: `data-integrity`
  - Files: `src/utils/identityMatcher.js:140-160` (`normalizeUrl`), proposed `scripts/backfill-alias-normalization.js`
  - Context: `normalizeUrl` lowercases and strips protocol/query params but never checks for a URL scheme or host. A SalesNav ID like `ACwAAA_TEST123` gets lowercased to `acwaaa_test123`, differs from the original, and would be added as a `profileUrl` alias. The proposed `backfill-alias-normalization.js` loops over ALL alias values and applies `normalizeUrl` indiscriminately, triggering this issue.
  - Fix options: (1) Add URL validation to `normalizeUrl` (check for `linkedin.com` or a scheme), (2) only call `normalizeUrl` on aliases with URL-typed `type` fields (`profileUrl`, `publicUrl`, `recruiterUrl`, `salesUrl`), or (3) rename `normalizeUrl` to clarify its URL-only purpose and add a guard in the backfill script.
  - Acceptance: `normalizeUrl` either validates its input is a URL or the backfill script only normalizes URL-typed aliases. Non-URL identifiers are never reclassified as `profileUrl`. Unit test confirms SalesNav IDs and numeric IDs pass through `normalizeUrl` unchanged (or are rejected).

- [ ] **CSV enrichment: create new person records** — Implement the stubbed-out creation path in the enrichment import script
  - Category: `enrichment`
  - Files: `scripts/importCsvEnrichment.js:461`
  - Context: The else-branch increments `stats.created` and logs "Would create new person from CSV" but never writes to the database. The `// TODO(enrichment): Implement creation logic if needed` is the only explicit TODO remaining in the codebase.
  - Acceptance: New Person records created from CSV rows when no alias match exists. Respects `--dry-run`. Populates aliases, _meta provenance, and canonical_id. Includes unit tests.

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
