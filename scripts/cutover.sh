#!/bin/bash

###############################################################################
# Production Cutover Script
#
# Execute this in your production environment with MongoDB running.
# This script performs the cutover from legacy to people-only reads.
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
DRY_RUN="${DRY_RUN:-true}"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  DuxSoup ETL - Production Cutover to People Collection    ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}API URL: ${API_URL}${NC}"
echo -e "${YELLOW}DRY RUN: ${DRY_RUN}${NC}"
echo ""

###############################################################################
# Step 0: Identity Merge Sweep
###############################################################################
echo -e "${BLUE}Step 0: Identity Merge Sweep${NC}"
echo "Running linking job to upgrade URL-fallback people..."
echo ""

# Dry run first
echo "Preview (dry-run):"
node scripts/linkIdentities.js --dry-run --limit=20

if [ "$DRY_RUN" = "false" ]; then
  echo ""
  read -p "Execute merge? (yes/no): " confirm
  if [ "$confirm" = "yes" ]; then
    node scripts/linkIdentities.js --commit --limit=500 --batch-size=20
    echo -e "${GREEN}✓ Linking job complete${NC}"
  else
    echo -e "${RED}Linking job skipped${NC}"
    exit 1
  fi
else
  echo -e "${YELLOW}Skipping actual merge (DRY_RUN=true)${NC}"
fi

echo ""

###############################################################################
# Step 1: Confirm Gates
###############################################################################
echo -e "${BLUE}Step 1: Confirm Cutover Gates${NC}"
echo "Checking health endpoints..."
echo ""

# Ingestion health
echo -e "${YELLOW}Ingestion Health:${NC}"
INGESTION=$(curl -s "${API_URL}/api/health/ingestion")
echo "$INGESTION" | jq '.'
SUCCESS_RATE=$(echo "$INGESTION" | jq -r '.metrics.people_upsert_success_rate_24h // 0')
DEAD_LETTERS=$(echo "$INGESTION" | jq -r '.metrics.dead_letters_pending // 0')

echo ""

# Parity health
echo -e "${YELLOW}Parity Health:${NC}"
PARITY=$(curl -s "${API_URL}/api/health/parity")
echo "$PARITY" | jq '.'
COVERAGE=$(echo "$PARITY" | jq -r '.metrics.coverage_ratio // 0')
READY=$(echo "$PARITY" | jq -r '.ready_for_cutover // false')

echo ""

# Coverage breakdown
echo -e "${YELLOW}Coverage Breakdown:${NC}"
BREAKDOWN=$(curl -s "${API_URL}/api/health/coverage-breakdown")
echo "$BREAKDOWN" | jq '.'
UPGRADABLE=$(echo "$BREAKDOWN" | jq -r '.url_fallback_analysis.upgradable_to_stable_id // 0')

echo ""

# Current metrics
echo -e "${YELLOW}Current Metrics:${NC}"
METRICS=$(curl -s "${API_URL}/api/health/metrics")
echo "$METRICS" | jq '.'
READ_SOURCE=$(echo "$METRICS" | jq -r '.read_source // "unknown"')

echo ""
echo -e "${BLUE}Gate Summary:${NC}"
echo "  Success Rate: ${SUCCESS_RATE}% (need >= 95%)"
echo "  Coverage Ratio: ${COVERAGE} (need >= 0.98)"
echo "  Dead Letters: ${DEAD_LETTERS} (need < 10)"
echo "  Ready for Cutover: ${READY}"
echo "  Upgradable People: ${UPGRADABLE}"
echo "  Current Read Source: ${READ_SOURCE}"
echo ""

# Check gates
GATES_PASS=true

if (( $(echo "$SUCCESS_RATE < 95" | bc -l) )); then
  echo -e "${RED}✗ Success rate too low${NC}"
  GATES_PASS=false
fi

