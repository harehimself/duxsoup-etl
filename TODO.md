# Project TODO - DuxSoup ETL

**Last Updated:** January 25, 2026

---

## 🔴 CURRENT: Duplicate Person Investigation

**Status:** Analysis complete, awaiting implementation decision

**Context:** [Session State](./docs/session-state-2026-01-25.md) | [Full Investigation](./docs/duplicate-person-investigation.md)

**Problem:** 9,587 duplicate person records (40% of database) due to non-overlapping identifier sets

**Next Steps:**
- [ ] Review investigation document
- [ ] Choose solution option (A/B/C)
- [ ] Implement chosen solution
- [ ] Test merge logic with dry run
- [ ] Execute merge on production data

**Priority:** HIGH - Affects data quality and analytics

---

## ✅ COMPLETED

### Company ETL Fix (Jan 25, 2026)
- [x] Identified bug: Wrong payload path in company/location controllers
- [x] Fixed controllers to read `rawData.data` 
- [x] Backfilled 18 days of missing data (Jan 7-25)
- [x] Recovered 3,558 companies
- [x] Verified ETL working correctly

**Result:** Company database recovered (2,317 → 5,875 companies)

**Docs:** [Bug Report](./docs/company-etl-bug-report.md) | [Fix Summary](./docs/company-etl-fix-summary.md)

---

## 📋 BACKLOG

### High Priority
- [ ] **Duplicate Person Solution** - See investigation doc
- [ ] Monitor company ETL for new issues
- [ ] Verify location ETL fix (same bug as company)

### Medium Priority
- [ ] Add automated tests for identity resolution
- [ ] Set up data quality monitoring alerts
- [ ] Document webhook payload variations

### Low Priority
- [ ] Optimize backfill script performance
- [ ] Add progress indicators to long-running scripts
- [ ] Create admin dashboard for data quality metrics

---

## 📚 Key Documents

**Current Work:**
- [Session State](./docs/session-state-2026-01-25.md) - Where we left off
- [Duplicate Person Investigation](./docs/duplicate-person-investigation.md) - Analysis + solutions

**Completed:**
- [Company ETL Bug Report](./docs/company-etl-bug-report.md)
- [Company ETL Fix Summary](./docs/company-etl-fix-summary.md)

**Reference:**
- [Identity Matching Guide](./docs/identity-matching-guide.md)
- [Testing Rules](./.claude/rules/testing.md)
- [Project Instructions](./.claude/CLAUDE.md)

---

## 🛠️ Useful Scripts

**Analysis:**
- `node scripts/investigate-company-etl.js` - Company ETL diagnostics
- `node scripts/analyze-duplicates.js` - Find duplicate persons

**Recovery:**
- `node scripts/backfill-companies.js --dry-run` - Preview company recovery
- `node scripts/backfill-companies.js --execute` - Execute company recovery

**Monitoring:**
- `npm test` - Run all tests
- `npm run lint` - Check code quality

---

## 🚨 Known Issues

### Active
1. **Duplicate Persons (9,587 records)** - See investigation doc
   - Impact: 40% of person database
   - Root cause: Non-overlapping identifiers
   - Status: Analyzed, awaiting fix

### Resolved
1. ~~Company ETL broken (Jan 6-25)~~ - FIXED Jan 25
2. ~~Location ETL broken (Jan 6-25)~~ - FIXED Jan 25

---

**Quick Start When Resuming:**
1. Read [Session State](./docs/session-state-2026-01-25.md)
2. Review [Duplicate Investigation](./docs/duplicate-person-investigation.md)
3. Choose implementation option
4. Execute fix
