# CSV Import Script Documentation

## Overview

The `import-csv-visits.js` script performs comprehensive data enrichment by importing DuxSoup CSV exports into the database. It captures ALL available data including visits, people, companies, locations, skills, and position history.

## Features

### Data Captured

✅ **Visit Observations** (Append-only event logs)
- DuxSoup visit metadata (ID, timestamp, degree)
- Profile information (name, summary, connections)
- Contact details (email, phone, Twitter, IM)
- Current position (title, company)
- Profile pictures
- Tags and notes
- Raw CSV data preservation

✅ **Person Snapshots** (Enriched canonical state)
- Identity resolution using Sales Navigator ID
- Alias management (all known identifiers)
- Skills (up to 100 skills per person)
- Role history (up to 8 positions with dates)
- Parsed location data (city, state, country)
- Contact information
- Connection degree
- Observation timeline

✅ **Company Records**
- Company names
- LinkedIn URLs
- Company websites
- Automatic deduplication

✅ **Location Records**
- Structured parsing (city, state, country)
- State code normalization (CA, NY, etc.)
- Country code normalization (US, GB, etc.)
- Metropolitan area detection
- Location type classification

### Data Enrichment Strategy

1. **Identity Resolution**: Uses Sales Navigator ID as primary key
2. **Alias Matching**: Finds existing people by any known identifier
3. **Skills Merging**: Adds new skills without duplicating existing ones
4. **Role Timeline**: Merges position history chronologically
5. **Contact Updates**: Enriches empty fields with new data

## Usage

### Basic Commands

```bash
# Dry run (preview without making changes)
npm run import:csv visits.csv -- --dry-run

# Import data (default batch size: 100)
npm run import:csv visits.csv

# Custom batch size (for memory management)
npm run import:csv visits.csv -- --batch-size=50

# Direct node command
node scripts/import-csv-visits.js visits.csv --dry-run
```

### Arguments

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `<csv-file-path>` | Yes | - | Path to CSV file (relative or absolute) |
| `--dry-run` | No | false | Preview changes without modifying database |
| `--batch-size=N` | No | 100 | Process N rows at a time |

## CSV Format Requirements

### Required Columns

- `duxsoupId` - Unique visit identifier
- `VisitTime` - Visit timestamp
- `First Name` - Person's first name
- `salesNavId` - Sales Navigator ID (for identity)

### Optional Columns

**Person Data:**
- `Middle Name`, `Last Name`
- `Profile`, `SalesProfile`, `RecruiterProfile`
- `Picture`
- `Degree` (connection degree: 1, 2, 3)
- `Connections`, `Summary`
- `Email`, `Phone`, `IM`, `Twitter`
- `Location`, `Industry`
- `My Tags`, `My Notes`

**Company Data:**
- `Company`, `Title`
- `CompanyProfile`, `CompanyWebsite`
- `PersonalWebsite`

**Skills Data:**
- `Skill-0` through `Skill-99` (100 skill columns)

**Position History:**
- `Position-0-Company` through `Position-7-Company`
- `Position-0-Title` through `Position-7-Title`
- `Position-0-Description` through `Position-7-Description`
- `Position-0-From` through `Position-7-From` (start dates)
- `Position-0-To` through `Position-7-To` (end dates)
- `Position-0-Location` through `Position-7-Location`

## Output Statistics

The script provides detailed statistics on completion:

```
========================================
IMPORT STATISTICS
========================================
Total Rows Processed:     1222

Visits:
  Created:                1222
  Updated:                0
  Failed:                 0

People:
  Created:                156
  Updated:                1066
  Skills Added:           33117
  Roles Added:            7582

Companies:
  Created:                328
  Updated:                12

Locations:
  Created:                245
  Updated:                8

Errors:                   0
========================================
```

## Error Handling

- **Duplicate Visits**: Skipped automatically (idempotent)
- **Missing Sales Nav ID**: Warning logged, person created with fallback ID
- **Invalid Dates**: Null returned, no crash
- **Parse Errors**: Logged to Winston, processing continues
- **Database Errors**: Batch fails, previous batches preserved

### Viewing Errors

Errors are tracked and displayed at the end:

```
Errors:                   3

First 10 errors:
  - Row id.12345 (visit): Validation failed
  - Row id.67890 (person): Missing required field
```

## Performance

