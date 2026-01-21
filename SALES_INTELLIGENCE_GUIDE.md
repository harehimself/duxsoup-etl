# DuxSoup ETL - Sales Intelligence Features Guide

## Overview

The DuxSoup ETL system has been enhanced with comprehensive sales intelligence capabilities, transforming it from a data collection system into an actionable sales prospecting platform.

## New Features

### Phase 1: Search & Discovery

#### 1. Query API
Flexible filtering and querying of people and companies.

**Endpoints:**
- `POST /api/query/people` - Query people with filters
- `POST /api/query/companies` - Query companies (aggregated from people)
- `GET /api/query/help` - Get query documentation and examples

**Example: Find VPs at Google in San Francisco**
```bash
curl -X POST http://localhost:3000/api/query/people \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "snapshot.currentTitle": {"$regex": "VP|Director", "$options": "i"},
      "snapshot.currentCompany": "Google",
      "snapshot.city": "San Francisco"
    },
    "sort": {"snapshot.connections": -1},
    "limit": 50
  }'
```

**Supported Filters:**
- Title, company, location (city, state, country)
- Connections range
- Lead score
- Skills, education, industry
- Logical operators: `$and`, `$or`
- Comparison operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$regex`

#### 2. Full-Text Search
Google-like search across names, titles, and companies.

**Endpoint:**
- `GET /api/search?q=<query>&limit=<limit>`

**Example:**
```bash
curl "http://localhost:3000/api/search?q=john+doe+google&limit=20"
```

**Features:**
- Weighted relevance scoring (names > titles > companies)
- Fuzzy matching fallback for partial matches
- Case-insensitive search

#### 3. Export to CSV/JSON
Export prospect lists for CRM import or analysis.

**Endpoints:**
- `POST /api/export/people/csv` - Export to CSV
- `POST /api/export/people/json` - Export to JSON
- `GET /api/export/status/:jobId` - Check export status
- `GET /api/export/download/:jobId` - Download export file

**Example: Export engineers to CSV**
```bash
# Create export job
curl -X POST http://localhost:3000/api/export/people/csv \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {"snapshot.currentTitle": {"$regex": "Engineer"}},
    "fields": ["firstName", "lastName", "currentTitle", "currentCompany", "email", "phone"]
  }'

# Response: {"jobId": "abc-123", "statusUrl": "/api/export/status/abc-123"}

# Check status
curl http://localhost:3000/api/export/status/abc-123

# Download when completed
curl http://localhost:3000/api/export/download/abc-123 -o prospects.csv
```

**Default CSV Fields:**
- firstName, lastName, currentTitle, currentCompany
- city, state, country
- email, phone, linkedInUrl
- connections, industry, lastObservedAt

### Phase 2: Sales Intelligence

#### 4. Job Change Detection
Automatically detect when people change jobs, get promoted, or change titles.

**Endpoints:**
- `GET /api/changes?type=<type>&days=<days>&limit=<limit>` - Get recent changes
- `GET /api/changes/person/:id` - Get changes for specific person

**Change Types:**
- `company_change` - Job switch (changed companies)
- `promotion` - Title upgrade at same company
- `title_change` - Title modification

**Example: Get job changes in last 30 days**
```bash
curl "http://localhost:3000/api/changes?type=company_change&days=30&limit=100"
```

**Features:**
- Automatic detection during person updates
- Seniority upgrade detection (Junior → Senior → Manager → Director → VP → C-level)
- Change deduplication
- Timestamp tracking

#### 5. Lead Scoring
Automatically prioritize high-value prospects.

**Scoring Logic (max 100 points):**
- **Seniority** (0-30 points):
  - C-level: 30
  - VP: 25
  - Director: 20
  - Head/Lead: 15
  - Manager: 10
  - Senior: 5
- **Company** (0-25 points):
  - Fortune 500/tech giants: 25
  - Tech companies: 15
- **Influence** (0-20 points):
  - 1000+ connections: 20
  - 500+ connections: 10
  - 100+ connections: 5
- **Data Completeness** (0-25 points):
  - Has email: 15
  - Has phone: 10

**Segments:**
- `high_value`: leadScore >= 70
- `decision_maker`: VP/Director/C-level titles
- `warm_lead`: Job change in last 30 days
- `needs_enrichment`: Missing email/phone
- `standard`: Everyone else

**Endpoints:**
- `GET /api/segments/high-value?limit=<limit>` - High-value prospects
- `GET /api/segments/decision-makers?limit=<limit>` - Decision makers
- `GET /api/segments/warm-leads?limit=<limit>` - Recent job changes
- `GET /api/segments/needs-enrichment?limit=<limit>` - Missing contact data
- `POST /api/segments/recalculate` - Trigger score recalculation

**Example: Get high-value prospects**
```bash
curl "http://localhost:3000/api/segments/high-value?limit=50"
```

**Lead scores are automatically calculated during person updates.**

#### 6. Slack Alerts
Proactive notifications for high-value job changes.

**Alert Triggers:**
- High-priority: VP/Director+ with 500+ connections changing jobs
- Medium-priority: Company changes and promotions
- Low-priority: Other title changes (not sent)

**Alert Format:**
```
🎯 High-Value Lead Alert: Job Change
John Doe (VP Engineering) just joined Google

