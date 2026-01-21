# Sales Intelligence - Testing Workflow

This guide provides sample commands to test all new sales intelligence features.

## Prerequisites

1. **Start the server**:
   ```bash
   npm run dev
   ```

2. **Set environment variables** (optional for Slack):
   ```bash
   export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
   ```

3. **Open a new terminal** for running test commands.

---

## Workflow 1: Query & Search

### 1.1 Query Help (See Available Filters)
```bash
curl http://localhost:3000/api/query/help | jq
```

### 1.2 Find VPs and Directors
```bash
curl -X POST http://localhost:3000/api/query/people \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "snapshot.currentTitle": {
        "$regex": "VP|Director|Chief",
        "$options": "i"
      }
    },
    "sort": {"snapshot.connections": -1},
    "limit": 10
  }' | jq
```

### 1.3 Find Engineers with 500+ Connections
```bash
curl -X POST http://localhost:3000/api/query/people \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "snapshot.currentTitle": {"$regex": "Engineer", "$options": "i"},
      "snapshot.connections": {"$gte": 500}
    },
    "sort": {"snapshot.connections": -1},
    "limit": 20
  }' | jq
```

### 1.4 Find People in San Francisco
```bash
curl -X POST http://localhost:3000/api/query/people \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "snapshot.city": "San Francisco"
    },
    "limit": 15
  }' | jq
```

### 1.5 Query Companies (Aggregated Data)
```bash
curl -X POST http://localhost:3000/api/query/companies \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {},
    "limit": 10
  }' | jq
```

### 1.6 Full-Text Search by Name
```bash
# Replace "John Doe" with a name from your database
curl "http://localhost:3000/api/search?q=John+Doe&limit=10" | jq
```

### 1.7 Search by Company
```bash
# Replace "Google" with a company from your database
curl "http://localhost:3000/api/search?q=Google&limit=10" | jq
```

### 1.8 Search by Title
```bash
curl "http://localhost:3000/api/search?q=engineer&limit=20" | jq
```

---

## Workflow 2: Lead Scoring & Segments

### 2.1 Get High-Value Prospects (Score >= 70)
```bash
curl "http://localhost:3000/api/segments/high-value?limit=20" | jq
```

### 2.2 Get Decision Makers (VP/Director/C-level)
```bash
curl "http://localhost:3000/api/segments/decision-makers?limit=20" | jq
```

### 2.3 Get Warm Leads (Recent Job Changes)
```bash
curl "http://localhost:3000/api/segments/warm-leads?limit=20" | jq
```

### 2.4 Get Profiles Needing Enrichment (Missing Email/Phone)
```bash
curl "http://localhost:3000/api/segments/needs-enrichment?limit=20" | jq
```

### 2.5 Manually Trigger Score Recalculation
```bash
curl -X POST http://localhost:3000/api/segments/recalculate \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 100, "limit": 1000}' | jq
```

---

## Workflow 3: Job Change Detection

### 3.1 Get Recent Job Changes (Last 30 Days)
```bash
curl "http://localhost:3000/api/changes?type=company_change&days=30&limit=50" | jq
```

### 3.2 Get Recent Promotions
```bash
curl "http://localhost:3000/api/changes?type=promotion&days=30&limit=50" | jq
```

### 3.3 Get All Changes (Last 7 Days)
```bash
curl "http://localhost:3000/api/changes?days=7&limit=100" | jq
```

### 3.4 Get Changes for Specific Person
```bash
# Replace PERSON_ID with an actual person ID from your database
curl "http://localhost:3000/api/changes/person/PERSON_ID" | jq
```

---

## Workflow 4: Export Data

### 4.1 Export High-Value Prospects to CSV
```bash
# Create export job
EXPORT_RESPONSE=$(curl -X POST http://localhost:3000/api/export/people/csv \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {"derived.leadScore": {"$gte": 70}},
    "fields": ["firstName", "lastName", "currentTitle", "currentCompany", "email", "phone", "connections"]
  }')

echo $EXPORT_RESPONSE | jq

# Extract job ID
JOB_ID=$(echo $EXPORT_RESPONSE | jq -r '.data.jobId')
echo "Job ID: $JOB_ID"
```

### 4.2 Check Export Status
```bash
# Wait a few seconds, then check status
sleep 3
curl "http://localhost:3000/api/export/status/$JOB_ID" | jq
```

### 4.3 Download Export (Once Complete)
```bash
# Check if completed, then download
STATUS=$(curl -s "http://localhost:3000/api/export/status/$JOB_ID" | jq -r '.data.status')

if [ "$STATUS" = "completed" ]; then
  curl "http://localhost:3000/api/export/download/$JOB_ID" -o "high-value-prospects.csv"
  echo "✓ Downloaded to high-value-prospects.csv"
  head -20 high-value-prospects.csv
else
  echo "Export not ready yet. Status: $STATUS"
fi
```

