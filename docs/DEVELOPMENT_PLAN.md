# Development Plan — DuxSoup ETL

> Actionable task breakdown for the next set of improvements.
> Each item includes files to modify, specific subtasks, and acceptance criteria.
>
> **Last Updated:** February 1, 2026

---

## 1. Stop New Duplicate People (Cross-Link Aliases at Ingestion)

**Goal:** When a webhook arrives with a Sales Nav ID but no public URL (or vice versa), the system should still find and match an existing person who was previously created from the other identifier type. Today the identity resolver extracts identifiers and builds aliases, but `identityResolverService.resolveOrCreate()` only matches aliases that are _already stored_ on the person document. If a visit creates a person with `salesNavId` and a scan arrives later with only a `profileUrl` for the same human, no alias overlap exists and a duplicate is created.

### Subtasks

- [ ] **1.1 — Extract username from public profile URL and add as `linkedInUsername` alias during resolution**
  - File: `src/utils/identityResolver.js` → `resolvePersonIdentity()`
  - Currently, `identityMatcher.extractLinkedInUsername()` is called and the result is added as an alias at line 278-280. Verify this path works for _all_ URL shapes coming from DuxSoup (Profile, PublicProfile, SalesProfile fields). The existing `extractLinkedInUsername()` in `identityMatcher.js` already parses `/in/<username>` from Profile, PublicProfile, SalesProfile, and RecruiterProfile fields — confirm this covers scan payloads where the field name may be nested under `data.`.
  - Add a unit test for a scan payload that has only `data.Profile` (no `SalesProfile`) to confirm username extraction works.

- [ ] **1.2 — Derive `linkedInUsername` from `vanityName` when username extraction fails**
  - File: `src/utils/identityResolver.js` → `resolvePersonIdentity()` (around line 278)
  - If `identifiers.linkedInUsername` is null but `identifiers.vanityName` is present, add the vanityName value as a `linkedInUsername` alias (they are the same string, just extracted differently). This ensures that people created via vanityName extraction can be found by username-based lookups.
  - Add test: vanityName `"mike-hare"` should produce `linkedInUsername` alias `"mike-hare"`.

- [ ] **1.3 — Ensure `identityResolverService.findByAnyAlias()` matches `linkedInUsername` ↔ `vanityName` cross-type**
  - File: `src/services/identityResolverService.js` → `findByAnyAlias()`
  - Currently, alias matching is exact on `value`. Since linkedInUsername and vanityName produce the same lowercase slug, they will match by value. Verify this with a test: create a person with alias `{ type: 'vanityName', value: 'mike-hare' }`, then search with alias `{ type: 'linkedInUsername', value: 'mike-hare' }`. The match should succeed because `findByAnyAlias()` line 62 uses `$in` on `aliases.value`.
  - If the match fails (because of type-specific query branches), add vanityName values to the `otherAliases` query bucket.

- [ ] **1.4 — Add integration test: visit-then-scan for same person produces one record**
  - File: new `__tests__/integration/duplicatePrevention.test.js`
  - Test scenario: (1) Process a visit webhook with `SalesProfile` containing a Sales Nav ID and `Profile` containing `/in/mike-hare`. (2) Process a scan webhook with `Profile` containing `/in/mike-hare` but no `SalesProfile`. (3) Assert that only one Person document exists and it has both `salesNavId` and `linkedInUsername` aliases.

- [ ] **1.5 — Add integration test: scan-then-visit for same person produces one record**
  - Same file as 1.4, reversed order. The scan creates the person first with only `linkedInUsername`; the visit arrives with `salesNavId` and must match.

### Acceptance Criteria

- Two webhook payloads for the same human (one visit with Sales Nav ID, one scan with profile URL) produce exactly one Person document.
- The resulting Person has aliases covering both identifier types.
- Existing tests continue to pass (`npm test`).

---

## 2. Add Helmet for Security Headers

