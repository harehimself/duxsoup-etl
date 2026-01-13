# Custom Skills & Slash Commands

This document lists all custom slash commands available for this project. These commands streamline common workflows specific to the DuxSoup ETL system.

## Quick Reference

| Command | Purpose | Common Use Case |
|---------|---------|-----------------|
| `/debug-person` | Find and inspect person records | Debugging identity issues |
| `/identity-lookup` | Resolve LinkedIn identity | Understanding ID resolution |
| `/check-health` | Database health check | Daily data quality monitoring |
| `/test-commit` | Test → Commit workflow | TDD workflow enforcement |
| `/replay-dead-letters` | Replay failed observations | Recovery after bug fixes |
| `/quick-query` | Ad-hoc MongoDB queries | Quick data exploration |
| `/scaffold-script` | Generate new scripts | Creating analysis scripts |

---

## 📋 /debug-person

**Find and inspect a person by any identifier**

```bash
/debug-person <identifier>
```

**Use when:**
- Debugging "person not found" issues
- Verifying identity resolution worked correctly
- Checking what observations exist for a person
- Understanding alias mapping

**Examples:**
```bash
/debug-person riya-thosar
/debug-person ACoAAAOp_GgBB5xIe1UsUcokRenyVryVDfOYAfI
/debug-person linkedin.com/in/mahesh-chandra-wipro
/debug-person 123456789
```

**Output includes:**
- All aliases (by type)
- Current snapshot summary
- Observation counts (visits/scans)
- Last observed date
- Recent observations

---

## 🔍 /identity-lookup

**Resolve LinkedIn identity from any identifier**

```bash
/identity-lookup <identifier>
```

**Use when:**
- Need to find the canonical ID for a person
- Understanding which identifier to use in code
- Learning how identity resolution works
- Troubleshooting duplicate person records

**Examples:**
```bash
/identity-lookup www.linkedin.com/in/john-doe
/identity-lookup ACoAAAABCDEF
```

**Output includes:**
- Step-by-step resolution process
- All known aliases with stability ratings
- Recommended identifier to use
- Educational explanations of why certain IDs are preferred

---

## 🏥 /check-health

**Run comprehensive data health checks**

```bash
/check-health [--detailed]
```

**Use when:**
- Daily/weekly data quality monitoring
- After running migrations or bulk imports
- Before important demos or reports
- Investigating system-wide issues

**Examples:**
```bash
/check-health                # Quick overview
/check-health --detailed     # Include samples and investigation queries
```

**Checks performed:**
- Identity issues (missing IDs, unstable IDs, duplicates)
- Data quality (missing critical fields, orphaned observations)
- Dead letters (pending, failed, error types)
- Recent activity metrics
- Role timeline anomalies

**Output priority levels:**
- 🟢 GOOD: < 5% issues
- 🟡 WARNING: 5-10% issues or > 100 dead letters
- 🔴 CRITICAL: > 10% identity issues

---

## ✅ /test-commit

**TDD workflow: test, then commit**

```bash
/test-commit [test-path] [commit-message]
```

**Use when:**
- Following TDD discipline (mandated by project rules)
- Ensuring tests pass before committing
- Quick commit workflow

**Examples:**
```bash
/test-commit                                         # All tests → commit
/test-commit src/__tests__/person.test.js            # Specific test
/test-commit . "Fix: person identity validation"     # With message
```

**Workflow:**
1. Run tests
2. If PASS → proceed to commit
3. If FAIL → block commit, show failures
4. Auto-add attribution and co-author

**Enforces:**
- Testing.md requirements
- Commit message format
- Attribution standards
- Git hook compliance

---

## 🔄 /replay-dead-letters

**Replay failed observations after fixes**

```bash
/replay-dead-letters [--limit N] [--dry-run] [--filter TYPE]
```

**Use when:**
- After fixing identity resolution bugs
- Recovering from database outages
- Validating fixes work on real data
- Cleaning up dead letter queue

**Examples:**
```bash
/replay-dead-letters                    # Replay all pending
/replay-dead-letters --limit 10         # First 10 only
/replay-dead-letters --dry-run          # Simulate without committing
/replay-dead-letters --filter scan      # Only scan observations
```

**Output includes:**
- Success/failure counts
- Detailed results per observation
- Still-failing records with new errors
- Suggested next actions

**Safety features:**
- Dry-run mode for testing
- Limit controls to prevent overwhelming DB
- Transaction support
- Preserves original error for comparison

---

## ⚡ /quick-query

**Run ad-hoc MongoDB queries in natural language**

```bash
/quick-query <natural language query>
```

**Use when:**
- Quick data exploration
- Answering "how many..." questions
- Finding specific records
- Aggregating statistics

**Examples:**
```bash
/quick-query how many people work at Google?
/quick-query show me people added in the last 7 days
/quick-query most common job titles
/quick-query people without Sales Nav IDs
/quick-query recent visits
/quick-query people in San Francisco
```

**Capabilities:**
- Counts and aggregations
- Filtering and search
- Recent/latest queries
- Sorted results with limits

**Safety:**
- Default 20 result limit
- Warns on potentially slow queries
- Read-only operations

---

## 🏗️ /scaffold-script

**Generate a new data script with boilerplate**

```bash
/scaffold-script <script-name> <description>
```

**Use when:**
- Creating new analysis scripts
- Building migration scripts
- Implementing data quality checks
- Importing external data

**Examples:**
```bash
/scaffold-script checkMissingEmails "Find people without email addresses"
/scaffold-script migrateTitles "Normalize job titles to standard format"
/scaffold-script importLinkedInData "Import external LinkedIn data from CSV"
/scaffold-script analyzeCompanyGrowth "Track company headcount over time"
```

**Generated script includes:**
- Database connection boilerplate
- Proper error handling
- Dry-run support
- Project conventions (async/await, imports, etc.)
- Helpful comments and structure

**Also creates:**
- NPM script in package.json
- Permission in .claude/settings.local.json

---

## Common Workflows

### Daily Data Quality Check
```bash
/check-health
```

### Debug a Person Not Found Issue
```bash
/identity-lookup linkedin.com/in/username
/debug-person username
```

### After Fixing an Identity Bug
```bash
/replay-dead-letters --limit 10 --dry-run   # Test with 10
/replay-dead-letters                        # Replay all
/check-health                               # Verify improvement
```

### TDD Development Cycle
```bash
# 1. Write test
# 2. Write code
/test-commit src/__tests__/feature.test.js "Add: new feature"
```

### Quick Data Exploration
```bash
/quick-query how many observations in the last 24 hours?
/quick-query show people at Amazon
/quick-query most common companies
```

### Create New Analysis
```bash
/scaffold-script analyzeNewFeature "Analyze adoption of new feature"
# Edit the generated script
node scripts/analyzeNewFeature.js --dry-run
```

---

## Notes

- All commands follow the Observation-Snapshot pattern from CLAUDE.md
- Identity resolution uses Sales Navigator ID → Numeric ID → Username priority
- All database operations respect the canonical_id field
- Error handling uses AppError class with proper codes
- All scripts support graceful database disconnection

## Extending These Skills

To add new skills:

1. Create a new `.md` file in `.claude/skills/`
2. Follow the template structure from existing skills
3. Document usage, examples, and output format
4. Add permissions to `.claude/settings.local.json` if needed
5. Update this SKILLS.md file

---

**See individual skill files in `.claude/skills/` for detailed implementation instructions.**
