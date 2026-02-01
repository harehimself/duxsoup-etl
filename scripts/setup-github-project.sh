#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# GitHub Project + Issues Setup Script
# ============================================================================
#
# Creates a GitHub Project board and 17 issues (with subtask checklists)
# from the Development Plan. Each issue is labeled, assigned to a milestone,
# and added to the project board.
#
# Prerequisites:
#   - gh CLI installed and authenticated (gh auth login)
#   - Run from the repo root: ./scripts/setup-github-project.sh
#
# What it creates:
#   - 5 labels (agent-a through agent-e)
#   - 3 labels (priority: high, medium, low)
#   - 5 labels (category: security, testing, data-quality, docs, feature)
#   - 1 GitHub Project (board layout)
#   - 17 issues with full subtask checklists
# ============================================================================

REPO="harehimself/duxsoup-etl"

echo "=== Setting up GitHub Project for DuxSoup ETL ==="
echo ""

# -----------------------------------------------------------
# 1. Create Labels
# -----------------------------------------------------------
echo "--- Creating labels ---"

create_label() {
  local name="$1"
  local color="$2"
  local desc="$3"
  gh label create "$name" --color "$color" --description "$desc" --repo "$REPO" 2>/dev/null \
    && echo "  Created label: $name" \
    || echo "  Label exists:  $name"
}

# Agent labels
create_label "agent-a" "1d76db" "Agent A: Security & CI"
create_label "agent-b" "0e8a16" "Agent B: Test Coverage"
create_label "agent-c" "d93f0b" "Agent C: Identity & Dedup"
create_label "agent-d" "5319e7" "Agent D: Documentation"
create_label "agent-e" "f9d0c4" "Agent E: Feature Enrichment"

# Priority labels
create_label "priority: high" "b60205" "High priority item"
create_label "priority: medium" "fbca04" "Medium priority item"

# Category labels
create_label "security" "d73a4a" "Security hardening"
create_label "testing" "0075ca" "Test coverage"
create_label "data-quality" "e4e669" "Data quality & dedup"
create_label "documentation" "c5def5" "Documentation"
create_label "feature" "a2eeef" "Feature addition"
create_label "ci-cd" "006b75" "CI/CD pipeline"

echo ""

# -----------------------------------------------------------
# 2. Create GitHub Project
# -----------------------------------------------------------
echo "--- Creating GitHub Project ---"

PROJECT_URL=$(gh project create \
  --owner harehimself \
  --title "DuxSoup ETL — Development Plan" \
  --format json 2>/dev/null | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4) \
  || PROJECT_URL=""

if [ -z "$PROJECT_URL" ]; then
  echo "  Project may already exist. Continuing with issue creation."
  echo "  To find the project: gh project list --owner harehimself"
else
  echo "  Created project: $PROJECT_URL"
fi

echo ""

# -----------------------------------------------------------
# 3. Create Issues
# -----------------------------------------------------------
echo "--- Creating issues ---"

create_issue() {
  local title="$1"
  local labels="$2"
  local body="$3"

  local url
  url=$(gh issue create \
    --repo "$REPO" \
    --title "$title" \
    --label "$labels" \
    --body "$body" 2>&1)

  echo "  Created: $title"
  echo "    $url"
}

# ----- ITEM 1 -----
create_issue \
  "Stop new duplicate people (cross-link aliases at ingestion)" \
  "agent-c,priority: high,data-quality" \
  "$(cat <<'BODY'
## Goal

When a webhook arrives with a Sales Nav ID but no public URL (or vice versa), the system should still find and match an existing person who was previously created from the other identifier type. Prevents ~90% of new duplicates.

## Context

- **Root cause:** `identityResolverService.resolveOrCreate()` only matches aliases _already stored_ on the person document. If a visit creates a person with `salesNavId` and a scan arrives later with only `profileUrl`, no alias overlap exists → duplicate created.
- **Investigation:** `docs/duplicate-person-investigation.md`

## Subtasks