### 4.4 Export All Engineers to CSV
```bash
curl -X POST http://localhost:3000/api/export/people/csv \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {"snapshot.currentTitle": {"$regex": "Engineer", "$options": "i"}},
    "fields": ["fullName", "currentTitle", "currentCompany", "city", "state", "email", "connections"]
  }' | jq
```

### 4.5 Export to JSON Format
```bash
curl -X POST http://localhost:3000/api/export/people/json \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {"snapshot.city": "San Francisco"},
    "fields": ["fullName", "currentTitle", "currentCompany", "email"]
  }' | jq
```

---

## Workflow 5: Advanced Queries

### 5.1 Find High-Value Prospects in Specific Location
```bash
curl -X POST http://localhost:3000/api/query/people \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "$and": [
        {"derived.leadScore": {"$gte": 70}},
        {"snapshot.city": "San Francisco"}
      ]
    },
    "sort": {"derived.leadScore": -1},
    "limit": 20
  }' | jq
```

### 5.2 Find Recent Job Changers with High Connections
```bash
curl -X POST http://localhost:3000/api/query/people \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "$and": [
        {"derived.segment": "warm_lead"},
        {"snapshot.connections": {"$gte": 500}}
      ]
    },
    "sort": {"snapshot.connections": -1},
    "limit": 20
  }' | jq
```

### 5.3 Find Decision Makers at Tech Companies
```bash
curl -X POST http://localhost:3000/api/query/people \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "$and": [
        {"snapshot.currentTitle": {"$regex": "VP|Director|Chief", "$options": "i"}},
        {"snapshot.industry": {"$regex": "Technology", "$options": "i"}}
      ]
    },
    "sort": {"snapshot.connections": -1},
    "limit": 30
  }' | jq
```

### 5.4 Find People with Specific Skills
```bash
curl -X POST http://localhost:3000/api/query/people \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "snapshot.skills": {"$in": ["Python", "Machine Learning", "AI"]}
    },
    "limit": 25
  }' | jq
```

### 5.5 Pagination Example
```bash
# Page 1
curl -X POST http://localhost:3000/api/query/people \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {"snapshot.currentTitle": {"$regex": "Engineer"}},
    "limit": 10,
    "skip": 0
  }' | jq '.data.metadata'

# Page 2
curl -X POST http://localhost:3000/api/query/people \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {"snapshot.currentTitle": {"$regex": "Engineer"}},
    "limit": 10,
    "skip": 10
  }' | jq '.data.metadata'
```

---

## Workflow 6: Complete Sales Intelligence Workflow

This workflow demonstrates a complete sales prospecting process:

### Step 1: Identify High-Value Prospects in Target Location
```bash
echo "=== Step 1: Finding high-value prospects in San Francisco ==="
curl -X POST http://localhost:3000/api/query/people \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "$and": [
        {"derived.leadScore": {"$gte": 70}},
        {"snapshot.city": "San Francisco"}
      ]
    },
    "sort": {"derived.leadScore": -1},
    "limit": 5
  }' | jq '.data.results[] | {
    name: .snapshot.fullName,
    title: .snapshot.currentTitle,
    company: .snapshot.currentCompany,
    leadScore: .derived.leadScore,
    segment: .derived.segment,
    connections: .snapshot.connections
  }'
```

### Step 2: Find Warm Leads (Recent Job Changes)
```bash
echo "=== Step 2: Finding warm leads (recent job changes) ==="
curl "http://localhost:3000/api/changes?type=company_change&days=30&limit=10" | jq '.data.changes[] | {
  name: .personSnapshot.fullName,
  title: .personSnapshot.currentTitle,
  from: .from,
  to: .to,
  connections: .personSnapshot.connections,
  timestamp: .timestamp
}'
```

### Step 3: Search for Specific Profiles
```bash
echo "=== Step 3: Searching for VP Engineering profiles ==="
curl "http://localhost:3000/api/search?q=VP+Engineering&limit=5" | jq '.data.results[] | {
  name: .snapshot.fullName,
  title: .snapshot.currentTitle,
  company: .snapshot.currentCompany,
  connections: .snapshot.connections
}'
```

### Step 4: Export Target List
```bash
echo "=== Step 4: Exporting high-value prospects to CSV ==="
EXPORT_RESPONSE=$(curl -s -X POST http://localhost:3000/api/export/people/csv \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "$and": [
        {"derived.leadScore": {"$gte": 70}},
        {"snapshot.city": "San Francisco"}
      ]
    },
    "fields": ["firstName", "lastName", "currentTitle", "currentCompany", "email", "phone", "connections", "city"]
  }')

JOB_ID=$(echo $EXPORT_RESPONSE | jq -r '.data.jobId')
echo "Export job created: $JOB_ID"
echo "Check status: curl http://localhost:3000/api/export/status/$JOB_ID"
echo "Download: curl http://localhost:3000/api/export/download/$JOB_ID -o prospects.csv"
```