**Goal:** Add standard HTTP security headers (X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, etc.) to all responses.

### Subtasks

- [ ] **2.1 — Install helmet**
  - Command: `npm install helmet`

- [ ] **2.2 — Add helmet middleware to Express app**
  - File: `src/index.js`
  - Add `const helmet = require('helmet');` at top with other imports (after line 2).
  - Add `app.use(helmet());` immediately after `const app = express();` (after line 19), before CORS middleware.

- [ ] **2.3 — Verify health endpoint still works**
  - Run: `curl -I http://localhost:3000/health` and confirm security headers are present in response.
  - Confirm the health check still returns 200.

### Acceptance Criteria

- Response headers include `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`, etc.
- No functional regression on existing endpoints.

---

## 3. Global Error Handler Middleware

**Goal:** Add a catch-all Express error handler so unhandled errors return structured JSON instead of stack traces, and the process doesn't crash.

### Subtasks

- [ ] **3.1 — Add error handler middleware after all route mounts**
  - File: `src/index.js`
  - After line 80 (`app.use("/api", apiRoutes);`) and after the health/root route definitions (~line 107), add an Express 4/5 error handler (4-arg middleware):
    ```js
    app.use((err, req, res, _next) => {
      logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
      });

      const status = err.status || err.statusCode || 500;
      const response = {
        success: false,
        error: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : err.message,
      };

      res.status(status).json(response);
    });
    ```

- [ ] **3.2 — Add a unit test confirming error handler catches thrown errors**
  - File: new `__tests__/middleware/errorHandler.test.js`
  - Use supertest to hit a route that throws, confirm 500 + structured JSON response.
  - Confirm stack trace is not exposed when `NODE_ENV=production`.

### Acceptance Criteria

- Any unhandled throw in a route handler returns `{ success: false, error: "INTERNAL_ERROR", message: "..." }` with status 500.
- Stack traces are hidden in production.
- Existing tests pass.

---

## 4. Document Webhook Payload Variations

**Goal:** Create a single canonical reference for the field differences between visit and scan webhook payloads.

### Subtasks

- [x] **4.1 — Audit actual webhook fields**
  - Read `src/controllers/visitController.js` → `dataMapper` to list all visit fields.
  - Read `src/controllers/scanController.js` → `dataMapper` to list all scan fields.
  - Read `src/utils/validation.js` → `validateWebhookPayload` to list required vs optional fields per type.
  - Cross-reference with `src/models/visit.js` and `src/models/scan.js` schemas.

- [x] **4.2 — Write the reference document**
  - File: new `docs/WEBHOOK_PAYLOADS.md`
  - Structure:
    - **Payload envelope:** `{ userid, type, time, id, data: { ... } }`
    - **Visit-specific fields table:** field name, type, required/optional, example value, notes
    - **Scan-specific fields table:** same structure
    - **URL fields section:** which fields contain profile URLs, which contain Sales Nav URLs, what formats to expect
    - **Identity fields section:** how `id`, `Profile`, `SalesProfile`, `PublicProfile`, `RecruiterProfile` differ between visit and scan
    - **Extended data section:** `extended.positions`, `extended.schools`, `extended.skills` — when present vs absent

- [x] **4.3 — Cross-link from CLAUDE.md and TODO.md**
  - Cross-linked from `README.md` Operations section.

### Acceptance Criteria

- A developer reading `docs/WEBHOOK_PAYLOADS.md` can determine exactly which fields to expect for any webhook type without reading source code.

---

## 5. Create Operational Runbook

**Goal:** Provide a guide for the 80+ scripts in `scripts/`, documenting when to run them, with what flags, what output to expect, and how to roll back.

### Subtasks

- [x] **5.1 — Inventory and categorize scripts**
  - Group into categories: Analysis/Diagnostics, Backfills, Migrations, Cleanup/Dedupe, Imports, Index Management, Investigations.
  - For each, note: filename, purpose, flags (`--dry-run`, `--execute`, `--limit`), dependencies (requires DB connection, specific env vars).