- [ ] **1.1** Extract username from public profile URL and add as `linkedInUsername` alias during resolution (`src/utils/identityResolver.js` → `resolvePersonIdentity()`)
- [ ] **1.2** Derive `linkedInUsername` from `vanityName` when username extraction fails (same file, around line 278)
- [ ] **1.3** Verify `identityResolverService.findByAnyAlias()` matches `linkedInUsername` ↔ `vanityName` cross-type
- [ ] **1.4** Integration test: visit-then-scan for same person produces one record (`__tests__/integration/duplicatePrevention.test.js`)
- [ ] **1.5** Integration test: scan-then-visit for same person produces one record

## Acceptance Criteria

- Two webhooks for the same human (one visit with Sales Nav ID, one scan with profile URL) produce exactly one Person document.
- Resulting Person has aliases covering both identifier types.
- `npm test` passes.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 1
BODY
)"

# ----- ITEM 2 -----
create_issue \
  "Add helmet for security headers" \
  "agent-a,priority: high,security" \
  "$(cat <<'BODY'
## Goal

Add standard HTTP security headers to all responses.

## Subtasks

- [ ] `npm install helmet`
- [ ] Add `app.use(helmet())` in `src/index.js` BEFORE CORS middleware (before line 30)
- [ ] Verify health endpoint still returns 200 with security headers present

## Acceptance Criteria

- Response headers include `x-content-type-options: nosniff`, `x-frame-options`, etc.
- No functional regression.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 2
BODY
)"

# ----- ITEM 3 -----
create_issue \
  "Add global error handler middleware" \
  "agent-a,priority: high,security" \
  "$(cat <<'BODY'
## Goal

Add a catch-all Express error handler so unhandled errors return structured JSON instead of stack traces.

## Subtasks

- [ ] Add 4-arg error handler middleware in `src/index.js` AFTER all route definitions (~after line 107)
- [ ] Handler must: log via Winston, return `{ success: false, error: "INTERNAL_ERROR", message }`, hide message in production, respect `err.status`
- [ ] Write test at `__tests__/middleware/errorHandler.test.js`: errors return structured JSON, stack traces hidden in production

## Acceptance Criteria

- Unhandled throws return structured JSON with 500 status.
- Stack traces hidden when `NODE_ENV=production`.
- `npm test` passes.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 3
BODY
)"

# ----- ITEM 4 -----
create_issue \
  "Document webhook payload variations" \
  "agent-d,priority: medium,documentation" \
  "$(cat <<'BODY'
## Goal

Create `docs/WEBHOOK_PAYLOADS.md` — canonical reference for field differences between visit and scan payloads.

## Source Files to Read

- `src/controllers/visitController.js` → `dataMapper`
- `src/controllers/scanController.js` → `dataMapper`
- `src/utils/validation.js` → `validateWebhookPayload`
- `src/models/visit.js`, `src/models/scan.js`
- `src/utils/identityMatcher.js` → `extractIdentifiers()`

## Subtasks

- [ ] Audit actual webhook fields from source files above
- [ ] Write `docs/WEBHOOK_PAYLOADS.md` with sections: Payload Envelope, Visit Fields, Scan Fields, URL Fields, Identity Fields, Extended Data
- [ ] Cross-link from TODO.md Key Documents section

## Acceptance Criteria

- A developer can determine exactly which fields to expect for any webhook type without reading source code.
- Doc-only change, no code modifications.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 4
BODY
)"

# ----- ITEM 5 -----
create_issue \
  "Create operational runbook" \
  "agent-d,priority: medium,documentation" \
  "$(cat <<'BODY'
## Goal

Create `docs/RUNBOOK.md` — guide for the 80+ scripts in `scripts/`.

## Subtasks

- [ ] Inventory and categorize scripts (Analysis, Backfill, Migration, Cleanup, Import)
- [ ] Write runbook with sections: Prerequisites, Common Operations, Safe Defaults, Rollback Guidance, Monitoring During Scripts
- [ ] Cross-link from README.md and TODO.md

## Acceptance Criteria

- An operator unfamiliar with the codebase can safely run any common maintenance task by following the runbook.
- Doc-only change, no code modifications.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 5
BODY
)"

# ----- ITEM 6 -----
create_issue \
  "Enable linting in CI" \
  "agent-a,priority: medium,ci-cd" \
  "$(cat <<'BODY'
