# Project Backlog

> Canonical list of planned work for the DuxSoup ETL system.
>
> **Agents:** Read this file at session start for project context. Check items off as
> you complete them, then move them to the Completed section with a date and commit/PR ref.
> If new work is discovered during a session, add it to the appropriate priority tier.

---

## Active Sprint

### High Priority

- [x] **Leader-election for multi-instance scheduler** — Prevent duplicate cron jobs (dead-letter replay, health checks) when running multiple instances behind a load balancer
  - Category: `infra`
  - Files: `src/workers/scheduler.js`
  - Completed: 2026-02-05

- [ ] **IP allowlisting for webhook endpoint** — Restrict `POST /api/webhook` to known DuxSoup outbound IPs
  - Category: `security`
  - Files: `src/routes/apiRoutes.js`, new middleware
  - Context: CLAUDE.md notes this as a recommended hardening step. Currently the endpoint relies on rate limiting + validation + idempotency only.
  - Acceptance: Configurable allowlist via `WEBHOOK_IP_ALLOWLIST` env var (comma-separated CIDRs). Falls back to open (allow-all) if env var is unset. Requests from non-allowed IPs return 403. Includes tests.

### Medium Priority

- [ ] **CSV enrichment creation logic** — Create new person records when enrichment CSV contains people not yet in the database
  - Category: `enrichment`
  - Files: `scripts/importCsvEnrichment.js:461`, `src/controllers/personController.js`
  - Context: Current code only enriches existing records; the else-branch logs "would create" but never writes.
  - Ref: `// TODO(enrichment): Implement creation logic if needed`
  - Acceptance: New person records created from CSV data when no alias match is found. Dry-run mode respected. Includes tests.

- [ ] **Deprecate legacy identityResolver.js** — Migrate remaining callers to `identityMatcher.js`
  - Category: `tech-debt`
  - Files: `src/utils/identityResolver.js`, callers
  - Context: Migration note at line 21 says "New code should use identityMatcher.js directly." Need to find remaining callers, migrate them, then remove the legacy file.
  - Acceptance: No imports of `identityResolver.js` remain. File deleted. All identity resolution goes through `identityMatcher.js`. Tests pass.

### Low Priority / Tech Debt

- [ ] **Parallelize CSV enrichment row processing** — Process enrichment rows concurrently for large imports
  - Category: `performance`
  - Files: `scripts/importCsvEnrichment.js:553`
  - Context: Comment notes rows are processed sequentially and "could parallelize later."
  - Acceptance: Configurable concurrency (e.g., `--concurrency=N`, default 1 for backwards compat). Includes progress logging.

- [ ] **Refine legacy personReadService path** — Review and harden the legacy read fallback in hybrid mode
  - Category: `tech-debt`
  - Files: `src/services/personReadService.js:161`
  - Context: Comment notes "This is a simplified example — adjust based on your actual legacy structure."
  - Acceptance: Legacy read path correctly maps all fields from Visit/Scan collections. Includes integration test coverage.

---

## Icebox

<!-- Items parked for later consideration. Move to Active Sprint when ready. -->

---

## Completed

- [x] **Audit and label TODO comments** — 2026-02-04, branch `claude/audit-todo-comments-jrdRA`
- [x] **Graceful shutdown handler (SIGTERM/SIGINT)** — Already implemented in `src/index.js:212-241`
- [x] **Remove webhook auth** — DuxSoup cannot send credentials — `8e9bcb0`
- [x] **Trust proxy for Render** — Correct client IP behind reverse proxy — `288feb5`
- [x] **Query param secret for webhook providers** — `49b7474`
- [x] **Express 5 sanitize compatibility** — PR #57, `79535e9`
- [x] **Remove accumulated bloat** — 65 unused scripts, 38 stale docs — `525d110`
- [x] **Security hardening and test coverage** — `8db738d`
- [x] **Fail-closed webhook auth and admin route protection** — `bbf480d`