- [x] **5.2 — Write the runbook**
  - File: new `docs/RUNBOOK.md`
  - Sections:
    - **Prerequisites:** environment variables, DB access, backup recommendations
    - **Common Operations:** table of script → purpose → command → expected output
    - **Safe Defaults:** all scripts default to `--dry-run`; document the flag to execute for real
    - **Rollback Guidance:** for each destructive operation (merge, migrate, delete), document how to reverse or recover
    - **Monitoring During Scripts:** how to watch logs, what counts to check before/after

- [x] **5.3 — Cross-link from README.md and TODO.md**

### Acceptance Criteria

- An operator unfamiliar with the codebase can safely run any common maintenance task by following the runbook.

---

## 6. Enable Linting in CI

**Goal:** Uncomment and activate the lint step in GitHub Actions so code style is enforced on every push/PR.

### Subtasks

- [ ] **6.1 — Create ESLint configuration file**
  - No `.eslintrc.*` or `eslint.config.*` exists. ESLint 9 uses flat config.
  - File: new `eslint.config.js`
  - Start with a minimal config: `@eslint/js` recommended rules, Node.js globals, ignore `node_modules/` and `scripts/` (scripts are one-off and would produce too many warnings to fix in this pass).

- [ ] **6.2 — Add lint script to package.json**
  - File: `package.json`
  - Add: `"lint": "eslint src/ __tests__/"` to the `scripts` section.

- [ ] **6.3 — Run lint locally and fix critical errors**
  - Command: `npm run lint`
  - Fix any errors that would block CI (unused vars in prod code, missing imports, etc.). Warnings are acceptable for now.

- [ ] **6.4 — Update CI workflow**
  - File: `.github/workflows/main.yml`
  - Replace lines 35-40 with:
    ```yaml
    - name: Run linting
      run: npm run lint
    ```

- [ ] **6.5 — Verify CI passes on a test branch**
  - Push to a feature branch, confirm the Actions workflow completes green.

### Acceptance Criteria

- `npm run lint` runs without errors on `src/` and `__tests__/`.
- GitHub Actions CI enforces linting on every push to main/master and on PRs.

---

## 7. Execute Duplicate Person Merge

**Goal:** Clean up the 9,587 existing duplicate person records (40% of the database).

### Subtasks

- [ ] **7.1 — Dry-run the existing merge script**
  - Command: `node scripts/merge-duplicates.js --dry-run`
  - Capture output: number of candidate pairs, proposed winners, proposed losers.
  - Review a sample of 20 candidate pairs manually to validate winner selection.

- [ ] **7.2 — Export candidate pairs to CSV for review**
  - If the script doesn't already produce CSV, add a `--output-csv` flag that writes `merge-candidates.csv` with columns: `winner_id`, `loser_id`, `winner_aliases`, `loser_aliases`, `match_reason`.
  - Review the CSV. Flag any pairs where the match looks incorrect (e.g., different actual people sharing a generic username).

- [ ] **7.3 — Run merge on a small batch first**
  - Command: `node scripts/merge-duplicates.js --execute --limit 50`
  - Verify: merged documents have combined aliases, observations, roles, education, skills.
  - Verify: loser documents are deleted.
  - Verify: Merge audit records exist in the `merges` collection.
  - Spot-check 5 merged people in the DB.

- [ ] **7.4 — Run full merge**
  - Command: `node scripts/merge-duplicates.js --execute`
  - Monitor: log output, error count, final merged/skipped/failed counts.

- [ ] **7.5 — Post-merge validation**
  - Run: `node scripts/analyze-duplicates.js` — confirm duplicate count is near zero.
  - Run: `GET /api/health/metrics` — confirm person count is reduced by ~9,587.
  - Check `merges` collection for audit trail completeness.