## Goal

Create ESLint config, add lint script, activate in GitHub Actions.

## Subtasks

- [ ] Create `eslint.config.js` (ESLint 9 flat config, CommonJS, Node 20+, ignore `node_modules/` and `scripts/`)
- [ ] Add `"lint": "eslint src/ __tests__/"` to package.json scripts
- [ ] Run `npm run lint` and fix ERRORS (not warnings) in `src/` and `__tests__/`
- [ ] Update `.github/workflows/main.yml` lines 35-40: replace commented lint step with `run: npm run lint`
- [ ] Verify CI passes on a test branch

## Acceptance Criteria

- `npm run lint` exits with 0.
- CI enforces linting on push/PR.
- `npm test` still passes.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 6
BODY
)"

# ----- ITEM 7 -----
create_issue \
  "Execute duplicate person merge" \
  "agent-c,priority: high,data-quality" \
  "$(cat <<'BODY'
## Goal

Clean up the ~9,587 duplicate person records (40% of database).

**IMPORTANT:** Item 1 (stop new duplicates) must land first.

## Subtasks

- [ ] Dry-run: `node scripts/merge-duplicates.js --dry-run` — capture candidate count
- [ ] Export candidate pairs to CSV for review (sample 20 pairs manually)
- [ ] Small batch: `node scripts/merge-duplicates.js --execute --limit 50` — validate merged docs
- [ ] Full merge: `node scripts/merge-duplicates.js --execute`
- [ ] Post-merge: run `node scripts/analyze-duplicates.js` — confirm near-zero duplicates

## Acceptance Criteria

- Duplicate count drops from ~9,587 to <100.
- Every merge has an audit record in `merges` collection.
- No data loss: aliases, observations, roles, education, skills preserved on winners.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 7
BODY
)"

# ----- ITEM 8 -----
create_issue \
  "Link orphaned observations to canonical people" \
  "agent-c,priority: medium,data-quality" \
  "$(cat <<'BODY'
## Goal

Attach ~6,886 unreferenced observations to their matching Person records.

**IMPORTANT:** Run after Item 7 (merge) completes.

## Subtasks

- [ ] Analyze: `node scripts/analyzeOrphanedObservations.js` — report count and breakdown
- [ ] Review `scripts/link-orphaned-observations.js` logic
- [ ] Dry-run: `node scripts/link-orphaned-observations.js --dry-run`
- [ ] Execute: `node scripts/link-orphaned-observations.js --execute`
- [ ] Validate: re-run analysis, confirm orphan count dropped >80%

## Acceptance Criteria

- Orphaned observation count drops >80%.
- Linked observations appear in correct Person `observations` array.
- `meta.observationsCount` updated.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 8
BODY
)"

# ----- ITEM 9 -----
create_issue \
  "Migrate URL-based person _id values to stable IDs" \
  "agent-c,priority: medium,data-quality" \
  "$(cat <<'BODY'
## Goal

People whose `_id` is a profile URL (e.g., `linkedin.com/in/mike-hare`) are fragile. Migrate to stable IDs where available.

**IMPORTANT:** Run after Items 7 and 8.

## Subtasks

- [ ] Query URL-based people: `Person.find({ _id: /^linkedin\.com/ })` — report count
- [ ] Check which have stable aliases (salesNavId, numericId, linkedInUsername)
- [ ] Write `scripts/migrate-url-people-to-stable-id.js` with `--dry-run` (default) and `--execute` modes
- [ ] Logic: find best stable alias → create new doc → update Visit/Scan/Change/DeadLetter references → delete old doc
- [ ] Dry-run, review, then execute in batches of 100
- [ ] Post-migration: confirm URL-based `_id` count near zero

## Acceptance Criteria

- URL-based people with stable aliases are migrated.
- All references (observations, changes, dead letters) updated.
- No data loss.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 9
BODY
)"

# ----- ITEM 10 -----
create_issue \
  "Test observationHandler.js (dual-write orchestration)" \
  "agent-b,priority: high,testing" \
  "$(cat <<'BODY'
## Goal

Add test coverage for the core webhook processing pipeline. Every webhook request flows through `handleObservation()` in `src/controllers/observationHandler.js`.

