# /scaffold-script - Generate a new data script

**Usage:** `/scaffold-script <script-name> <description>`

**Description:** Scaffolds a new script in the `scripts/` directory with proper boilerplate, database connection, error handling, and project conventions.

**Purpose:** Quickly create new analysis or migration scripts following project patterns.

---

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - `script-name`: name of the script (e.g., "checkMissingCompanies")
   - `description`: what the script does (e.g., "Find people missing company IDs")

2. **Generate script file** at `scripts/<script-name>.js` with:

   **Standard boilerplate:**
   - Mongoose connection using database utility
   - Dotenv config
   - Winston logger (if needed)
   - Proper imports of models
   - Async main function
   - Error handling
   - Graceful disconnect

   **Project conventions:**
   - Use `require('../src/utils/database')` for connection
   - Use `async/await` (never `.then()`)
   - Follow JavaScript rules from `.claude/rules/javascript.md`
   - Add helpful comments
   - Support `--dry-run` flag if modifying data

3. **Template structure:**
   ```javascript
   const mongoose = require('mongoose');
   const path = require('path');
   require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
   const database = require('../src/utils/database');

   // Import models as needed
   const Person = require('../src/models/person');
   // const Visit = require('../src/models/visit');
   // const Company = require('../src/models/company');

   /**
    * [Script Name]
    *
    * [Description]
    *
    * Usage:
    *   node scripts/[script-name].js [--dry-run]
    */

   async function main() {
     await database.connect();

     console.log('\n========================================');
     console.log('[SCRIPT NAME]');
     console.log('========================================\n');

     const dryRun = process.argv.includes('--dry-run');
     if (dryRun) {
       console.log('🔍 DRY RUN MODE - No changes will be made\n');
     }

     // TODO: Implement script logic here

     // Example: Query data
     const count = await Person.countDocuments({});
     console.log(`Total people: ${count}`);

     // Example: Update data (respecting dry-run)
     if (!dryRun) {
       // await Person.updateMany(...);
       console.log('\n✓ Changes saved to database');
     } else {
       console.log('\n✓ Dry run complete - no changes made');
     }

     console.log('\n========================================\n');

     await database.disconnect();
   }

   main().catch((error) => {
     console.error('Error:', error);
     process.exit(1);
   });
   ```

4. **Customize based on description:**
   - If "check" or "analyze": read-only, no dry-run needed
   - If "migrate" or "update": include dry-run, show changes preview
   - If "import": add file reading, CSV parsing if needed
   - If "backfill": include batch processing, progress tracking

5. **Add to package.json scripts** if it's a common operation:
   ```json
   "script-name": "node scripts/[script-name].js --dry-run"
   ```

6. **Create corresponding permission** in `.claude/settings.local.json`:
   ```json
   "Bash(node scripts/[script-name].js:*)"
   ```

7. **Output to user:**
   ```
   SCAFFOLD SCRIPT
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   ✓ Created: scripts/[script-name].js

   Description: [description]

   Template includes:
   • Database connection boilerplate
   • Error handling
   • Dry-run support
   • Project conventions

   Next steps:
   1. Edit scripts/[script-name].js
   2. Implement your logic in the main() function
   3. Test with: node scripts/[script-name].js --dry-run
   4. Run for real: node scripts/[script-name].js

   ✓ Added npm script: npm run [script-name]
   ✓ Added permission to .claude/settings.local.json

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

## Examples

```bash
/scaffold-script checkMissingEmails "Find people without email addresses"
/scaffold-script migrateTitles "Normalize job titles to standard format"
/scaffold-script importLinkedInData "Import external LinkedIn data from CSV"
/scaffold-script analyzeCompanyGrowth "Track company headcount over time"
```

## Error Handling

- If script already exists: ask whether to overwrite
- If invalid script name: suggest valid format (camelCase, no spaces)
- Show the created file path and guide next steps