### Step 5: Get Segment Breakdown
```bash
echo "=== Step 5: Analyzing prospect segments ==="
echo "High-value count:"
curl -s "http://localhost:3000/api/segments/high-value?limit=1000" | jq '.data.metadata.count'

echo "Decision-makers count:"
curl -s "http://localhost:3000/api/segments/decision-makers?limit=1000" | jq '.data.metadata.count'

echo "Warm leads count:"
curl -s "http://localhost:3000/api/segments/warm-leads?limit=1000" | jq '.data.metadata.count'
```

---

## Workflow 7: Monitoring & Health

### 7.1 Check Server Health
```bash
curl http://localhost:3000/health | jq
```

### 7.2 Check API Version
```bash
curl http://localhost:3000/api/version | jq
```

### 7.3 View Recent Changes Summary
```bash
echo "=== Job Changes (Last 7 Days) ==="
curl -s "http://localhost:3000/api/changes?type=company_change&days=7" | jq '.data.metadata'

echo "=== Promotions (Last 7 Days) ==="
curl -s "http://localhost:3000/api/changes?type=promotion&days=7" | jq '.data.metadata'

echo "=== Title Changes (Last 7 Days) ==="
curl -s "http://localhost:3000/api/changes?type=title_change&days=7" | jq '.data.metadata'
```

---

## Quick Test Script

Save this as `test-sales-intelligence.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:3000"

echo "========================================="
echo "DuxSoup ETL - Sales Intelligence Testing"
echo "========================================="
echo ""

# Test 1: Health Check
echo "1. Health Check..."
curl -s $BASE_URL/health | jq -r '.status'
echo ""

# Test 2: Query API
echo "2. Query API - Finding VPs..."
COUNT=$(curl -s -X POST $BASE_URL/api/query/people \
  -H "Content-Type: application/json" \
  -d '{"filters":{"snapshot.currentTitle":{"$regex":"VP","$options":"i"}},"limit":5}' \
  | jq '.data.metadata.count')
echo "   Found $COUNT VPs"
echo ""

# Test 3: Search API
echo "3. Search API - Searching for 'engineer'..."
COUNT=$(curl -s "$BASE_URL/api/search?q=engineer&limit=5" | jq '.data.metadata.count')
echo "   Found $COUNT results"
echo ""

# Test 4: Segments
echo "4. Segments..."
HV=$(curl -s "$BASE_URL/api/segments/high-value?limit=1000" | jq '.data.metadata.count')
DM=$(curl -s "$BASE_URL/api/segments/decision-makers?limit=1000" | jq '.data.metadata.count')
WL=$(curl -s "$BASE_URL/api/segments/warm-leads?limit=1000" | jq '.data.metadata.count')
echo "   High-value prospects: $HV"
echo "   Decision makers: $DM"
echo "   Warm leads: $WL"
echo ""

# Test 5: Changes
echo "5. Recent Changes (Last 30 Days)..."
CHANGES=$(curl -s "$BASE_URL/api/changes?days=30&limit=1000" | jq '.data.metadata.count')
echo "   Total changes: $CHANGES"
echo ""

# Test 6: Export
echo "6. Export Test - Creating CSV export job..."
RESPONSE=$(curl -s -X POST $BASE_URL/api/export/people/csv \
  -H "Content-Type: application/json" \
  -d '{"filters":{"snapshot.currentTitle":{"$regex":"Engineer"}},"fields":["fullName","currentTitle","currentCompany"],"limit":10}')
JOB_ID=$(echo $RESPONSE | jq -r '.data.jobId')
echo "   Export job created: $JOB_ID"
echo ""

echo "========================================="
echo "✓ All tests completed!"
echo "========================================="
```

Make it executable and run:
```bash
chmod +x test-sales-intelligence.sh
./test-sales-intelligence.sh
```

---

## Troubleshooting

### No Results Found?
- Check if you have data: `curl -X POST http://localhost:3000/api/query/people -H "Content-Type: application/json" -d '{"limit":5}' | jq`
- Verify MongoDB connection: `curl http://localhost:3000/health | jq`

### Export Job Fails?
- Check logs: `tail -f logs/combined.log`
- Verify temp directory exists: `mkdir -p /tmp/duxsoup-exports`

### Scheduler Not Running?
- Check logs for: "Starting background job scheduler"
- Verify `ENABLE_SCHEDULER` is not set to `false`

### Slack Alerts Not Working?
- Verify `SLACK_WEBHOOK_URL` is set
- Check logs for Slack API errors
- Test webhook manually: `curl -X POST $SLACK_WEBHOOK_URL -H "Content-Type: application/json" -d '{"text":"Test message"}'`
