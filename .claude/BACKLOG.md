# Project Backlog

> Canonical list of planned work for the DuxSoup ETL system.
>
> **Agents:** Read this file at session start for project context. Check items off as
> you complete them, then move them to the Completed section with a date and commit/PR ref.
> If new work is discovered during a session, add it to the appropriate priority tier.

---

## Active Sprint

### Medium Priority

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

- [ ] **Fix `classifySalesNavId` misclassification in salesNavId audit script** — The `lowercase`/`mixed` branch in `classifySalesNavId()` does not check for a valid ACw/ACo prefix, so IDs with non-standard prefixes (e.g. `ZZZ123`) are misclassified as `lowercase` or `mixed` instead of `nonstandard`
  - Category: `data-quality`
  - Files: `scripts/audit-salesnavid-case.js` (the `classifySalesNavId` function)
  - Context: `normalizeToCanonicalCase()` returns the input unchanged for non-ACw/ACo values. The `hasCanonicalPrefix` check only gates the `'canonical'` return, not the `'lowercase'`/`'mixed'` branch. Fix by adding `&& hasCanonicalPrefix` to the case-insensitive equality check, or by returning `'nonstandard'` early when the prefix is invalid.
  - Acceptance: IDs without ACw/ACo prefixes are classified as `nonstandard`. Audit counts accurately reflect prefix validity. Unit tests cover non-standard prefix inputs.

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
