<p align="center">
  <h1 align="center">DuxSoup ETL</h1>
  <p align="center">
    A canonical LinkedIn extraction and profile-intelligence pipeline.
    <br />
    <a href="docs/RUNBOOK.md"><strong>Runbook</strong></a> &middot;
    <a href="docs/FIELD_REFERENCE.md"><strong>Field Reference</strong></a> &middot;
    <a href="docs/WEBHOOK_PAYLOADS.md"><strong>Webhook Payloads</strong></a> &middot;
    <a href="docs/IDENTITY_MATCHING.md"><strong>Identity Matching</strong></a>
  </p>
</p>

<br />

<p align="center">
  <a href="https://github.com/harehimself/duxsoup-etl/actions/workflows/main.yml">
    <img src="https://github.com/harehimself/duxsoup-etl/actions/workflows/main.yml/badge.svg" alt="CI" />
  </a>
  <a href="https://github.com/harehimself/duxsoup-etl/graphs/contributors">
    <img src="https://img.shields.io/github/contributors/harehimself/duxsoup-etl" alt="Contributors" />
  </a>
  <a href="https://github.com/harehimself/duxsoup-etl/stargazers">
    <img src="https://img.shields.io/github/stars/harehimself/duxsoup-etl" alt="Stars" />
  </a>
  <a href="https://github.com/harehimself/duxsoup-etl/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/harehimself/duxsoup-etl" alt="License" />
  </a>
</p>

<br />

