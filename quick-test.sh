#!/bin/bash
# Quick test script for sales intelligence features

BASE_URL="http://localhost:3000"

echo "Testing Sales Intelligence Features..."
echo ""

# 1. Find VPs
echo "1. Finding VPs:"
curl -s -X POST $BASE_URL/api/query/people \
  -H "Content-Type: application/json" \
  -d '{"filters":{"snapshot.currentTitle":{"$regex":"VP","$options":"i"}},"limit":3}' \
  | jq -r '.data.results[] | "  - \(.snapshot.fullName) (\(.snapshot.currentTitle)) at \(.snapshot.currentCompany)"'

# 2. Search
echo ""
echo "2. Search for 'engineer':"
curl -s "$BASE_URL/api/search?q=engineer&limit=3" \
  | jq -r '.data.results[] | "  - \(.snapshot.fullName) - \(.snapshot.currentTitle)"'

# 3. Companies
echo ""
echo "3. Top companies:"
curl -s -X POST $BASE_URL/api/query/companies \
  -H "Content-Type: application/json" \
  -d '{"limit":3}' \
  | jq -r '.data.results[] | "  - \(.companyName): \(.employeeCount) employees"'

# 4. Recent changes
echo ""
echo "4. Recent job changes:"
curl -s "$BASE_URL/api/changes?type=company_change&days=30&limit=3" \
  | jq -r '.data.changes[] | "  - \(.personSnapshot.fullName): \(.from) → \(.to)"'

# 5. Export test
echo ""
echo "5. Creating export job:"
RESPONSE=$(curl -s -X POST $BASE_URL/api/export/people/csv \
  -H "Content-Type: application/json" \
  -d '{"filters":{"snapshot.connections":{"$gte":500}},"fields":["fullName","currentTitle","currentCompany","connections"],"limit":10}')
JOB_ID=$(echo $RESPONSE | jq -r '.data.jobId')
echo "  Job ID: $JOB_ID"
echo "  Status: curl $BASE_URL/api/export/status/$JOB_ID | jq"
echo "  Download: curl $BASE_URL/api/export/download/$JOB_ID -o export.csv"

echo ""
echo "✓ Tests complete!"
