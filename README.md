<p align="center">
   <img src="https://raw.githubusercontent.com/harehimself/duxsoup-etl/master/duxsoup-etl.png">
</p>

<p align="center">
<strong>A canonical LinkedIn extraction and profile-intelligence pipeline.</strong><br><br> 
   
   **DuxSoup ETL** is a production-grade LinkedIn extraction, ingestion, and identity resolution pipeline - designed to safely process real-time extraction webhooks while maintaining a canonical profile model. The system ingests **scan** and **visit** events (via the DuxSoup API) as immutable observations. It resolves identities deterministically, and maintains a continuously updated **People Snapshot** optimized for analytics, CRM enrichment, and graph-based intelligence workflows. The system has been designed for background processing and extensibility. 

Significant controls have been included for safety, such as idempotent ingestion, automatic deduplication, and failure recovery.

   Finally, the system normalizes profile data and is stored in MongoDB Atlas records (documents). A very useful app for lead enrichment, CRM models, and overarching people intelligence.<br>
   <br> 
</p>
<br>

<p align="center">
  <a href="https://github.com/harehimself/duxsoup-etl/graphs/contributors">
    <img src="https://img.shields.io/github/contributors/harehimself/duxsoup-etl" alt="Contributors"></a>
  <a href="https://github.com/harehimself/duxsoup-etl/network/members">
    <img src="https://img.shields.io/github/forks/harehimself/duxsoup-etl" alt="Forks"></a>
  <a href="https://github.com/harehimself/duxsoup-etl/stargazers">
    <img src="https://img.shields.io/github/stars/harehimself/duxsoup-etl" alt="Stars"></a>
  <a href="https://github.com/harehimself/duxsoup-etl/issues">
    <img src="https://img.shields.io/github/issues/harehimself/duxsoup-etl" alt="Issues"></a>
  <a href="https://github.com/harehimself/duxsoup-etl/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/harehimself/duxsoup-etl" alt="MIT License"></a>
</p>

<br><br>

## Table of Contents
- [Table of Contents](#table-of-contents)
- [Features](#features)
- [Benefits](#benefits)
  - [Business Value](#business-value)
  - [Technical Advantages](#technical-advantages)
- [Tech Stack](#tech-stack)
  - [Core Technologies](#core-technologies)
  - [Deployment Platforms](#deployment-platforms)
- [API Reference](#api-reference)
  - [POST /api/webhook](#post-apiwebhook)
  - [GET /api/people/:id](#get-apipeopleid)
  - [GET /api/people/by-alias/:value](#get-apipeopleby-aliasvalue)
  - [GET /api/people/metrics](#get-apipeoplemetrics)
  - [Health](#health)
- [Data Model](#data-model)
- [Architecture \& Data Flow](#architecture--data-flow)
- [Read Modes \& Cutover Strategy](#read-modes--cutover-strategy)
- [Project Structure](#project-structure)
- [Operations \& Debugging](#operations--debugging)
- [License](#license)

<br><br>

## Features

* **Webhook Processing**: Handles DuxSoup LinkedIn data via **`POST /api/webhook`**.
* **Type-Based Routing**: Automatically routes scan vs visit data to appropriate handlers based on the **`type`** field in the payload.
* **Data Validation**: Comprehensive validation for required fields, including a custom validator for the **`id`** field to ensure it's a non-empty string.
* **Error Handling**: Robust error handling with detailed logging using Winston.
* **Production Ready**: Designed for deployment on platforms like Render with health monitoring.
* **Extensible**: Easy to add MongoDB storage and data normalization.
* **MongoDB Storage**: Integrates with MongoDB using Mongoose to persist processed data.
* **Real-time Processing**: Processes LinkedIn data in real-time.
* **Background Jobs**: Built for background processing.
* **Health Monitoring**: Built-in health checks and monitoring.
* **Custom Routing**: Differentiates between scans and visits.
* **Data Normalization**: Normalizes profile data into structured records.

<br><br>

## Benefits

### Business Value
- **Lead Enrichment**: Automatically enriches CRM data with LinkedIn insights for sales and marketing teams
- **Graph-based CRM**: Builds comprehensive relationship graphs for advanced customer relationship management
- **Time Efficiency**: Eliminates manual LinkedIn data collection, saving hours of manual work
- **Data Consistency**: Ensures clean, normalized data across all records with standardized formatting

### Technical Advantages
- **Scalability**: Horizontal scaling ready with stateless architecture
- **Reliability**: 99.9% uptime target with comprehensive error handling
- **Low Maintenance**: Minimal operational overhead with automated health checks
- **Easy Integration**: Simple REST API for third-party integration
- **Comprehensive Monitoring**: Built-in health checks and logging for production environments

<br><br>

## Tech Stack

### Core Technologies
- Node.js 18+
- Express.js 4.x
- MongoDB Atlas
- Mongoose 7.x
- Winston 3.x
- Dotenv 16.x
- cors 2.x
- Jest (unit + integration)
- Nodemon 3.x

### Deployment Platforms
- Render (primary)
- AWS / DigitalOcean / Heroku / Fly.io
- PM2 recommended
- Docker-compatible

<br><br>

## API Reference

### POST /api/webhook
Primary ingestion endpoint.

Example Response:
```json
{
  "stored": true,
  "people_upsert": true,
  "duplicate": false
}
```

### GET /api/people/:id
Fetch canonical person by ID.

### GET /api/people/by-alias/:value
Resolve person by any alias.

### GET /api/people/metrics
Read-path metrics.

### GET /api/companies/:id
Fetch canonical company by ID.

### GET /api/companies/by-alias/:value
Resolve company by alias (CompanyID, profile URL, or name).

### GET /api/locations/:id
Fetch canonical location by ID.

### GET /api/locations/by-alias/:value
Resolve location by alias (raw or normalized).

### Health
- `/health`
- `/api/health/ingestion`
- `/api/health/parity`
- `/api/health/coverage-breakdown`
- `/api/health/canonical-coverage`
- `/api/health/company-coverage`
- `/api/health/location-coverage`
- `/api/health/metrics`

<br><br>

## Data Model

- **Observations**: `visits`, `scans`, `Immutable`, `Idempotent`.
- **People**: One document per person; alias-based identity; role timeline; provenance + metrics.
- **Companies**: Canonical LinkedIn company registry.
- **Dead Letters**: Failed upserts; replayable.
- **Merges**: Identity merge audit trail.

<br><br>

## Architecture & Data Flow

DuxSoup Webhook ➡️ Validation ➡️ Observations ➡️ Identity Resolution ➡️ People Snapshot

<br><br>

## Read Modes & Cutover Strategy

READ_SOURCE:
- legacy
- hybrid
- people

Instant rollback via env change.

<br><br>

## Project Structure

`src/`, `scripts/`, `tests/`, `render.yaml`, `.env.example`

<br><br>

## Operations & Debugging

```bash
node scripts/replayDeadLetters.js
node scripts/rebuildPeople.js
node scripts/linkIdentities.js
node scripts/backfillCanonicalId.js --dry-run
node scripts/backfillCompanyCanonicalId.js --dry-run
node scripts/backfillLocationCanonicalId.js --dry-run
node scripts/dedupeAliases.js --dry-run
```

Set `CANONICAL_ID_NAMESPACE` in your environment before running the backfill to keep UUIDs stable across deployments.
The same value should be used across all environments to keep canonical IDs consistent.

<br><br>

## License

MIT License © 2024 Mike Hare