**DuxSoup ETL** processes real-time [DuxSoup](https://www.duxsoup.com/) webhooks (visit and scan events) as immutable observations, resolves identities deterministically, and maintains continuously updated **People**, **Company**, and **Location** snapshots optimized for analytics, CRM enrichment, and intelligence workflows.

<br />

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Identity Resolution](#identity-resolution)
- [Data Models](#data-models)
- [Operations CLI](#operations-cli)
- [Background Jobs](#background-jobs)
- [Notifications & Alerting](#notifications--alerting)
- [Deployment](#deployment)
- [Security](#security)
- [Testing](#testing)
- [Scripts & Migrations](#scripts--migrations)
- [Environment Variables](#environment-variables)
- [Documentation](#documentation)
- [License](#license)

<br />

## Architecture

DuxSoup ETL follows an **Observation-Snapshot** pattern with a dual-write pipeline:

```
                           ┌──────────────────────────────────────────────────┐
                           │              DUAL-WRITE PIPELINE                 │
                           │                                                  │
  ┌──────────┐   Validate  │  ┌──────────────┐         ┌──────────────────┐  │
  │ DuxSoup  │────────────▶│  │   PHASE 1    │         │     PHASE 2      │  │
  │ Webhook  │             │  │              │         │                  │  │
  └──────────┘             │  │  Observation  │────────▶│    Snapshots     │  │
                           │  │  (Immutable)  │         │    (Mutable)     │  │
                           │  │              │         │                  │  │
        200 OK  ◀──────────│  │  Visit/Scan   │         │ Person/Company/  │  │
       on Phase 1          │  │  append-only  │         │ Location upsert  │  │
        success            │  └──────────────┘         └────────┬─────────┘  │
                           │                                    │            │
                           │                  on failure ────────┘            │
                           │                         ▼                       │
                           │                  ┌──────────────┐               │
                           │                  │  Dead Letter  │──▶ Hourly    │
                           │                  │    Queue      │   Replay     │
                           │                  └──────────────┘               │
                           └──────────────────────────────────────────────────┘
```

**Key principles:**

- **Observations** (Visit / Scan) are append-only event logs — never modified, the source of truth for "what we saw."
- **Snapshots** (Person / Company / Location) are the canonical state, updated from observations with strict precedence: _never overwrite with empty values; visit beats scan; newer beats older._
- **Phase 1** (observations) must succeed for a `200` response. **Phase 2** (snapshots) is best-effort with dead-letter recovery.
- **Idempotency** via `event_key` (SHA-1 hash of userid + type + time + id) prevents duplicate processing.

<br />

## Tech Stack

| Layer | Technology | Version |
|:------|:-----------|:--------|
| Runtime | Node.js | 20+ |
| Framework | Express | 5.2 |
| Database | MongoDB (Mongoose) | 9.1 |
| Search | Atlas Search + regex fallback | — |
| Testing | Jest + Supertest | 30.2 |
| Logging | Winston | 3.19 |
| Scheduling | node-cron | 4.2 |
| Notifications | Nodemailer + Twilio | 7.0 / 5.12 |
| Security | Helmet, express-rate-limit, express-mongo-sanitize | — |
| CI/CD | GitHub Actions | — |
| Hosting | Render | — |
| Linting | ESLint + Prettier | 9.39 / 3.8 |
| Git Hooks | Husky + lint-staged | — |

<br />

## Quick Start

```bash
# Clone and install
git clone https://github.com/harehimself/duxsoup-etl.git
cd duxsoup-etl
npm install

# Configure
cp .env.example .env
# Edit .env — at minimum set MONGODB_URI

# Run
npm run dev                 # Start dev server on :3000
npm test                    # Run unit tests
```

| Command | Description |
|:--------|:------------|
| `npm run dev` | Start development server (nodemon) |
| `npm start` | Start production server |
| `npm test` | Run unit tests |
| `npm run test:integration` | Run integration tests |
| `npm run test:all` | Run unit + integration tests |
| `npm run test:coverage` | Generate coverage report |
| `npm run lint` | Run ESLint |

<br />

## Project Structure

```
duxsoup-etl/
├── src/
│   ├── controllers/        # Webhook handlers, snapshot upsert logic, read endpoints
│   ├── models/             # Mongoose schemas (Person, Visit, Scan, Company, Location, ...)
│   ├── routes/             # Express route definitions & rate limiting
│   ├── services/           # Identity resolution, change detection, search, export
│   ├── utils/              # Error classes, validation, parsers, logging
│   ├── workers/            # Background job scheduler & cron jobs
│   ├── middleware/         # Webhook authentication
│   ├── __tests__/          # Integration tests
│   └── index.js            # Application entry point
├── __tests__/              # Unit tests
├── scripts/                # Operational CLI, migrations, backfills, imports
├── docs/                   # Runbook, field reference, webhook payloads, identity matching
├── .claude/                # AI agent instructions & project backlog
├── .github/                # CI workflows, PR template, issue templates, Dependabot
└── .husky/                 # Git pre-commit hooks (lint-staged)
```

<br />

## API Reference

### Webhook Ingestion

| Method | Endpoint | Rate Limit | Description |
|:-------|:---------|:-----------|:------------|
| `POST` | `/api/webhook` | 100/min | Main DuxSoup webhook receiver |

### People

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/people/:id` | Get person by primary ID |
| `GET` | `/api/people/by-alias/:value` | Get person by any known alias |

### Companies

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/companies/:id` | Get company by ID |
| `GET` | `/api/companies/by-alias/:value` | Get company by any known alias |

### Locations

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/locations/:id` | Get location by ID |
| `GET` | `/api/locations/by-alias/:value` | Get location by any known alias |

### Query & Search

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/api/query/people` | Filter, sort, and paginate people |
| `POST` | `/api/query/companies` | Filter, sort, and paginate companies |
| `GET` | `/api/query/help` | Query syntax documentation |
| `GET` | `/api/search/people?q=` | Full-text search (Atlas Search or regex fallback) |

### Export

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/api/export/people/csv` | Create async CSV export job |
| `POST` | `/api/export/people/json` | Create async JSON export job |
| `GET` | `/api/export/status/:jobId` | Poll export job status |
| `GET` | `/api/export/download/:jobId` | Download completed export |

### Change Tracking

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/changes/` | Recent job changes and promotions |
| `GET` | `/api/changes/person/:id` | Change history for a specific person |

### Seniority Analysis

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/seniority/tiers` | Available seniority tier definitions |
| `GET` | `/api/seniority/distribution` | Distribution of people by seniority |
| `GET` | `/api/seniority/by-tier/:tier` | People filtered by seniority tier |
| `GET` | `/api/seniority/analysis` | Detailed seniority analysis |

### Health & Monitoring

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/health` | Basic health check (always 200) |
| `GET` | `/api/health/ingestion` | Webhook-to-snapshot success rate |
| `GET` | `/api/health/parity` | Visit/Scan observation parity |
| `GET` | `/api/health/metrics` | System-wide metrics |
| `GET` | `/api/health/data-quality` | Data quality metrics |
| `GET` | `/api/health/dashboard` | Comprehensive health dashboard |
| `GET` | `/api/health/coverage-breakdown` | Data field coverage analysis |
| `GET` | `/api/health/canonical-coverage` | Canonical ID assignment coverage |
| `GET` | `/api/health/company-coverage` | Company snapshot coverage |
| `GET` | `/api/health/location-coverage` | Location snapshot coverage |

### Admin

| Method | Endpoint | Rate Limit | Description |
|:-------|:---------|:-----------|:------------|
| `POST` | `/api/admin/replay/:observationId` | 10/min | Replay a specific observation |

<br />

## Identity Resolution

Identity resolution uses a **waterfall** strategy to match incoming observations to canonical person records, prioritizing the most stable identifiers:

```
   MOST STABLE                                         LEAST STABLE
       │                                                     │
       ▼                                                     ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Sales Nav ID │──▶│  Numeric ID  │──▶│   Username   │──▶│ Profile URL  │
│  ACwAAA...   │   │  8+ digits   │   │   /in/slug   │   │  (fallback)  │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

Each person maintains an **aliases** array tracking every known identifier (salesNavId, numericId, profileUrl, linkedInUsername, vanityName, duxsoupId, and more). This enables deduplication even when LinkedIn URLs change over time.

When no stable identifier is available, the observation is still written (Phase 1 always succeeds), but the person upsert is skipped with a warning.

See [docs/IDENTITY_MATCHING.md](docs/IDENTITY_MATCHING.md) for the full resolution strategy.

<br />

## Data Models

The system maintains **10 MongoDB collections**:

| Collection | Type | Purpose |
|:-----------|:-----|:--------|
| **Person** | Snapshot | Canonical person profile with roles, education, skills, seniority |
| **Company** | Snapshot | Canonical company profile with industry, size, location |
| **Location** | Snapshot | Normalized location with structured city/state/country |
| **Visit** | Observation | Immutable DuxSoup visit event log |
| **Scan** | Observation | Immutable DuxSoup scan event log |
| **DeadLetter** | Recovery | Failed Phase 2 upserts queued for hourly replay |
| **Change** | Intelligence | Detected job changes, promotions, and title changes |
| **Merge** | Audit | Audit trail for duplicate person merges (supports rollback) |
| **ExportJob** | Operational | Async CSV/JSON export job tracking |

### Provenance Tracking

Every snapshot field carries metadata recording where the value came from:

```json
{
  "_meta": {
    "currentTitle": {
      "value": "VP of Engineering",
      "observedAt": "2026-02-06T12:00:00Z",
      "source": "visit",
      "observationId": "507f1f77bcf86cd799439011"
    }
  }
}
```

See [docs/FIELD_REFERENCE.md](docs/FIELD_REFERENCE.md) for the complete field mapping from webhooks through observations to snapshots.

<br />

## Operations CLI

An interactive CLI handles common operational tasks:

```bash
npm run ops -- --help               # List all commands
npm run ops merge-duplicates        # Find and merge duplicate people
npm run ops link-orphans            # Link orphaned observations to people
npm run ops health-check            # Run database health check
npm run ops migrate-url-ids         # Migrate URL-based IDs to stable IDs
```

Additional shortcuts:

```bash
npm run ops:merge                   # Merge duplicates
npm run ops:link-orphans            # Link orphaned observations
npm run ops:migrate-ids             # Migrate URL-based IDs
npm run ops:rollback-merge          # Rollback a person merge
```

See [docs/RUNBOOK.md](docs/RUNBOOK.md) for detailed operational guidance.

<br />

## Background Jobs

The scheduler runs automatically when `ENABLE_SCHEDULER` is not `false`:

| Job | Schedule | Description |
|:----|:---------|:------------|
| Dead Letter Replay | Hourly (`0 * * * *`) | Retries failed person/company/location upserts |
| Health Check | Every 6 hours (`0 */6 * * *`) | Runs health assessment, triggers alerts if thresholds exceeded |

**Multi-instance safety:** A MongoDB-backed leader-election lock ensures only one instance runs cron jobs, preventing duplicate work in horizontally scaled deployments.

<br />

## Notifications & Alerting

Health check jobs trigger alerts via **email** (Nodemailer/SMTP) and **SMS** (Twilio) when thresholds are breached:

| Condition | Severity |
|:----------|:---------|
| Dead letter backlog > 100 pending | Warning |
| Dead letters failing replay > 10 | Critical |
| Person upsert success rate < 95% | Warning |
| Person upsert success rate < 90% | Critical |

Configure via `SMTP_*` and `TWILIO_*` environment variables. Test delivery with `GET /api/health/test-notifications`.

<br />

## Deployment

### Render (Default)

The project ships with a `render.yaml` for one-click deploy on [Render](https://render.com/):

```yaml
services:
  - type: web
    name: duxsoup-etl
    env: node
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /health
```

The server starts HTTP immediately (before the database connects) so Render health checks pass during cold starts. Database connection happens asynchronously in the background.

### CI/CD

GitHub Actions runs on every push and PR to `main`:

1. Install dependencies (`npm ci`)
2. Run tests with coverage (`npm run test:coverage`)
3. Run linting (`npm run lint`)
4. Dependency vulnerability scan (`npm audit`)

<br />

## Security

Defense-in-depth across multiple layers:

| Layer | Mechanism |
|:------|:----------|
| **Rate Limiting** | 3 tiers — 100/min (webhook), 60/min (read APIs), 10/min (admin) |
| **Input Validation** | Payload schema validation before any processing |
| **NoSQL Injection** | `express-mongo-sanitize` on body, query, and params |
| **Security Headers** | Helmet with strict defaults |
| **Idempotency** | SHA-1 `event_key` prevents duplicate webhook processing |
| **CORS** | Restrictive by default; requires explicit `ALLOWED_ORIGINS` |
| **Webhook Auth** | Shared secret via header, bearer token, or query param |
| **Fail-Closed** | Production rejects requests if `WEBHOOK_SECRET` is not set |
| **Compression** | Response compression via `compression` middleware |
| **Dependency Scanning** | Dependabot + `npm audit` in CI |

See [SECURITY.md](SECURITY.md) for the vulnerability reporting policy.

<br />

## Testing

```bash
npm test                            # Unit tests (5s timeout)
npm run test:integration            # Integration tests (30s timeout)
npm run test:all                    # Both suites
npm run test:coverage               # Coverage report (30% threshold)
npm run test:watch                  # Watch mode
npm test -- path/to/file.test.js    # Single file
```

Tests are organized as:
- **Unit tests** (`__tests__/`) — Fast, isolated, mock external dependencies
- **Integration tests** (`src/__tests__/`) — End-to-end with database operations

Pre-commit hooks (Husky + lint-staged) enforce ESLint and Prettier on every commit.

<br />

## Scripts & Migrations

All migration scripts default to **dry-run mode** for safety. Remove `--dry-run` to execute.

| Script | Command | Description |
|:-------|:--------|:------------|
| Backfill Canonical IDs | `npm run backfill:canonical-id` | Add deterministic UUIDs to Person records |
| Backfill Company IDs | `npm run backfill:company-id` | Add canonical IDs to Company records |
| Backfill Location IDs | `npm run backfill:location-id` | Add canonical IDs to Location records |
| Backfill Seniority | `npm run backfill:seniority` | Parse and assign seniority tiers from titles |
| Rebuild Companies | `npm run rebuild:companies` | Rebuild Company collection from observations |
| Rebuild Locations | `npm run rebuild:locations` | Rebuild Location collection from observations |
| Migrate Locations | `npm run migrate:locations` | Migrate location schema structure |
| Dedupe Aliases | `npm run dedupe:aliases` | Remove duplicate alias entries |
| Import CSV Visits | `npm run import:csv` | Bulk import visits from CSV |

<br />

## Environment Variables

### Required

| Variable | Description |
|:---------|:------------|
| `MONGODB_URI` | MongoDB connection string |

### Application

| Variable | Default | Description |
|:---------|:--------|:------------|
| `NODE_ENV` | `development` | `development` or `production` |
| `PORT` | `3000` | Server port |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowed origins (comma-separated) |
| `WEBHOOK_SECRET` | — | Shared secret for webhook and admin authentication |
| `WEBHOOK_RATE_LIMIT` | `100` | Max webhook requests per minute |
| `ENABLE_SCHEDULER` | `true` | Enable background cron jobs |
| `CANONICAL_ID_NAMESPACE` | — | UUID v5 namespace for deterministic canonical IDs |

### Multi-Instance

| Variable | Default | Description |
|:---------|:--------|:------------|
| `INSTANCE_ID` | — | Unique instance identifier for leader election |
| `LEADER_LOCK_TTL_SECONDS` | `30` | Leader lock time-to-live |
| `LEADER_RENEW_INTERVAL_SECONDS` | `10` | Leader lock renewal interval |

### Notifications

| Variable | Description |
|:---------|:------------|
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port (typically 587) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_SECURE` | Use TLS (`true`/`false`) |
| `ALERT_EMAIL_FROM` | Sender address for alerts |
| `ALERT_EMAIL_TO` | Recipient address for alerts |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM_NUMBER` | Twilio sender phone number |
| `TWILIO_TO_NUMBER` | SMS alert recipient phone number |

### Logging

| Variable | Default | Description |
|:---------|:--------|:------------|
| `LOG_SAMPLE_RATE` | `0.1` | Fraction of debug logs emitted in production (0.0–1.0) |

<br />

## Documentation

| Document | Description |
|:---------|:------------|
| [Runbook](docs/RUNBOOK.md) | Operational procedures, troubleshooting, maintenance |
| [Field Reference](docs/FIELD_REFERENCE.md) | Complete field mapping: webhook &rarr; observation &rarr; snapshot |
| [Identity Matching](docs/IDENTITY_MATCHING.md) | Identity resolution strategy and alias handling |
| [Webhook Payloads](docs/WEBHOOK_PAYLOADS.md) | Sample DuxSoup visit and scan payloads |
| [Migration Guide](docs/MIGRATION_GUIDE.md) | Schema migration procedures |
| [Security Policy](SECURITY.md) | Vulnerability reporting and security practices |

<br />

## License

MIT License &copy; 2025 [Mike Hare](https://github.com/harehimself)