Previous: Director at Meta
Current: VP at Google

Connections: 1,200
Location: San Francisco, CA

Priority: HIGH | Person ID: `ACwAAA...`
```

**Configuration:**
Set `SLACK_WEBHOOK_URL` environment variable to enable alerts.

### Phase 3: Automation

#### 7. Background Job Scheduler
Automates recurring operational tasks.

**Scheduled Jobs:**
- **Dead Letter Replay**: Every 1 hour (limit: 100 records/run)
- **Health Check**: Every 6 hours with Slack alerts
- **Lead Scoring Update**: Daily at 2am
- **Pending Alerts**: Every 15 minutes

**Enable/Disable:**
Set `ENABLE_SCHEDULER=false` to disable (default: enabled)

#### 8. Automated Health Monitoring
Proactive monitoring with Slack alerts.

**Alert Conditions:**
- **CRITICAL**: >10% people missing canonical_id
- **CRITICAL**: >100 pending dead letters
- **WARNING**: >50 failed_again dead letters

**Alert Format:**
```
🚨 DuxSoup ETL Health Alert: CRITICAL

Critical Issues:
• 127 pending dead letters (threshold: 100)
  Recommendation: Investigate dead letter causes and replay

Metrics:
Total People: 12,345
Pending Dead Letters: 127
Canonical ID Coverage: 91.8%

Checked at: 2026-01-21 14:30:00
```

## Environment Variables

Add these to your `.env` file:

```bash
# Background Job Scheduler
ENABLE_SCHEDULER=true
DEAD_LETTER_REPLAY_INTERVAL=60        # Minutes
HEALTH_CHECK_INTERVAL=360             # Minutes

# Slack Alerting
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
ALERT_MIN_LEAD_SCORE=70               # Min score for alerts

# Export Configuration
EXPORT_TEMP_DIR=/tmp/duxsoup-exports
EXPORT_MAX_ROWS=100000                # Max rows per export
EXPORT_TTL_HOURS=24                   # Download link expiration
```

## Database Schema Changes

### Person Model (Updated)
```javascript
{
  // ... existing fields ...

  derived: {
    avgTenureMonths: Number,
    yearsAtCurrentCompany: Number,
    // NEW: Lead scoring fields
    leadScore: Number,              // 0-100
    segment: String,                // high_value, decision_maker, etc.
    scoreUpdatedAt: Date
  }
}

// NEW: Text search index
personSchema.index({
  "snapshot.fullName": "text",
  "snapshot.currentTitle": "text",
  "snapshot.currentCompany": "text"
}, {
  weights: {
    "snapshot.fullName": 10,
    "snapshot.currentTitle": 5,
    "snapshot.currentCompany": 3
  }
});
```

### New Models

#### Change Model
```javascript
{
  type: String,                    // company_change, promotion, title_change
  person_id: String,               // Reference to Person
  personSnapshot: Object,          // Snapshot at time of change
  from: String,                    // Old company/title
  to: String,                      // New company/title
  company: String,                 // For promotions
  timestamp: Date,
  notified: Boolean,
  notifiedAt: Date
}
```

#### ExportJob Model
```javascript
{
  _id: String,                     // UUID
  format: String,                  // csv, json
  status: String,                  // pending, processing, completed, failed
  filters: Object,                 // Query filters
  fields: [String],                // Fields to export
  result: {
    filePath: String,
    fileSize: Number,
    rowCount: Number,
    downloadUrl: String
  },
  expiresAt: Date                  // TTL index
}
```

## API Reference

### Query API

#### POST /api/query/people
Query people with flexible filters.

**Request:**
```json
{
  "filters": {
    "snapshot.currentTitle": {"$regex": "VP"},
    "snapshot.connections": {"$gte": 500}
  },
  "sort": {"snapshot.connections": -1},
  "limit": 100,
  "skip": 0,
  "fields": ["snapshot.fullName", "snapshot.currentTitle", "snapshot.currentCompany"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [...],
    "metadata": {
      "count": 50,
      "totalCount": 250,
      "limit": 100,
      "skip": 0,
      "hasMore": true,
      "nextSkip": 100
    }
  }
}
```

#### POST /api/query/companies
Query companies (aggregated from people).

**Request:**
```json
{
  "filters": {"snapshot.city": "San Francisco"},
  "limit": 50
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "companyName": "Google",
        "companyId": "1441",
        "employeeCount": 125,
        "avgConnections": 850,
        "cities": ["San Francisco", "Mountain View"],
        "industries": ["Technology"],
        "employees": [...]
      }
    ]
  }
}
```

### Search API

#### GET /api/search
Full-text search across people.

**Query Parameters:**
- `q`: Search query (required)
- `limit`: Result limit (default: 20, max: 100)
- `skip`: Results to skip (pagination)
- `fields`: Comma-separated list of fields to return

**Example:**
```bash
GET /api/search?q=john+doe+google&limit=20
```

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [...],
    "metadata": {
      "query": "john doe google",
      "count": 5,
      "totalCount": 5,
      "fuzzy": false
    }
  }
}
```

