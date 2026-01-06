#!/usr/bin/env node

/**
 * Verify People Rebuild
 *
 * Validates that the people collection was properly rebuilt from observations.
 * Run this after rebuildPeople.js completes.
 *
 * Usage:
 *   node scripts/verifyRebuild.js [options]
 *
 * Options:
 *   --sample-size=N    Number of random people to deep-check (default: 10)
 *   --verbose          Show detailed output
 *
 * Exit codes:
 *   0 = All checks passed
 *   1 = Critical failures detected
 *   2 = Warnings but no critical failures
 */

const mongoose = require('mongoose');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const Person = require('../src/models/person');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let checksPassed = 0;
let checksFailed = 0;
let checksWarning = 0;

function pass(message) {
  console.log(`${GREEN}✓${RESET} ${message}`);
  checksPassed++;
}

function fail(message) {
  console.log(`${RED}✗${RESET} ${message}`);
  checksFailed++;
}

function warn(message) {
  console.log(`${YELLOW}⚠${RESET} ${message}`);
  checksWarning++;
}

function info(message) {
  console.log(`${BLUE}ℹ${RESET} ${message}`);
}

function parseArgs() {
  const args = { sampleSize: 10, verbose: false };
  process.argv.slice(2).forEach(arg => {
    if (arg === '--verbose') {
      args.verbose = true;
    } else {
      const [key, value] = arg.replace('--', '').split('=');
      if (key === 'sample-size') {
        args.sampleSize = parseInt(value) || 10;
      }
    }
  });
  return args;
}

