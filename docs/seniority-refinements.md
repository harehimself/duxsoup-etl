# Seniority Classification Refinements

## Findings from Production Data Analysis

After processing 116,858 roles across 20,202 people, the following refinements are recommended:

## Issue 1: Director Titles Classified as Individual Contributor

**Problem:** 309+ Director titles (Sales Director, Director of Sales, etc.) are being classified as Individual Contributor because the Director pattern was removed to avoid conflicts with "Managing Director".

**Impact:** ~1,400 roles may be under-classified

**Options:**

### Option A: Add Director Tier (Recommended)
Add a new tier between Managing Director and Manager:

```javascript
{
  tier: 'Director',
  tier_rank: 3.5, // Between Manager (3) and Managing Director (4)
  patterns: [
    /\bDirector\b/i,
    /\bSr\.?\s+Director\b/i,
    /\bSenior\s+Director\b/i,
    /\bExecutive\s+Director\b/i,
  ],
}
```

Note: This requires renumbering all tiers:
- Owner: 9 (was 8)
- CXO: 8 (was 7)
- SVP: 7 (was 6)
- VP: 6 (was 5)
- Managing Director: 5 (was 4)
- **Director: 4 (new)**
- Manager: 3 (unchanged)
- In Training: 2 (unchanged)
- Individual Contributor: 1 (unchanged)

### Option B: Include Directors in Manager Tier (Simpler)
Add Director patterns to Manager tier without creating new tier:

```javascript
{
  tier: 'Manager',
  tier_rank: 3,
  patterns: [
    /\b(Manager|Mgr\.?)\b/i,
    /\bDirector\b/i,  // Add this
    /\bSenior\s+(Manager|Director)\b/i,  // Add this
    // ... existing patterns
  ],
}
```

**Recommendation:** Option B (simpler, fewer schema changes)

## Issue 2: Partner Titles Incorrectly Classified as Owner

**Problem:** 27+ "Partner" titles like "Senior Talent Acquisition Partner" and "Client Partner" are being classified as Owner, but these are IC/Manager roles, not business ownership.

**Impact:** ~150 roles may be over-classified

**Solution:** Make Partner pattern more specific to avoid false matches

### Current Pattern (Too Broad):
```javascript
/\b(Founder|Co-?Founder|Owner|Co-?Owner|Sole\s+Proprietor|Partner(?!\s+Manager))\b/i
```

### Refined Pattern (More Specific):
```javascript
/\b(Founder|Co-?Founder|Owner|Co-?Owner|Sole\s+Proprietor)\b/i,
// Add separate pattern for legitimate Partner titles:
/\b(Managing\s+)?Partner(?!\s+(Manager|Marketing|Acquisition|Success|Account|Client))\b/i
```

This matches:
- ✅ "Partner" (business partner)
- ✅ "Managing Partner" (law firm, consulting)
- ✅ "Senior Partner" (when standalone)
- ❌ "Senior Client Partner" (IC role)
- ❌ "Partner Marketing Manager" (Manager role)
- ❌ "Senior Talent Acquisition Partner" (IC role)

## Issue 3: Member Board of Directors

**Found:** 118 roles titled "Member Board of Directors"

**Current Classification:** Individual Contributor

**Consideration:** Board members could be considered Owner-tier (oversight/governance) or a separate tier. However, board membership is often advisory/non-executive, so IC classification may be acceptable.

**Recommendation:** Leave as-is or create a separate "Board Member" tier if governance roles are important for your use case.

## Implementation Priority

1. **High Priority:** Fix Partner pattern (Issue 2)
   - Clear over-classification
   - Quick fix: update regex pattern
   - Estimated impact: ~150 roles

2. **Medium Priority:** Add Director patterns (Issue 1)
   - Significant under-classification
   - Fix: add to Manager tier or create new tier
   - Estimated impact: ~1,400 roles

3. **Low Priority:** Board Member consideration (Issue 3)
   - Small impact (~118 roles)
   - Decision depends on business requirements

## Testing After Refinements

After implementing changes:

1. Re-run backfill: `npm run backfill:seniority -- --execute`
2. Check distribution: Should see fewer ICs, more Managers/Directors
3. Spot-check sample titles to verify improvements
4. Monitor for new edge cases

## Data Quality Issues Found

During backfill, found 3 validation errors:
- 3 people with `endDate < startDate` (pre-existing data quality issue)
- 1 person with `degree: 4` (schema allows 1-3 only)

These should be fixed separately from seniority classification.
