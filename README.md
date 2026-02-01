# DuxSoup ETL

A canonical LinkedIn extraction and profile-intelligence pipeline.

**DuxSoup ETL** processes real-time DuxSoup webhooks (scan and visit events) as immutable observations, resolves identities deterministically, and maintains a continuously updated People Snapshot optimized for analytics, CRM enrichment, and intelligence workflows.

[![Contributors](https://img.shields.io/github/contributors/harehimself/duxsoup-etl)](https://github.com/harehimself/duxsoup-etl/graphs/contributors)
[![Stars](https://img.shields.io/github/stars/harehimself/duxsoup-etl)](https://github.com/harehimself/duxsoup-etl/stargazers)
[![License](https://img.shields.io/github/license/harehimself/duxsoup-etl)](https://github.com/harehimself/duxsoup-etl/blob/main/LICENSE)

## Tech Stack

Node.js 20+ &middot; Express 5 &middot; MongoDB (Mongoose 9) &middot; Jest 30 &middot; Winston &middot; node-cron

## Quick Start

```bash
cp .env.example .env        # configure MONGODB_URI
npm install
npm run dev                  # start dev server on :3000
npm test                     # run unit tests
```

## Architecture

```
DuxSoup Webhook → Validation → Observations (immutable) → Identity Resolution → Snapshots (mutable)
```

- **Observations** (Visit/Scan): Append-only event logs. Never modified.
- **Snapshots** (Person/Company/Location): Canonical state, updated with precedence rules.
- **Identity Resolution**: Sales Navigator ID > Numeric ID > Profile URL.
- **Dual-Write**: Phase 1 (observations) must succeed for 200. Phase 2 (snapshots) is best-effort with dead-letter recovery.

## API

| Endpoint | Description |
|----------|-------------|
| `POST /api/webhook` | Main ingestion (routes to visit/scan handler) |
| `GET /api/people/:id` | Person by ID |
| `GET /api/people/by-alias/:value` | Person by any alias |
| `GET /api/companies/:id` | Company by ID |
| `GET /api/locations/:id` | Location by ID |
| `GET /api/query/people` | Filter/search people |
| `GET /api/export/people` | CSV/JSON export |
| `GET /health` | Health check |
| `GET /api/health/metrics` | System metrics |

## Project Structure

```
src/
├── controllers/    # Webhook handlers, snapshot upsert logic
├── models/         # Mongoose schemas (person, visit, scan, company, location, etc.)
├── routes/         # API route definitions
├── services/       # Identity resolution, change detection, search
├── utils/          # Error classes, validation, ID extraction, logging
└── workers/        # Background job scheduler
scripts/            # Operational CLI and maintenance scripts
docs/               # Runbook, field reference, webhook payloads
__tests__/          # Unit and integration tests
```

## Operations

Use the CLI for operational tasks:

```bash
npm run ops -- --help               # list all commands
npm run ops merge-duplicates        # find and merge duplicate people
npm run ops link-orphans            # link orphaned observations
npm run ops health-check            # database health check
```

See [docs/RUNBOOK.md](docs/RUNBOOK.md) for detailed operational guidance.

## License

MIT License &copy; 2024 Mike Hare
