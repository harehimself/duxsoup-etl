#!/bin/bash

###############################################################################
# Pre-Flight Checklist - Run before cutover
#
# Validates that the system is ready for cutover to people-only reads.
###############################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

API_URL="${API_URL:-http://localhost:3000}"
PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  DuxSoup ETL - Pre-Flight Checklist                        ${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""
echo "API URL: ${API_URL}"
echo "Timestamp: $(date -Iseconds)"
echo ""

###############################################################################
# Helper functions
###############################################################################

check_pass() {
  echo -e "${GREEN}✓${NC} $1"
  ((++PASS_COUNT))
}

check_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
  ((++WARN_COUNT))
}

check_fail() {
  echo -e "${RED}✗${NC} $1"
  ((++FAIL_COUNT))
}

###############################################################################
# 1. Service Health
###############################################################################
echo -e "${BLUE}1. Service Health${NC}"

# Check if API is responding
if curl -s -f "${API_URL}/api/test" > /dev/null 2>&1; then
  check_pass "API is responding"
else
  check_fail "API not responding at ${API_URL}"
fi

# Check MongoDB connection
METRICS=$(curl -s "${API_URL}/api/health/metrics" 2>/dev/null || echo '{}')
if [ -n "$METRICS" ] && [ "$METRICS" != "{}" ]; then
  check_pass "MongoDB connection active"
else
  check_fail "Cannot reach health metrics (MongoDB issue?)"
fi

echo ""

###############################################################################
# 2. Ingestion Health
###############################################################################
echo -e "${BLUE}2. Ingestion Health${NC}"

INGESTION=$(curl -s "${API_URL}/api/health/ingestion" 2>/dev/null || echo '{}')

SUCCESS_RATE=$(echo "$INGESTION" | jq -r '.metrics.people_upsert_success_rate_24h // 0')
DEAD_PENDING=$(echo "$INGESTION" | jq -r '.metrics.dead_letters_pending // 0')
DEAD_FAILED=$(echo "$INGESTION" | jq -r '.metrics.dead_letters_failed_again // 0')

echo "  Success rate: ${SUCCESS_RATE}%"
echo "  Dead letters pending: ${DEAD_PENDING}"
echo "  Dead letters failed: ${DEAD_FAILED}"

if (( $(echo "$SUCCESS_RATE >= 95" | bc -l) )); then
  check_pass "Success rate >= 95% (${SUCCESS_RATE}%)"
else
  check_fail "Success rate < 95% (${SUCCESS_RATE}%)"
fi

if [ "$DEAD_PENDING" -lt 10 ]; then
  check_pass "Dead letters pending < 10 (${DEAD_PENDING})"
elif [ "$DEAD_PENDING" -lt 50 ]; then
  check_warn "Dead letters pending elevated (${DEAD_PENDING})"
else
  check_fail "Too many dead letters pending (${DEAD_PENDING})"
fi

if [ "$DEAD_FAILED" -lt 5 ]; then
  check_pass "Dead letters failed < 5 (${DEAD_FAILED})"
else
  check_warn "Some dead letters failing replay (${DEAD_FAILED})"
fi

echo ""

###############################################################################
# 3. Parity Health
###############################################################################
echo -e "${BLUE}3. Parity Health${NC}"

PARITY=$(curl -s "${API_URL}/api/health/parity" 2>/dev/null || echo '{}')

COVERAGE=$(echo "$PARITY" | jq -r '.metrics.coverage_ratio // 0')
COVERAGE_PCT=$(echo "$PARITY" | jq -r '.metrics.coverage_percent // 0')
READY=$(echo "$PARITY" | jq -r '.ready_for_cutover // false')
PEOPLE_COUNT=$(echo "$PARITY" | jq -r '.metrics.people_count // 0')

echo "  Coverage ratio: ${COVERAGE} (${COVERAGE_PCT}%)"
echo "  People count: ${PEOPLE_COUNT}"
echo "  Ready for cutover: ${READY}"

if (( $(echo "$COVERAGE >= 0.98" | bc -l) )); then
  check_pass "Coverage >= 98% (${COVERAGE_PCT}%)"
elif (( $(echo "$COVERAGE >= 0.95" | bc -l) )); then
  check_warn "Coverage 95-98% (${COVERAGE_PCT}%) - acceptable for hybrid mode"
else
  check_fail "Coverage < 95% (${COVERAGE_PCT}%)"
fi

if [ "$READY" = "true" ]; then
  check_pass "System reports ready for cutover"
else
  check_warn "System not reporting ready (check blockers)"
fi

echo ""

###############################################################################
# 4. Coverage Breakdown
###############################################################################
echo -e "${BLUE}4. Coverage Breakdown${NC}"

BREAKDOWN=$(curl -s "${API_URL}/api/health/coverage-breakdown" 2>/dev/null || echo '{}')