### Acceptance Criteria

- Duplicate person count drops from ~9,587 to <100 (some edge cases may remain).
- Every merge has an audit record in the `merges` collection.
- No data loss: all aliases, observations, roles, education, and skills from losers are preserved on winners.

---

## 8. Link Orphaned Observations to Canonical People

**Goal:** Attach 6,886 unreferenced observations (visits/scans not linked to any Person) to their matching person records.

### Subtasks

- [ ] **8.1 — Analyze orphaned observations**
  - Script exists: `scripts/analyzeOrphanedObservations.js`
  - Run it: understand how many orphans exist, what identifiers they carry, why they were orphaned (likely Phase 2 failures during the Jan 6-25 incident).

- [ ] **8.2 — Review existing link script**
  - Script exists: `scripts/link-orphaned-observations.js`
  - Read and verify: does it re-run identity resolution, find the matching Person, and add the observation reference? Does it have `--dry-run` mode?

- [ ] **8.3 — Dry-run the link script**
  - Command: `node scripts/link-orphaned-observations.js --dry-run`
  - Capture: how many would be linked, how many remain unresolvable.

- [ ] **8.4 — Execute linking**
  - Command: `node scripts/link-orphaned-observations.js --execute`
  - For unresolvable observations (no matching person found), log them and leave them. These may need new person creation or are genuinely orphaned.

- [ ] **8.5 — Post-link validation**
  - Re-run `scripts/analyzeOrphanedObservations.js` to confirm orphan count is reduced.
  - Spot-check 10 newly linked observations: verify the person's `observations.visits` or `observations.scans` array includes the observation ID, and `meta.observationsCount` is updated.

### Acceptance Criteria

- Orphaned observation count drops by >80%.
- Linked observations appear in the correct Person document's `observations` array.
- `meta.observationsCount` reflects the updated count.

---

## 9. Migrate URL-Based Person _id Values to Stable IDs

**Goal:** People whose `_id` is a profile URL (e.g., `linkedin.com/in/mike-hare`) are fragile — if the LinkedIn username changes, the reference breaks. Migrate these to stable IDs (Sales Nav ID or numeric ID) where available.

### Subtasks

- [ ] **9.1 — Identify URL-based people**
  - Query: `Person.find({ _id: /^linkedin\.com/ })` — count and sample.
  - For each, check if they have a `salesNavId` or `numericId` alias that could serve as the new `_id`.

- [ ] **9.2 — Write migration script**
  - File: new `scripts/migrate-url-people-to-stable-id.js`
  - Logic per person:
    1. Find the best stable alias: salesNavId > numericId > linkedInUsername.
    2. If a stable alias exists, create a new Person document with stable `_id`, copy all data.
    3. Update all observation references (Visit and Scan documents) that point to the old `_id` in `person_id` fields or dead letter records.
    4. Update Change records that reference the old `person_id`.
    5. Delete the old document.
    6. Log the migration: `{ old_id, new_id, alias_used }`.
  - Include `--dry-run` mode that reports what would change without writing.

- [ ] **9.3 — Dry-run and review**
  - Command: `node scripts/migrate-url-people-to-stable-id.js --dry-run`
  - Review output: how many can be migrated (have stable alias), how many cannot (URL is their only identifier).

- [ ] **9.4 — Execute migration in batches**
  - Command: `node scripts/migrate-url-people-to-stable-id.js --execute --limit 100`
  - Spot-check migrated records.
  - Run full migration once confident.

- [ ] **9.5 — Post-migration validation**
  - Confirm URL-based `_id` count is reduced to near zero (or only those with no stable alternative).
  - Confirm no orphaned observations created by the migration.
  - Confirm Change records still reference valid person IDs.

### Acceptance Criteria

- People with URL-based `_id` values who have a stable alias are migrated to use the stable ID.
- All references (observations, changes, dead letters) are updated.
- No data loss during migration.

---

