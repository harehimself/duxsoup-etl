# /audit-security – Security Posture Audit

Run a comprehensive security audit covering dependency vulnerabilities, hardcoded secrets, CORS configuration, environment file safety, and webhook endpoint exposure.

---

## Overview

This skill performs a multi-layer security check for the DuxSoup ETL system. It checks for common vulnerabilities in a Node.js/Express/MongoDB webhook processing application.

---

## What This Skill Does

Run all checks in order, report findings at the end with severity levels.

### 1. Dependency Vulnerability Scan

```bash
npm audit --json 2>/dev/null
```

Parse the JSON output and report:
- Total vulnerabilities by severity (critical, high, moderate, low)
- Specific packages with known CVEs
- Whether `npm audit fix` would resolve any

If `npm audit` fails, note that and continue.

### 2. Hardcoded Secrets Scan

Search source files for patterns that indicate leaked credentials:

```bash
# Run these searches across src/, scripts/, __tests__/, config/
```

**Patterns to search for:**
- `sk_live`, `sk_test`, `pk_live`, `pk_test` (Stripe keys)
- `AKIA` (AWS access keys)
- `mongodb+srv://` or `mongodb://` with credentials in URL
- `Bearer ` followed by a long token string
- `password\s*[:=]\s*['"]` (hardcoded passwords)
- `secret\s*[:=]\s*['"]` (hardcoded secrets)
- `api[_-]?key\s*[:=]\s*['"]` (hardcoded API keys)
- `token\s*[:=]\s*['"][A-Za-z0-9]` (hardcoded tokens)
- `twilio.*sid|twilio.*token` (Twilio credentials — relevant since twilio is a dependency)
- `nodemailer.*pass` (Email credentials — relevant since nodemailer is a dependency)

**Exclude from scan:**
- `node_modules/`
- `.env*` files (already protected)
- `*.md` documentation files (may reference patterns)
- Test fixtures that use obviously fake values like `test-key`, `fake-token`, `xxx`

Report each match with file path and line number.

### 3. Environment File Safety

Check:
- `.env` is in `.gitignore` — **CRITICAL** if missing
- `.env.*` variants are in `.gitignore`
- No `.env` files are tracked by git: `git ls-files --cached .env .env.*`
- `.env.example` or `.env.template` exists (good practice for documentation)
- If `.env.example` exists, verify it contains no real values (only placeholders)

### 4. CORS Configuration Audit

Read `src/index.js` and check:
- Is CORS configured with an allowlist (not `*`)?
- Is the origin check strict (exact match, not substring)?
- What happens when `ALLOWED_ORIGINS` env var is not set? (Should reject all)
- Are credentials enabled? If so, `*` origin would be a critical issue

Report the current CORS posture.

### 5. Webhook Endpoint Security

Check `src/routes/apiRoutes.js` and related files:
- Is `webhookAuth` middleware applied to `POST /api/webhook`?
- What does `webhookAuth` actually validate? (Read the middleware implementation)
- Is rate limiting configured on the webhook endpoint?
- What is the rate limit value and is it appropriate?
- Is request body size limited? (Check Express JSON middleware config)

### 6. Authentication & Authorization Review

Check for:
- Are admin endpoints protected by auth middleware?
- Is there any route that mutates data without auth?
- Are there any routes that bypass rate limiting?

### 7. MongoDB Security

Check:
- Connection string is read from env var (not hardcoded)
- No `mongoose.set('debug', true)` in production code (leaks queries to logs)
- Mongoose strict mode is enabled (rejects unknown fields)

---

## Output Format

```
=== DuxSoup ETL Security Audit ===

📦 DEPENDENCY VULNERABILITIES
   Critical: N | High: N | Moderate: N | Low: N
   [Details of critical/high findings]

🔑 HARDCODED SECRETS
   [✓ No secrets found | ⚠ N potential secrets detected]
   [File:line details for each finding]

📋 ENVIRONMENT FILES
   [✓ .env in .gitignore | ❌ .env NOT in .gitignore]
   [✓ No .env tracked | ❌ .env is tracked in git]
   [✓ .env.example exists | ⚠ No .env.example]

🌐 CORS CONFIGURATION
   [✓ Strict allowlist | ⚠ Wildcard origin | ❌ No CORS config]
   [Details on origin validation]

🔒 WEBHOOK SECURITY
   [Auth: ✓/❌] [Rate limit: ✓/❌ (N/min)] [Body size limit: ✓/❌]

🛡️ AUTH & AUTHORIZATION
   [✓ Admin routes protected | ❌ Unprotected mutation routes]

🗄️ MONGODB SECURITY
   [✓ Connection from env | ❌ Hardcoded connection string]
   [Debug mode: on/off]

─────────────────────
OVERALL: 🟢 GOOD | 🟡 WARNINGS | 🔴 CRITICAL
Action items: [numbered list of fixes needed]
```

---

## Severity Levels

- **🔴 CRITICAL:** Secrets in source, .env tracked in git, wildcard CORS with credentials, no webhook auth
- **🟡 WARNING:** npm audit moderate findings, missing .env.example, debug mode in production config
- **🟢 GOOD:** No issues found in this category

---

## Usage

```bash
/audit-security              # Full audit
/audit-security --quick      # Dependencies + secrets only (skip config review)
```

### Quick Mode

When `--quick` is passed, only run checks 1 (dependencies) and 2 (secrets scan). Skip configuration review.

---

## Notes

- This skill is read-only — it never modifies code or configuration
- Secrets scan uses pattern matching and may produce false positives in test fixtures
- Always manually verify any flagged "secrets" before treating them as real leaks
- npm audit results depend on the npm registry being reachable