SALES_NAV=$(echo "$BREAKDOWN" | jq -r '.by_identity_source.sales_nav_id // 0')
NUMERIC=$(echo "$BREAKDOWN" | jq -r '.by_identity_source.member_numeric_id // 0')
URL_FALLBACK=$(echo "$BREAKDOWN" | jq -r '.by_identity_source.public_url_fallback // 0')
UPGRADABLE=$(echo "$BREAKDOWN" | jq -r '.url_fallback_analysis.upgradable_to_stable_id // 0')

TOTAL=$((SALES_NAV + NUMERIC + URL_FALLBACK))
if [ "$TOTAL" -gt 0 ]; then
  SALES_NAV_PCT=$(echo "scale=1; $SALES_NAV * 100 / $TOTAL" | bc)
  URL_FALLBACK_PCT=$(echo "scale=1; $URL_FALLBACK * 100 / $TOTAL" | bc)
else
  SALES_NAV_PCT=0
  URL_FALLBACK_PCT=0
fi

echo "  Sales Nav ID: ${SALES_NAV} (${SALES_NAV_PCT}%)"
echo "  Numeric ID: ${NUMERIC}"
echo "  URL fallback: ${URL_FALLBACK} (${URL_FALLBACK_PCT}%)"
echo "  Upgradable: ${UPGRADABLE}"

if [ "$UPGRADABLE" -gt 0 ]; then
  check_warn "${UPGRADABLE} people can be upgraded (run linking job)"
else
  check_pass "No upgradable people found"
fi

if (( $(echo "$URL_FALLBACK_PCT < 5" | bc -l) )); then
  check_pass "URL fallback rate < 5% (${URL_FALLBACK_PCT}%)"
elif (( $(echo "$URL_FALLBACK_PCT < 10" | bc -l) )); then
  check_warn "URL fallback rate 5-10% (${URL_FALLBACK_PCT}%)"
else
  check_fail "URL fallback rate > 10% (${URL_FALLBACK_PCT}%)"
fi

echo ""

###############################################################################
# 5. Current Configuration
###############################################################################
echo -e "${BLUE}5. Current Configuration${NC}"

READ_SOURCE=$(echo "$METRICS" | jq -r '.read_source // "unknown"')

echo "  Read source: ${READ_SOURCE}"

case "$READ_SOURCE" in
  legacy)
    check_pass "Currently in legacy mode (safe to flip to hybrid)"
    ;;
  hybrid)
    check_warn "Already in hybrid mode (check fallback rate before flipping to people)"
    ;;
  people)
    check_warn "Already in people-only mode"
    ;;
  *)
    check_fail "Unknown read source: ${READ_SOURCE}"
    ;;
esac

echo ""

###############################################################################
# 6. Recent Activity
###############################################################################
echo -e "${BLUE}6. Recent Activity (24h)${NC}"

TOTAL_OBS=$(echo "$INGESTION" | jq -r '.metrics.total_observations_24h // 0')
SUCCESSES=$(echo "$INGESTION" | jq -r '.metrics.people_upsert_successes_24h // 0')
FAILURES=$(echo "$INGESTION" | jq -r '.metrics.people_upsert_failures_24h // 0')

echo "  Total observations: ${TOTAL_OBS}"
echo "  Successful upserts: ${SUCCESSES}"
echo "  Failed upserts: ${FAILURES}"

if [ "$TOTAL_OBS" -gt 100 ]; then
  check_pass "Active ingestion (${TOTAL_OBS} observations/24h)"
elif [ "$TOTAL_OBS" -gt 10 ]; then
  check_warn "Low traffic (${TOTAL_OBS} observations/24h)"
else
  check_fail "Very low traffic (${TOTAL_OBS} observations/24h) - not enough data"
fi

echo ""

###############################################################################
# Summary
###############################################################################
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Summary                                                    ${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Passed:  ${PASS_COUNT}${NC}"
echo -e "${YELLOW}Warnings: ${WARN_COUNT}${NC}"
echo -e "${RED}Failed:   ${FAIL_COUNT}${NC}"
echo ""

if [ "$FAIL_COUNT" -eq 0 ] && [ "$WARN_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✓ System ready for cutover to people-only${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Run linking job if upgradable people exist"
  echo "  2. Execute: ./scripts/cutover.sh"
  exit 0
elif [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${YELLOW}⚠ System mostly ready with some warnings${NC}"
  echo ""
  echo "Recommended actions:"
  echo "  1. Review warnings above"
  echo "  2. Run linking job to reduce URL fallback"
  echo "  3. Consider hybrid mode first, then people-only"
  exit 0
else
  echo -e "${RED}✗ System not ready for cutover${NC}"
  echo ""
  echo "Critical issues:"
  echo "  - Fix all failed checks above"
  echo "  - Re-run this script before proceeding"
  exit 1
fi