## 10. Test `observationHandler.js` (Dual-Write Orchestration)

**Goal:** Add test coverage for the core webhook processing pipeline that every request flows through.

### Subtasks

- [ ] **10.1 — Create test file**
  - File: new `__tests__/controllers/observationHandler.test.js`

- [ ] **10.2 — Test: successful visit creates observation + person + company + location**
  - Mock the Visit model, personController, companyController, locationController.
  - Send a valid visit payload through `handleObservation()`.
  - Assert: observation is created via `findOneAndUpdate`, person/company/location upserts are called, response includes `people_upsert: true`.

- [ ] **10.3 — Test: duplicate event_key returns existing observation, skips entity upserts**
  - First call creates the observation. Second call with same payload triggers the E11000 path.
  - Assert: second response has `duplicate: true`, person upsert is NOT called again.

- [ ] **10.4 — Test: Phase 2 failure (person upsert throws) creates dead letter**
  - Mock `upsertFromObservation` to throw an error.
  - Assert: response is still 200 (Phase 1 succeeded), dead letter is created with correct `observation_id` and error details.

- [ ] **10.5 — Test: Phase 1 failure (model save throws) returns 500**
  - Mock the model's `findOneAndUpdate` to throw a non-E11000 error.
  - Assert: response is 500, no dead letter is created.

- [ ] **10.6 — Test: company upsert failure doesn't block location upsert**
  - Mock `upsertCompanyFromObservation` to throw.
  - Assert: location upsert is still called, response shows `company_upsert: false, location_upsert: true`.

- [ ] **10.7 — Test: invalid payload returns 400 with validation error**
  - Send payload missing required fields.
  - Assert: 400 response with error details.

### Acceptance Criteria

- All 6 test scenarios pass.
- Tests run via `npm test` without MongoDB connection (fully mocked).

---

## 11. Test `companyController.js` + `locationController.js`

**Goal:** Add unit tests for company and location snapshot upsert logic.

### Subtasks

- [ ] **11.1 — Create company controller test file**
  - File: new `__tests__/controllers/companyController.test.js`

- [ ] **11.2 — Test: new company created from observation**
  - Provide an observation with `CompanyID: "12345678"` and `Company: "Acme Inc"`.
  - Assert: company created with numeric `_id`, canonical_id set, aliases include `numericId` and `name`.

- [ ] **11.3 — Test: existing company updated with new observation**
  - Create company, then upsert again with updated `Industry` field.
  - Assert: `snapshot.industry` is updated, observation added to `observations.visits` or `observations.scans`, `meta.observationsCount` incremented.

- [ ] **11.4 — Test: empty/null values don't overwrite existing snapshot fields**
  - Create company with `snapshot.name = "Acme"`, then upsert with `Company: ""`.
  - Assert: `snapshot.name` remains `"Acme"` (the `applySnapshotValue` guard at `companyController.js:7-11`).

- [ ] **11.5 — Test: E11000 race condition handled gracefully**
  - Mock `Company.create` to throw E11000, mock `Company.findById` to return the existing doc.
  - Assert: upsert succeeds, returns the found document.

- [ ] **11.6 — Test: observation without stable company ID returns null**
  - Provide observation with only `Company: "Acme"` (no CompanyID, no CompanyProfile with numeric ID).
  - Assert: returns null (no company created).

- [ ] **11.7 — Create location controller test file**
  - File: new `__tests__/controllers/locationController.test.js`

- [ ] **11.8 — Test: new location created with parsed components**
  - Provide observation with `Location: "San Francisco, California, United States"`.
  - Assert: location created with slugified `_id`, parsed `snapshot.city`, `snapshot.state`, `snapshot.country`.

- [ ] **11.9 — Test: existing location updated with new observation**
  - Similar to company: verify alias merging, observation linking, meta update.

- [ ] **11.10 — Test: null/empty location returns null**
  - Provide observation with no Location field.
  - Assert: returns null.