- **Memory Efficient**: Streams CSV, processes in batches
- **Default Batch Size**: 100 rows (adjustable)
- **Progress Updates**: Every 50 rows
- **Database Connection**: Maintained throughout import
- **Dry Run**: No database writes, fast preview

### Recommended Batch Sizes

| CSV Size | Batch Size | Reason |
|----------|------------|--------|
| < 1,000 rows | 100 | Default, good balance |
| 1,000 - 10,000 | 50 | Reduce memory usage |
| > 10,000 rows | 25 | Large datasets, safer |

## Data Model Integration

### Observation-Snapshot Pattern

```javascript
// Visit (Observation) - Immutable event log
{
  id: "id.12345",
  VisitTime: Date,
  Profile: "linkedin.com/in/username",
  "First Name": "John",
  extended: {
    skills: ["JavaScript", "Node.js"],
    positions: [...]
  },
  rawData: { /* full CSV row */ }
}

// Person (Snapshot) - Canonical state
{
  _id: "ACwAAABCDEF...",
  canonical_id: "person_abc123...",
  aliases: [
    { type: "salesNavId", value: "ACwAAABCDEF..." },
    { type: "profileUrl", value: "linkedin.com/in/username" }
  ],
  snapshot: {
    fullName: "John Doe",
    currentTitle: "Senior Engineer",
    currentCompany: "Example Corp",
    skills: ["JavaScript", "Node.js", "React"],
    roles: [
      {
        title: "Senior Engineer",
        companyName: "Example Corp",
        startDate: Date("2020-01-01"),
        isCurrent: true
      }
    ]
  },
  observations: {
    visits: [ObjectId("...")],
    scans: []
  }
}
```

## Best Practices

1. **Always Dry Run First**
   ```bash
   npm run import:csv visits.csv -- --dry-run
   ```

2. **Verify CSV Format**
   - Check column headers match expected format
   - Ensure `salesNavId` column exists
   - Validate date formats

3. **Monitor Memory Usage**
   - Reduce batch size if running out of memory
   - Large CSVs (>10k rows) should use smaller batches

4. **Check Statistics**
   - Review "People Created" vs "People Updated"
   - High failure rate indicates data quality issues
   - Zero errors is expected for clean data

5. **Backup Before Import**
   - MongoDB backup recommended for production
   - Test with dry run first

## Examples

### Example 1: Standard Import

```bash
# Preview changes
npm run import:csv visits.csv -- --dry-run

# If dry run looks good, import
npm run import:csv visits.csv
```

### Example 2: Large CSV File

```bash
# Use smaller batch size for memory efficiency
npm run import:csv large-visits.csv -- --batch-size=25
```

### Example 3: Custom Path

```bash
# Absolute path
npm run import:csv /path/to/exports/visits.csv

# Relative path
npm run import:csv ../data/visits.csv
```

## Troubleshooting

### Issue: "CSV file not found"
**Solution**: Check file path, use absolute path if relative fails

### Issue: "Client must be connected"
**Solution**: Check MONGODB_URI in .env file

### Issue: "Validation failed"
**Solution**: Check CSV format, ensure required columns exist

### Issue: High memory usage
**Solution**: Reduce batch size with `--batch-size=25`

### Issue: Duplicate person records
**Solution**: Check that `salesNavId` column is populated

## Technical Details

### Dependencies
- `csv-parser` - Streaming CSV parsing
- `mongoose` - MongoDB object modeling
- `dotenv` - Environment configuration

### Services Used
- `IdentityResolverService` - Alias matching and deduplication
- `location-parser` - Structured location parsing
- `date-parser` - Safe date parsing
- `identityResolver` - Canonical ID generation

### Database Collections Modified
- `visits` - New visit observations created
- `people` - Person snapshots created/updated
- `companies` - Company records created/updated
- `locations` - Location records created/updated

## Next Steps After Import

1. **Verify Import**
   ```bash
   # Check person count
   npm run audit:canonical-id

   # Run data health checks
   /check-health
   ```

2. **Analyze Data**
   ```bash
   # Use quick-query skill
   /quick-query how many people have skills?
   /quick-query show top 10 companies by person count
   ```

3. **Export for Analysis**
   - Use export endpoints to analyze enriched data
   - Skills now available for filtering
   - Role history enables career trajectory analysis

## Support

For issues or questions:
- Check logs in Winston output
- Review error statistics
- Use `--dry-run` to diagnose issues
- Open GitHub issue with error details