### Change Detection API

#### GET /api/changes
Get recent job changes, promotions, and title changes.

**Query Parameters:**
- `type`: Change type (company_change, promotion, title_change)
- `days`: Days to look back (default: 30)
- `limit`: Result limit (default: 100, max: 1000)

**Response:**
```json
{
  "success": true,
  "data": {
    "changes": [
      {
        "_id": "...",
        "type": "company_change",
        "person_id": "ACwAAA...",
        "personSnapshot": {
          "fullName": "John Doe",
          "currentTitle": "VP Engineering",
          "currentCompany": "Google",
          "connections": 1200,
          "city": "San Francisco"
        },
        "from": "Meta",
        "to": "Google",
        "timestamp": "2026-01-15T10:30:00Z",
        "notified": true
      }
    ],
    "metadata": {
      "count": 1,
      "type": "company_change",
      "days": 30
    }
  }
}
```

## Testing

Run integration tests:
```bash
npm test -- __tests__/integration/salesIntelligence.test.js
```

Test coverage includes:
- Query API filtering and sorting
- Full-text search
- Change detection (company changes, promotions)
- Lead scoring calculations
- Segment endpoints
- Export job creation

## Performance Considerations

### Indexes
All critical queries are indexed:
- Text search: `personSchema.index({ "snapshot.fullName": "text", ... })`
- Lead scores: `derived.leadScore`
- Segments: `derived.segment`
- Changes: `{ type: 1, timestamp: -1 }`
- Aliases: `{ "aliases.value": 1 }`

### Query Limits
- Query API: Max 1000 results per request
- Search API: Max 100 results per request
- Export: Max 100,000 rows per export
- Change detection: Automatic deduplication

### Background Jobs
- Dead letter replay: Max 100 records/hour
- Lead scoring: Batch processing (100 people/batch)
- Alert processing: Max 100 alerts per 15 minutes

## Troubleshooting

### Slack Alerts Not Working
1. Verify `SLACK_WEBHOOK_URL` is set correctly
2. Check logs for Slack API errors
3. Ensure changes meet alert criteria (high/medium priority only)

### Export Jobs Failing
1. Check `EXPORT_TEMP_DIR` exists and is writable
2. Verify export doesn't exceed `EXPORT_MAX_ROWS`
3. Check disk space availability

### Scheduler Not Running
1. Verify `ENABLE_SCHEDULER=true` (or not set)
2. Check server logs for scheduler startup messages
3. Ensure cron patterns are valid

### Lead Scores Not Updating
1. Check person upsert logs for scoring errors
2. Run manual recalculation: `POST /api/segments/recalculate`
3. Verify `derived` field exists on Person model

## Future Enhancements

### Phase 4: Advanced Automation (Planned)
- Orphaned observation linking (automated)
- Duplicate detection & auto-merge (scheduled)
- URL-to-stable-ID migration (automated)

### Phase 5: External Integration (Planned)
- Outbound webhooks (Zapier, Make)
- CRM enrichment API
- HubSpot/Salesforce integration

### Phase 6: Advanced Analytics (Planned)
- Company intelligence (growth tracking)
- Skills analytics (trending skills)
- Network analysis (relationship graphs)
- Time-series analytics (hiring trends)

## Support

For issues or questions:
- Check server logs: `tail -f logs/combined.log`
- Review health metrics: `GET /api/health`
- Run health check: Check scheduler logs for automated health checks

## Version

Sales Intelligence Enhancement - v1.0
Implemented: January 2026