### Acceptance Criteria

- All tests pass via `npm test`.
- Tests are fully mocked (no MongoDB connection required).

---

## 12. Test `eventKey.js`

**Goal:** Verify idempotency key generation is consistent and correct.

### Subtasks

- [ ] **12.1 — Create test file**
  - File: new `__tests__/utils/eventKey.test.js`

- [ ] **12.2 — Test: same payload produces same key**
  - Call `computeEventKey(payload)` twice with identical input.
  - Assert: both return the same SHA1 hash.

- [ ] **12.3 — Test: different payloads produce different keys**
  - Vary `userid`, `type`, `time`, and `id` independently.
  - Assert: each variation produces a distinct hash.

- [ ] **12.4 — Test: missing fields use fallback values**
  - Call with `{}` (all fields missing).
  - Assert: returns a valid hash (not null/undefined), uses fallbacks `"no-user"`, `"unknown"`, `Date.now()`, `"no-id"`.
  - Note: `Date.now()` makes the hash non-deterministic when `time` is missing. Document this behavior.

- [ ] **12.5 — Test: nested data fields are checked**
  - Provide payload with `data.VisitTime` instead of top-level `time`.
  - Assert: the time component uses `data.VisitTime`.

- [ ] **12.6 — Test: output format is 40-char hex SHA1**
  - Assert: result matches `/^[a-f0-9]{40}$/`.

### Acceptance Criteria

- All tests pass. Idempotency key behavior is documented through tests.

---

## 13. Identity Resolution Test Fixtures (Including Merge Scenarios)

**Goal:** Create realistic webhook fixture data and regression tests for the exact scenarios that caused the 9,587 duplicates.

### Subtasks

- [ ] **13.1 — Create fixture files**
  - File: new `__tests__/fixtures/webhookPayloads.js`
  - Include:
    - `visitWithSalesNav`: visit payload with `SalesProfile` containing Sales Nav ID + `Profile` with `/in/username`
    - `scanWithProfileOnly`: scan payload with only `Profile` URL (no SalesProfile)
    - `scanWithSalesNav`: scan payload with Sales Nav ID
    - `visitWithProfileOnly`: visit with only profile URL
    - `visitWithNumericId`: visit where DuxSoup `id` is a numeric member ID
    - `scanWithDuxsoupPid`: scan where `id` is `pid.username` format

- [ ] **13.2 — Test: extractIdentifiers produces overlapping aliases for same person across visit and scan**
  - Import `extractIdentifiers` from `identityMatcher.js`.
  - Pass visit fixture, capture aliases. Pass scan fixture for same person, capture aliases.
  - Assert: at least one alias value is shared between the two sets.

- [ ] **13.3 — Test: resolvePersonIdentity produces matching person_id for same person across webhook types**
  - Call `resolvePersonIdentity()` with visit fixture, then with scan fixture for same person.
  - Assert: either `person_id` matches OR at least one alias value overlaps (enabling the service to find the match).

- [ ] **13.4 — Test: isSamePerson returns true for visit+scan of same human**
  - Use `identityMatcher.isSamePerson(visitPayload, scanPayload)`.
  - Assert: returns true when both payloads represent the same person.

- [ ] **13.5 — Test: merge scenario — two People matched by alias produce one winner**
  - Create two Person documents with overlapping aliases.
  - Call `identityResolverService.resolveOrCreate()` with an identity that matches both.
  - Assert: only one Person remains, with merged aliases and observations.
  - Assert: Merge audit record exists.

### Acceptance Criteria

- Fixtures represent real-world payloads observed in production.
- Tests prove that the exact duplicate scenario (visit with Sales Nav ID + scan with profile URL for same person) no longer produces duplicates.

---

## 14. Add Missing Database Indexes

**Goal:** Add compound indexes for query patterns used by the seniority, query, and search endpoints.

### Subtasks

