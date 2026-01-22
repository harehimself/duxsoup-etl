# DuxSoup ETL - Sales Intelligence Features

## Implemented Features

### Phase 1: Search & Discovery ✅

#### 1. Query API
**Endpoints:**
- `POST /api/query/people` - Query people with flexible filters
- `POST /api/query/companies` - Query companies (aggregated from people)
- `GET /api/query/help` - Get query documentation

**Features:**
- MongoDB query operators ($regex, $gte, $and, $or, etc.)
- Sorting and pagination
- Field selection
- Validation and injection prevention

**Example:**
```bash
curl -X POST http://localhost:3000/api/query/people \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {"snapshot.currentTitle": {"$regex": "VP"}},
    "limit": 10
  }'
```

#### 2. Full-Text Search
**Endpoint:**
- `GET /api/search?q=<query>&limit=<limit>`

**Features:**
- Weighted text index (names > titles > companies)
- Fuzzy matching fallback
- Relevance scoring

**Example:**
```bash
curl "http://localhost:3000/api/search?q=engineer&limit=10"
```

#### 3. Export to CSV/JSON
**Endpoints:**
- `POST /api/export/people/csv` - Export to CSV
- `POST /api/export/people/json` - Export to JSON
- `GET /api/export/status/:jobId` - Check export status
- `GET /api/export/download/:jobId` - Download export file

**Features:**
- Async job processing
- Configurable fields
- Filter support
- Auto-expiring downloads (24h TTL)

**Example:**
```bash
curl -X POST http://localhost:3000/api/export/people/csv \
  -H "Content-Type: application/json" \
  -d '{"filters":{"snapshot.connections":{"$gte":500}},"fields":["fullName","currentTitle","email"]}'
```

### Phase 2: Change Detection ✅

#### Job Change Detection
**Endpoints:**
- `GET /api/changes?type=<type>&days=<days>&limit=<limit>` - Get recent changes
- `GET /api/changes/person/:id` - Get changes for specific person

**Change Types:**
- `company_change` - Job switch
- `promotion` - Title upgrade at same company
- `title_change` - Title modification

**Features:**
- Automatic detection during person updates
- Seniority upgrade detection
- Change deduplication
- Timestamp tracking

**Example:**
```bash
curl "http://localhost:3000/api/changes?type=company_change&days=30&limit=10"
```

### Phase 3: Automation ✅

#### Background Job Scheduler
**Jobs:**
- Dead letter replay: Every 1 hour (limit: 100 records/run)
- Health check: Every 6 hours

**Configuration:**
```bash
ENABLE_SCHEDULER=true  # Enable/disable scheduler
```

#### Health Monitoring
**Features:**
- Automated health checks every 6 hours
- Checks canonical ID coverage, dead letter backlog
- Email + SMS alerts for issues

**Alert Conditions:**
- CRITICAL: >10% people missing canonical_id
- CRITICAL: >100 pending dead letters
- WARNING: >50 failed_again dead letters

**Notification Behavior:**
- 📧 **Email**: Sent for all warnings and critical issues (detailed HTML report)
- 📱 **SMS**: Sent for critical issues only (brief alert)
- Test endpoint: `POST /api/admin/test-notifications`

See `NOTIFICATION_SETUP.md` for configuration guide.

## Database Schema Changes

### Person Model
```javascript
// Text search index added
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
  notified: Boolean
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
  expiresAt: Date                  // TTL index (auto-delete after 24h)
}
```

## Environment Variables

```bash
# Server
PORT=3000
MONGO_URI=mongodb://localhost:27017/duxsoup-etl

# Background Jobs
ENABLE_SCHEDULER=true
DEAD_LETTER_REPLAY_INTERVAL=60        # Minutes
HEALTH_CHECK_INTERVAL=360             # Minutes

# Export
EXPORT_TEMP_DIR=/tmp/duxsoup-exports
EXPORT_MAX_ROWS=100000                # Max rows per export
EXPORT_TTL_HOURS=24                   # Download link expiration

# Email Alerts (Gmail example)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
ALERT_EMAIL_FROM=your-email@gmail.com
ALERT_EMAIL_TO=alerts@yourcompany.com

# SMS Alerts (Twilio)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+12345678900
TWILIO_TO_NUMBER=+19876543210
```

**Note:** Email/SMS configuration is optional. If not configured, health checks still run but alerts only go to logs.

## Dependencies

- `node-cron` - Background job scheduling
- `csv-writer` - CSV export generation
- `uuid` - Export job IDs
- `nodemailer` - Email notifications
- `twilio` - SMS notifications

## Testing

Run quick tests:
```bash
./quick-test.sh
```

Run full integration tests:
```bash
npm test -- __tests__/integration/salesIntelligence.test.js
```

## API Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/query/people` | POST | Query people with filters |
| `/api/query/companies` | POST | Query companies |
| `/api/search` | GET | Full-text search |
| `/api/export/people/csv` | POST | Export to CSV |
| `/api/export/people/json` | POST | Export to JSON |
| `/api/export/status/:jobId` | GET | Check export status |
| `/api/export/download/:jobId` | GET | Download export |
| `/api/changes` | GET | Get recent changes |
| `/api/changes/person/:id` | GET | Get person changes |
| `/api/admin/test-notifications` | POST | Test email/SMS configuration |

## Not Implemented

The following features were **NOT** implemented:

- ❌ Lead Scoring (removed per user request)
- ❌ Segments API (removed per user request)
- ❌ Slack Alerts (removed per user request - user doesn't use Slack)

## Future Enhancements

### Potential Additions:
- Email/SMS health alerts (instead of Slack)
- Orphaned observation auto-linking
- Duplicate detection & auto-merge
- CRM integrations
- Advanced analytics

## Usage Examples

See `TESTING_WORKFLOW.md` for comprehensive usage examples.