## Subtasks

- [ ] Create `__tests__/controllers/observationHandler.test.js`
- [ ] Test: successful visit creates observation + calls person/company/location upserts + returns 200
- [ ] Test: duplicate event_key → finds existing observation → returns 200 with `duplicate:true` → skips entity upserts
- [ ] Test: Phase 2 person failure → still returns 200 → dead letter created → company/location NOT called (same try block)
- [ ] Test: Phase 2 company failure → location upsert still runs → `company_upsert:false, location_upsert:true`
- [ ] Test: Phase 1 failure (non-E11000) → returns 500
- [ ] Test: invalid payload → returns 400

## Key Detail

Read `observationHandler.js` lines 134-198 carefully. Company and location upserts are INSIDE the person upsert try block. If person upsert throws, company and location are skipped. If person succeeds but company throws, location still runs because they have separate try/catch blocks (lines 144-165).

## Acceptance Criteria

- All 6 scenarios pass via `npm test`.
- Fully mocked — no MongoDB connection required.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 10
BODY
)"

# ----- ITEM 11 -----
create_issue \
  "Test companyController.js + locationController.js" \
  "agent-b,priority: high,testing" \
  "$(cat <<'BODY'
## Goal

Add unit tests for company and location snapshot upsert logic. Same complexity as `personController.js` (well-tested) but zero coverage.

## Subtasks

### companyController (`__tests__/controllers/companyController.test.js`)
- [ ] Test: new company created with numeric `_id`, canonical_id, aliases
- [ ] Test: existing company updated — snapshot fields, observation added, meta incremented
- [ ] Test: empty values don't overwrite existing snapshot (applySnapshotValue guard)
- [ ] Test: E11000 race condition handled gracefully
- [ ] Test: no stable company ID → returns null

### locationController (`__tests__/controllers/locationController.test.js`)
- [ ] Test: new location with parsed city/state/country from location string
- [ ] Test: existing location updated — aliases merged, observation linked
- [ ] Test: null/empty location → returns null

## Acceptance Criteria

- All tests pass via `npm test` without MongoDB.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 11
BODY
)"

# ----- ITEM 12 -----
create_issue \
  "Test eventKey.js" \
  "agent-b,priority: medium,testing" \
  "$(cat <<'BODY'
## Goal

Verify idempotency key generation is consistent and correct. `src/utils/eventKey.js` is 26 lines but controls duplicate prevention.

## Subtasks

- [ ] Create `__tests__/utils/eventKey.test.js`
- [ ] Test: same payload → same key (deterministic)
- [ ] Test: different payloads → different keys (vary each component)
- [ ] Test: missing fields use fallbacks (`"no-user"`, `"unknown"`, `"no-id"`)
- [ ] Test: nested `data.VisitTime` used when top-level `time` missing
- [ ] Test: output matches `/^[a-f0-9]{40}$/`

## Note

When both `time` and `data.VisitTime` are missing, `Date.now()` makes the hash non-deterministic. Mock `Date.now` or assert format only.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 12
BODY
)"

# ----- ITEM 13 -----
create_issue \
  "Identity resolution test fixtures (including merge scenarios)" \
  "agent-b,priority: high,testing" \
  "$(cat <<'BODY'
## Goal

Create realistic webhook fixture data and regression tests for the exact scenario that caused 9,587 duplicates.

## Subtasks

- [ ] Create `__tests__/fixtures/webhookPayloads.js` with: visitWithSalesNav, scanWithProfileOnly, scanWithSalesNav, visitWithProfileOnly, visitWithNumericId, scanWithDuxsoupPid
- [ ] Test: `extractIdentifiers` produces overlapping alias values for same person across visit and scan
- [ ] Test: `resolvePersonIdentity` produces matching person_id or overlapping aliases
- [ ] Test: `isSamePerson(visitPayload, scanPayload)` returns true for same-person pairs
- [ ] Test: merge scenario — two People matched by alias → one winner, merge audit record created

## Acceptance Criteria

- Fixtures represent real-world payloads.
- Tests prove the duplicate scenario no longer produces duplicates.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 13
BODY
)"