- [ ] **14.1 — Add indexes to Person schema**
  - File: `src/models/person.js` (after line 313)
  - Add:
    ```js
    personSchema.index({ "snapshot.currentCompany": 1, createdAt: -1 });
    personSchema.index({ "snapshot.location": 1 });
    personSchema.index({ "snapshot.country": 1 });
    personSchema.index({ "derived.highestSeniorityRank": -1 });
    ```

- [ ] **14.2 — Add index to Company schema**
  - File: `src/models/company.js`
  - Add: `companySchema.index({ "snapshot.industry": 1 });`

- [ ] **14.3 — Verify indexes are created**
  - Run the server locally (or `node scripts/createIndexes.js` if it exists).
  - Confirm via MongoDB shell: `db.people.getIndexes()` includes the new indexes.

- [ ] **14.4 — Test query performance**
  - Run a sample query that uses the new index (e.g., filter by company + date sort).
  - Use `.explain()` to confirm index is used.

### Acceptance Criteria

- New indexes exist in the database.
- Queries that filter on these fields use the index (confirmed via explain plan).

---

## 15. Change Detection Enrichment

**Goal:** Add role tenure deltas, company change "from/to" validation, and a `recentJobChange` flag to the Change model.

### Subtasks

- [ ] **15.1 — Add new fields to Change schema**
  - File: `src/models/change.js`
  - Add to the schema (after line 53):
    ```js
    // Enrichment fields
    fromCompanyId: String,
    toCompanyId: String,
    tenureDaysAtPreviousRole: Number,
    recentJobChange: { type: Boolean, default: true },
    recentJobChangeExpiresAt: Date,
    ```

- [ ] **15.2 — Compute tenure delta when recording a company change**
  - File: `src/services/changeDetectionService.js` → `recordChange()`
  - When `type === 'company_change'`, look at the person's roles array to find the previous role's start date. Compute `tenureDaysAtPreviousRole = daysBetween(roleStartDate, now)`.
  - Set `recentJobChangeExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)`.

- [ ] **15.3 — Populate from/to company IDs**
  - In `detectCompanyChange()`, also extract `currentCompanyId` from old and new snapshots.
  - Pass `fromCompanyId` and `toCompanyId` to `recordChange()`.

- [ ] **15.4 — Add background job to expire `recentJobChange` flag**
  - File: `src/workers/scheduler.js`
  - Add a daily cron job that runs:
    ```js
    Change.updateMany(
      { recentJobChange: true, recentJobChangeExpiresAt: { $lte: new Date() } },
      { $set: { recentJobChange: false } }
    );
    ```

- [ ] **15.5 — Add tests for enrichment**
  - File: `__tests__/services/changeDetectionService.test.js` (existing file — extend it)
  - Test: company change records include tenure delta and company IDs.
  - Test: `recentJobChange` flag is true at creation, false after expiry job runs.

- [ ] **15.6 — Add index for recentJobChange queries**
  - File: `src/models/change.js`
  - Add: `changeSchema.index({ recentJobChange: 1, timestamp: -1 });`

### Acceptance Criteria

- Company change records include `fromCompanyId`, `toCompanyId`, `tenureDaysAtPreviousRole`.
- `recentJobChange` is `true` for 90 days, then automatically set to `false`.
- Existing change detection tests still pass.

---

## 16. Improve Identity Matching Robustness

**Goal:** Incremental hardening of URL normalization, parameter stripping, and ID format unification.

### Subtasks

- [ ] **16.1 — Strip Sales Nav URL tracking parameters**
  - File: `src/utils/identityMatcher.js` → `normalizeUrl()`
  - Sales Nav URLs sometimes include `,NAME,o7fk` or `?trk=...` suffixes. The current `normalizeUrl()` strips query params (line 143: `split("?")[0]`) but does NOT strip comma-separated params. Add: `normalized = normalized.split(",")[0]` after the query param strip.
  - Add test: `linkedin.com/sales/lead/ACwAAALwVAIB,NAME,o7fk` → `linkedin.com/sales/lead/acwaaalwvaib`.

