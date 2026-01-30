# Seniority Classification System

## Overview

The seniority classification system automatically parses job titles from LinkedIn and assigns them to structured seniority tiers. This enables powerful filtering, segmentation, and analysis based on organizational hierarchy.

## Seniority Tiers

The system uses an 8-tier hierarchy with numeric ranks (higher = more senior):

| Tier | Rank | Description | Examples |
|------|------|-------------|----------|
| **Owner** | 8 | Business owners, founders, partners | Founder, Co-Founder, Owner, Partner, Sole Proprietor |
| **CXO** | 7 | C-suite executives | CEO, CTO, CFO, CMO, Chief Technology Officer, Chief * Officer |
| **SVP** | 6 | Senior and Executive VPs, General Managers | SVP, Senior Vice President, EVP, Executive VP, General Manager, GM |
| **VP** | 5 | Vice Presidents, Heads of | VP, Vice President, AVP, Head of Engineering |
| **Managing Director** | 4 | Managing Directors | Managing Director, Managing Dir., MD |
| **Manager** | 3 | People managers and team leads | Manager, Senior Manager, Team Lead, Supervisor, Product Manager |
| **In Training** | 2 | Students, interns, trainees | Student, Intern, Apprentice, Trainee, Candidate |
| **Individual Contributor** | 1 | Non-management professionals (default) | Software Engineer, Senior Engineer, Staff Engineer, Analyst, Designer |

## Key Features

### 1. Automatic Classification

Every role's title is automatically parsed and classified when:
- A new observation (visit/scan) is processed
- Roles are added or updated in the system

Example:
```javascript
const { parseTitle } = require('./src/utils/titleParser');

const result = parseTitle('VP of Engineering');
// Result: {
//   seniority: 'VP',
//   seniorityRank: 5,
//   department: 'engineering',
//   normalized: 'VP of Engineering'
// }
```

### 2. Precedence Rules

The matching order ensures accurate classification:

1. **Higher tiers checked first**: "SVP" is matched before "VP" to avoid misclassification
2. **Specific over general**: "Managing Director" is matched specifically (not just "Director")
3. **Owner beats CXO**: "Founder & CEO" is classified as Owner (rank 8)
4. **Default to Individual Contributor**: Unknown titles default to rank 1

### 3. Multiple Roles Support

When a person has multiple roles, the system tracks:
- **Seniority for each role**: Every role has its own `seniority` and `seniorityRank` fields
- **Highest seniority**: Stored in `derived.highestSeniority` for easy filtering

Example:
```javascript
person.snapshot.roles = [
  { title: 'Software Engineer', seniority: 'Individual Contributor', seniorityRank: 1 },
  { title: 'VP of Engineering', seniority: 'VP', seniorityRank: 5 },
];

person.derived.highestSeniority = 'VP';
person.derived.highestSeniorityRank = 5;
```

## Data Schema

### Role Schema

Each role in `person.snapshot.roles[]` has:

```javascript
{
  title: String,
  companyName: String,
  companyId: String,
  location: String,
  startDate: Date,
  endDate: Date,
  isCurrent: Boolean,

  // Seniority classification
  seniority: String,        // Tier name (e.g., "VP", "CXO")
  seniorityRank: Number,    // Numeric rank (1-8)
}
```

### Derived Metrics

The `person.derived` object includes:

```javascript
{
  // Highest seniority across all roles
  highestSeniority: String,              // "VP"
  highestSeniorityRank: Number,          // 5
  highestSeniorityRoleTitle: String,     // "VP of Engineering"
  highestSeniorityRoleCompany: String,   // "Acme Corp"

  // Other metrics
  avgTenureMonths: Number,
  yearsAtCurrentCompany: Number,
}
```

## Usage Examples

### Querying by Seniority

```javascript
// Find all VPs and above
const seniorLeaders = await Person.find({
  'derived.highestSeniorityRank': { $gte: 5 }
});

// Find all C-suite executives
const executives = await Person.find({
  'derived.highestSeniority': 'CXO'
});

// Find people who have been managers
const managers = await Person.find({
  'snapshot.roles': {
    $elemMatch: {
      seniority: 'Manager'
    }
  }
});
```

### Aggregation by Seniority

```javascript
// Count people by highest seniority tier
const distribution = await Person.aggregate([
  {
    $group: {
      _id: '$derived.highestSeniority',
      count: { $sum: 1 }
    }
  },
  { $sort: { count: -1 } }
]);
```

### Filtering in Queries

```javascript
// Get VPs in Engineering
const engineeringVPs = await Person.find({
  'snapshot.roles': {
    $elemMatch: {
      seniority: 'VP',
      title: /engineering/i
    }
  }
});
```

## Backfilling Existing Data

To add seniority classification to existing roles:

```bash
# Dry run (preview changes)
npm run backfill:seniority

# Execute the migration
npm run backfill:seniority -- --execute
```

The script will:
1. Parse all existing role titles
2. Add `seniority` and `seniorityRank` to each role
3. Calculate `derived.highestSeniority` for each person
4. Show distribution statistics

## Customization

### Adding New Patterns

To add new title patterns, edit `src/utils/titleParser.js`:

```javascript
const SENIORITY_TIERS = [
  {
    tier: 'VP',
    tier_rank: 5,
    patterns: [
      /\bVice\s+President\b/i,
      /\bVP\b/i,
      // Add your pattern here
      /\bYour Pattern\b/i,
    ],
  },
];
```

**Important**: Higher tiers must be defined first to ensure correct precedence.

### Testing Changes

Always run tests after modifying patterns:

```bash
npm test -- __tests__/utils/titleParser.test.js
```

## Edge Cases

### Title with Multiple Matches

When a title matches multiple tiers, the first match wins (highest tier):

- "Founder & CEO" → **Owner** (rank 8)
- "SVP of Sales" → **SVP** (rank 6, not VP)

### Missing or Invalid Titles

- Empty/null titles → **Individual Contributor** (rank 1)
- Unrecognized titles → **Individual Contributor** (rank 1)

### Special Cases

- "Partner Manager" → **Manager** (rank 3, not Owner)
  - The pattern checks for "Partner" not followed by "Manager"
- "Managing Director" → **Managing Director** (rank 4, not Individual Contributor)
  - Requires "Managing" + "Director", not just "Director"

## API Integration

The seniority classification is automatically applied during webhook processing. No additional API calls or configuration required.

## Performance Considerations

- **Parsing**: O(n) where n = number of patterns (very fast, < 1ms per title)
- **Database**: Indexed on `derived.highestSeniority` and `derived.highestSeniorityRank` for fast queries
- **Storage**: Adds ~20 bytes per role (seniority string + rank number)

## Troubleshooting

### Incorrect Classification

If a title is misclassified:

1. Check the title spelling and format
2. Review pattern matching in `src/utils/titleParser.js`
3. Ensure patterns are ordered correctly (highest rank first)
4. Add a test case to prevent regression

### Missing Seniority Data

If roles are missing seniority:

1. Run the backfill script: `npm run backfill:seniority -- --execute`
2. Check logs for parsing errors
3. Verify the role has a valid `title` field

## Future Enhancements

Potential improvements:
- Machine learning model for ambiguous titles
- Industry-specific tier mappings
- Seniority progression tracking over time
- Confidence scores for classifications