# ----- ITEM 14 -----
create_issue \
  "Add missing database indexes" \
  "agent-e,priority: medium,feature" \
  "$(cat <<'BODY'
## Goal

Add compound indexes for common query patterns.

## Subtasks

- [ ] Person: `{ "snapshot.currentCompany": 1, createdAt: -1 }` — company filter + date sort
- [ ] Person: `{ "snapshot.country": 1 }` — location filtering
- [ ] Person: `{ "derived.highestSeniorityRank": -1 }` — seniority ranking
- [ ] Company: `{ "snapshot.industry": 1 }` — industry filtering
- [ ] Verify indexes created (mongo shell or script)
- [ ] Test query with `.explain()` to confirm index usage

## Files

- `src/models/person.js` (after line 313)
- `src/models/company.js`

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 14
BODY
)"

# ----- ITEM 15 -----
create_issue \
  "Change detection enrichment" \
  "agent-e,priority: medium,feature" \
  "$(cat <<'BODY'
## Goal

Add role tenure deltas, company change from/to IDs, and a rolling 90-day `recentJobChange` flag.

## Subtasks

- [ ] Add fields to Change schema: `fromCompanyId`, `toCompanyId`, `tenureDaysAtPreviousRole`, `recentJobChange`, `recentJobChangeExpiresAt`
- [ ] Compute tenure delta in `changeDetectionService.js` → `recordChange()` for company_change type
- [ ] Populate fromCompanyId/toCompanyId from old/new snapshots
- [ ] Add daily cron job in `scheduler.js` to expire `recentJobChange` after 90 days
- [ ] Extend `__tests__/services/changeDetectionService.test.js` with enrichment tests
- [ ] Add index: `{ recentJobChange: 1, timestamp: -1 }`

## Acceptance Criteria

- Company change records include company IDs and tenure.
- `recentJobChange` is true for 90 days, then expired by background job.
- Existing change detection tests still pass.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 15
BODY
)"

# ----- ITEM 16 -----
create_issue \
  "Improve identity matching robustness" \
  "agent-c,priority: medium,data-quality" \
  "$(cat <<'BODY'
## Goal

Incremental hardening of URL normalization, parameter stripping, and ID format unification.

## Subtasks

- [ ] Strip Sales Nav comma-separated params in `identityMatcher.js` → `normalizeUrl()` (add `split(",")[0]` after query param strip)
- [ ] Normalize double slashes in URLs
- [ ] Add `linkedInUsername` to case-insensitive regex matching in `identityResolverService.findByAnyAlias()` (currently only salesNavId gets this)
- [ ] Add edge case tests to `__tests__/utils/identityMatcher.test.js`

## Acceptance Criteria

- All normalization edge cases produce consistent identifiers.
- Existing tests pass.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 16
BODY
)"

# ----- ITEM 17 -----
create_issue \
  "Pre-commit hooks (husky + lint-staged)" \
  "agent-a,priority: medium,ci-cd" \
  "$(cat <<'BODY'
## Goal

Enforce ESLint + Prettier on staged files before every commit.

**Depends on:** Item 6 (ESLint config must exist first).

## Subtasks

- [ ] `npm install --save-dev husky lint-staged`
- [ ] `npx husky init`
- [ ] Add lint-staged config to package.json
- [ ] Set `.husky/pre-commit` to `npx lint-staged`
- [ ] Test: stage a JS file, commit, verify lint + format runs

## Acceptance Criteria

- Every commit auto-lints and formats staged JS files.
- Commits with lint errors are blocked.

## Ref

`docs/DEVELOPMENT_PLAN.md` Item 17
BODY
)"

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. Create the project board manually or via: gh project create --owner harehimself --title 'DuxSoup ETL — Development Plan'"
echo "  2. Add issues to the project: gh project item-add <PROJECT_NUMBER> --owner harehimself --url <ISSUE_URL>"
echo "  3. Or bulk-add all open issues:"
echo "     gh issue list --repo $REPO --state open --json url -q '.[].url' | while read url; do"
echo "       gh project item-add <PROJECT_NUMBER> --owner harehimself --url \"\$url\""
echo "     done"