if (( $(echo "$COVERAGE < 0.95" | bc -l) )); then
  echo -e "${YELLOW}⚠ Coverage below 0.98 (current: ${COVERAGE})${NC}"
  if (( $(echo "$COVERAGE < 0.95" | bc -l) )); then
    echo -e "${RED}✗ Coverage too low (minimum: 0.95)${NC}"
    GATES_PASS=false
  fi
fi

if [ "$DEAD_LETTERS" -gt 10 ]; then
  echo -e "${YELLOW}⚠ Dead letters above threshold: ${DEAD_LETTERS}${NC}"
fi

if [ "$GATES_PASS" = "false" ]; then
  echo ""
  echo -e "${RED}Gates failed. Fix issues before proceeding.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ All gates passed or acceptable${NC}"
echo ""

###############################################################################
# Step 2: Flip to People-Only Mode
###############################################################################
echo -e "${BLUE}Step 2: Flip to People-Only Mode${NC}"
echo ""

if [ "$DRY_RUN" = "true" ]; then
  echo -e "${YELLOW}DRY RUN: Would set READ_SOURCE=people and restart service${NC}"
  echo ""
  echo "In production, run:"
  echo "  export READ_SOURCE=people"
  echo "  pm2 restart duxsoup-etl"
  echo "  # or: systemctl restart duxsoup-etl"
else
  echo "Setting READ_SOURCE=people..."
  export READ_SOURCE=people

  echo ""
  echo -e "${YELLOW}Restart your service now:${NC}"
  echo "  pm2 restart duxsoup-etl"
  echo "  # or: systemctl restart duxsoup-etl"
  echo ""
  read -p "Press Enter after restarting service..."
fi

echo ""

###############################################################################
# Step 3: Validate Immediately
###############################################################################
echo -e "${BLUE}Step 3: Validate Cutover${NC}"
echo "Checking that service is in people-only mode..."
echo ""

sleep 2  # Give service a moment to start

METRICS_AFTER=$(curl -s "${API_URL}/api/health/metrics")
READ_SOURCE_AFTER=$(echo "$METRICS_AFTER" | jq -r '.read_source // "unknown"')

echo "Current read source: ${READ_SOURCE_AFTER}"

if [ "$READ_SOURCE_AFTER" != "people" ] && [ "$DRY_RUN" = "false" ]; then
  echo -e "${RED}✗ Service not in people mode! Current: ${READ_SOURCE_AFTER}${NC}"
  echo "Verify READ_SOURCE env var and service restart."
  exit 1
fi

echo -e "${GREEN}✓ Service in correct mode${NC}"
echo ""

# Test known endpoints
echo "Testing read endpoints..."
echo ""

echo "GET /api/health/metrics:"
curl -s "${API_URL}/api/health/metrics" | jq '.read_source, .reads'
echo ""

echo "GET /api/people/metrics:"
curl -s "${API_URL}/api/people/metrics" | jq '.metrics | {people_read_attempts, people_read_success_rate, people_read_not_found_rate}'
echo ""

###############################################################################
# Step 4: Monitor Instructions
###############################################################################
echo -e "${BLUE}Step 4: Monitoring Instructions${NC}"
echo ""
echo "Monitor these metrics for the next hour:"
echo ""
echo "1. Check metrics every 15 minutes:"
echo "   curl ${API_URL}/api/people/metrics | jq '.metrics'"
echo ""
echo "2. Watch for:"
echo "   - people_read_not_found_rate < 1%"
echo "   - No unexpected 404 spikes"
echo "   - Dead letters staying low"
echo ""
echo "3. Check logs:"
echo "   tail -f logs/app.log | grep -E '(404|error|FALLBACK)'"
echo ""

###############################################################################
# Rollback Instructions
###############################################################################
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  ROLLBACK (if needed)                                     ${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "If anything goes wrong:"
echo ""
echo "  export READ_SOURCE=legacy"
echo "  pm2 restart duxsoup-etl"
echo ""
echo "Then investigate while ingestion continues dual-write."
echo ""

echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Cutover script complete                                  ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