- [ ] **16.2 — Normalize trailing `/` and double slashes in URLs**
  - Same file, same function.
  - After current normalization, add: `normalized = normalized.replace(/\/+/g, '/').replace(/\/$/, '')`.
  - Add test: `linkedin.com/in/mike-hare//` → `linkedin.com/in/mike-hare`.

- [ ] **16.3 — Unify DuxSoup ID prefix formats**
  - File: `src/utils/identityMatcher.js` → `normalizeDuxsoupId()`
  - Currently does `trim().toLowerCase()`. Also strip `id.` and `pid.` prefixes to extract the bare identifier, then store both the full format and the bare format as aliases.
  - This is partially done already (`extractLinkedInUsername` handles `pid.` format). Verify and add test.

- [ ] **16.4 — Case-insensitive username comparison**
  - File: `src/utils/identityMatcher.js` → `extractLinkedInUsername()`
  - Already returns `.toLowerCase()` at line 50. Verify that `identityResolverService.findByAnyAlias()` also does case-insensitive matching for `linkedInUsername` type aliases (currently only salesNavId gets regex case-insensitive matching at lines 50-58). Add `linkedInUsername` to the case-insensitive query branch.

- [ ] **16.5 — Add tests for all normalization edge cases**
  - File: `__tests__/utils/identityMatcher.test.js` (existing file — extend it)
  - Cases: trailing slashes, double slashes, comma params, `?trk=` params, mixed case usernames, `id.` vs `pid.` prefixes.

### Acceptance Criteria

- All normalization edge cases produce consistent, matchable identifiers.
- Existing tests pass. New edge case tests pass.

---

## 17. Pre-Commit Hooks (Husky + lint-staged)

**Goal:** Automatically run ESLint and Prettier on staged files before every commit.

### Subtasks

- [ ] **17.1 — Install husky and lint-staged**
  - Command: `npm install --save-dev husky lint-staged`

- [ ] **17.2 — Initialize husky**
  - Command: `npx husky init`
  - This creates `.husky/` directory with a `pre-commit` hook.

- [ ] **17.3 — Configure lint-staged in package.json**
  - File: `package.json`
  - Add:
    ```json
    "lint-staged": {
      "src/**/*.js": ["eslint --fix", "prettier --write"],
      "__tests__/**/*.js": ["eslint --fix", "prettier --write"]
    }
    ```

- [ ] **17.4 — Update the pre-commit hook**
  - File: `.husky/pre-commit`
  - Content: `npx lint-staged`

- [ ] **17.5 — Test the hook**
  - Make a small change to a `.js` file, stage it, attempt to commit.
  - Verify: ESLint and Prettier run on the staged file. If there are fixable issues, they are auto-fixed. If there are unfixable errors, the commit is blocked.

### Acceptance Criteria

- Every commit automatically lints and formats staged JS files.
- Commits with lint errors are blocked.
- Developers can bypass with `--no-verify` if needed (standard Git behavior).

---

## Dependency Notes

Some items have natural ordering:

1. **Item 6 (Enable linting in CI)** depends on creating an ESLint config, which is shared with **Item 17 (Pre-commit hooks)**. Do Item 6 first, then Item 17 reuses the ESLint config.
2. **Item 1 (Stop new duplicates)** should land before **Item 7 (Execute merge)** — otherwise new duplicates accumulate while you're cleaning old ones.
3. **Item 7 (Execute merge)** should happen before **Item 8 (Link orphaned observations)** — merging may create new orphans or resolve existing ones.
4. **Item 9 (Migrate URL-based IDs)** should happen after **Item 7 (Execute merge)** — merging may resolve some URL-based people.
5. **Items 10-13 (Tests)** are independent and can be done in parallel.