async function verifyRebuild(args) {
  console.log(`${BLUE}═══════════════════════════════════════════════════════${RESET}`);
  console.log(`${BLUE}  Rebuild Verification Report                          ${RESET}`);
  console.log(`${BLUE}═══════════════════════════════════════════════════════${RESET}\n`);

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/duxsoup-etl';
    await mongoose.connect(mongoUri);
    info('Connected to MongoDB\n');

    // =========================================================================
    // 1. Collection Counts
    // =========================================================================
    console.log(`${BLUE}1. Collection Counts${RESET}`);

    const visitsCount = await Visit.countDocuments();
    const scansCount = await Scan.countDocuments();
    const peopleCount = await Person.countDocuments();

    console.log(`  Visits: ${visitsCount.toLocaleString()}`);
    console.log(`  Scans: ${scansCount.toLocaleString()}`);
    console.log(`  People: ${peopleCount.toLocaleString()}`);

    if (peopleCount === 0) {
      fail('People collection is empty - rebuild failed or not run');
    } else if (peopleCount > 0) {
      pass(`People collection has ${peopleCount.toLocaleString()} records`);
    }

    console.log('');

    // =========================================================================
    // 2. Coverage Analysis
    // =========================================================================
    console.log(`${BLUE}2. Coverage Analysis${RESET}`);

    // Get distinct profile identifiers from observations
    const distinctVisitProfiles = await Visit.distinct('Profile');
    const distinctScanProfiles = await Scan.distinct('Profile');
    const allProfileUrls = new Set([...distinctVisitProfiles, ...distinctScanProfiles]);
    const estimatedLegacyPeople = allProfileUrls.size;

    const coverageRatio = estimatedLegacyPeople > 0 ? peopleCount / estimatedLegacyPeople : 0;
    const coveragePercent = (coverageRatio * 100).toFixed(2);

    console.log(`  Distinct profiles in visits: ${distinctVisitProfiles.length.toLocaleString()}`);
    console.log(`  Distinct profiles in scans: ${distinctScanProfiles.length.toLocaleString()}`);
    console.log(`  Estimated unique people: ${estimatedLegacyPeople.toLocaleString()}`);
    console.log(`  Coverage: ${coveragePercent}%`);

    if (coverageRatio >= 0.98) {
      pass(`Coverage >= 98% (${coveragePercent}%)`);
    } else if (coverageRatio >= 0.95) {
      warn(`Coverage 95-98% (${coveragePercent}%) - acceptable but not ideal`);
    } else if (coverageRatio >= 0.90) {
      warn(`Coverage 90-95% (${coveragePercent}%) - rebuild may have errors`);
    } else {
      fail(`Coverage < 90% (${coveragePercent}%) - rebuild likely incomplete`);
    }

    console.log('');

    // =========================================================================
    // 3. Identity Distribution
    // =========================================================================
    console.log(`${BLUE}3. Identity Distribution${RESET}`);

    const salesNavCount = await Person.countDocuments({
      'aliases.type': 'salesNavId',
    });
    const numericIdCount = await Person.countDocuments({
      'aliases.type': 'memberNumericId',
    });
    const urlOnlyCount = await Person.countDocuments({
      $and: [
        { 'aliases.type': { $ne: 'salesNavId' } },
        { 'aliases.type': { $ne: 'memberNumericId' } },
      ],
    });

    console.log(`  Sales Navigator ID: ${salesNavCount.toLocaleString()}`);
    console.log(`  Numeric ID: ${numericIdCount.toLocaleString()}`);
    console.log(`  URL-only (fallback): ${urlOnlyCount.toLocaleString()}`);

    const urlFallbackPercent = peopleCount > 0 ? ((urlOnlyCount / peopleCount) * 100).toFixed(1) : 0;
    console.log(`  URL fallback rate: ${urlFallbackPercent}%`);

    if (urlFallbackPercent < 5) {
      pass(`URL fallback rate < 5% (${urlFallbackPercent}%)`);
    } else if (urlFallbackPercent < 10) {
      warn(`URL fallback rate 5-10% (${urlFallbackPercent}%)`);
    } else {
      warn(`URL fallback rate > 10% (${urlFallbackPercent}%) - consider running linking job`);
    }

    console.log('');

    // =========================================================================
    // 4. Sample Data Integrity
    // =========================================================================
    console.log(`${BLUE}4. Sample Data Integrity (${args.sampleSize} random people)${RESET}`);

    const samplePeople = await Person.aggregate([
      { $sample: { size: args.sampleSize } },
    ]);

    let integrityIssues = 0;

    for (const person of samplePeople) {
      const issues = [];

      // Check snapshot exists
      if (!person.snapshot || Object.keys(person.snapshot).length === 0) {
        issues.push('empty snapshot');
      }

      // Check observations references
      const visitsRefs = person.observations?.visits || [];
      const scansRefs = person.observations?.scans || [];

      if (visitsRefs.length === 0 && scansRefs.length === 0) {
        issues.push('no observation references');
      }

      // Check aliases
      if (!person.aliases || person.aliases.length === 0) {
        issues.push('no aliases');
      }

      // Check meta
      if (!person.meta || !person.meta.last_observed_at) {
        issues.push('missing meta.last_observed_at');
      }

      if (issues.length > 0) {
        if (args.verbose) {
          warn(`  Person ${person._id}: ${issues.join(', ')}`);
        }
        integrityIssues++;
      }
    }

    if (integrityIssues === 0) {
      pass(`All ${args.sampleSize} sampled people have valid structure`);
    } else {
      const issuePercent = ((integrityIssues / args.sampleSize) * 100).toFixed(0);
      if (integrityIssues <= 2) {
        warn(`${integrityIssues}/${args.sampleSize} people (${issuePercent}%) have integrity issues`);
      } else {
        fail(`${integrityIssues}/${args.sampleSize} people (${issuePercent}%) have integrity issues`);
      }
    }

    console.log('');

    // =========================================================================
    // 5. Observation References Validation
    // =========================================================================
    console.log(`${BLUE}5. Observation References (sample check)${RESET}`);

    let refCheckCount = 0;
    let brokenRefs = 0;

    for (const person of samplePeople.slice(0, 5)) {
      // Check a few visit references
      const visitRefs = person.observations?.visits || [];
      for (const visitId of visitRefs.slice(0, 2)) {
        const visit = await Visit.findById(visitId);
        if (!visit) {
          brokenRefs++;
          if (args.verbose) {
            warn(`  Broken visit ref: ${visitId} in person ${person._id}`);
          }
        }
        refCheckCount++;
      }

      // Check a few scan references
      const scanRefs = person.observations?.scans || [];
      for (const scanId of scanRefs.slice(0, 2)) {
        const scan = await Scan.findById(scanId);
        if (!scan) {
          brokenRefs++;
          if (args.verbose) {
            warn(`  Broken scan ref: ${scanId} in person ${person._id}`);
          }
        }
        refCheckCount++;
      }
    }

    console.log(`  Checked ${refCheckCount} observation references`);

    if (brokenRefs === 0) {
      pass('All checked observation references are valid');
    } else {
      warn(`${brokenRefs}/${refCheckCount} observation references are broken`);
    }

    console.log('');

    // =========================================================================
    // 6. Indexes Verification
    // =========================================================================
    console.log(`${BLUE}6. Index Verification${RESET}`);

    const db = mongoose.connection.db;
    const peopleIndexes = await db.collection('people').indexes();

    const hasPersonIdIndex = peopleIndexes.some(idx => idx.key.person_id);
    const hasAliasValueIndex = peopleIndexes.some(idx => idx.key['aliases.value']);

    console.log(`  People indexes: ${peopleIndexes.length}`);

    if (hasPersonIdIndex) {
      pass('person_id index exists');
    } else {
      fail('person_id index missing');
    }

    if (hasAliasValueIndex) {
      pass('aliases.value index exists');
    } else {
      warn('aliases.value index missing (impacts lookup performance)');
    }

    console.log('');

    // =========================================================================
    // 7. Cutover Readiness
    // =========================================================================
    console.log(`${BLUE}7. Cutover Readiness${RESET}`);

    const readyForCutover = coverageRatio >= 0.98;

    console.log(`  Coverage >= 98%: ${coverageRatio >= 0.98 ? 'Yes' : 'No'}`);
    console.log(`  People count > 0: ${peopleCount > 0 ? 'Yes' : 'No'}`);
    console.log(`  No critical integrity issues: ${integrityIssues < 5 ? 'Yes' : 'No'}`);

    if (readyForCutover && peopleCount > 0 && integrityIssues < 5) {
      pass('System ready for cutover to hybrid mode');
    } else {
      fail('System NOT ready for cutover - fix issues above');
    }

    console.log('');

    // =========================================================================
    // Summary
    // =========================================================================
    console.log(`${BLUE}═══════════════════════════════════════════════════════${RESET}`);
    console.log(`${BLUE}  Summary${RESET}`);
    console.log(`${BLUE}═══════════════════════════════════════════════════════${RESET}\n`);

    console.log(`${GREEN}Passed:   ${checksPassed}${RESET}`);
    console.log(`${YELLOW}Warnings: ${checksWarning}${RESET}`);
    console.log(`${RED}Failed:   ${checksFailed}${RESET}\n`);

    if (checksFailed === 0 && checksWarning === 0) {
      console.log(`${GREEN}✓ All checks passed! Rebuild successful.${RESET}\n`);
      console.log('Next steps:');
      console.log('  1. Run: node scripts/linkIdentities.js --dry-run');
      console.log('  2. Run: ./scripts/pre-flight-check.sh');
      console.log('  3. Execute cutover: ./scripts/cutover.sh\n');
      await mongoose.connection.close();
      process.exit(0);
    } else if (checksFailed === 0) {
      console.log(`${YELLOW}⚠ Rebuild complete with warnings${RESET}\n`);
      console.log('Recommended actions:');
      console.log('  1. Review warnings above');
      console.log('  2. Run: node scripts/linkIdentities.js (to reduce URL fallback)');
      console.log('  3. Re-run this script to verify improvements\n');
      await mongoose.connection.close();
      process.exit(2);
    } else {
      console.log(`${RED}✗ Critical failures detected${RESET}\n`);
      console.log('Required actions:');
      console.log('  1. Fix all failed checks above');
      console.log('  2. Consider re-running: node scripts/rebuildPeople.js');
      console.log('  3. Re-run this script to verify fixes\n');
      await mongoose.connection.close();
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n${RED}❌ Fatal error:${RESET} ${error.message}`);
    console.error(error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run script
const args = parseArgs();
verifyRebuild(args);
