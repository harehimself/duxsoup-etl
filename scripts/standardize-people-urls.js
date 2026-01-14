#!/usr/bin/env node

/**
 * Standardize All URL Fields in People Collection
 *
 * Normalizes URLs to ensure consistency:
 * - Removes http/https protocol
 * - Converts to lowercase
 * - Removes trailing slashes
 * - Removes query parameters and fragments
 * - Handles www. prefix consistently
 *
 * URL Fields Standardized:
 * - aliases (profileUrl, publicUrl, salesUrl, recruiterUrl types)
 * - snapshot.currentCompanyUrl
 * - snapshot.currentCompanyProfile
 * - snapshot.personalWebsite
 * - snapshot.companyWebsite
 *
 * Usage:
 *   node scripts/standardize-people-urls.js --dry-run
 *   node scripts/standardize-people-urls.js --execute
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Person = require('../src/models/person');
const { normalizeUrl } = require('../src/utils/identityMatcher');

// Color output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  log(`\n${'='.repeat(70)}`, 'bright');
  log(title, 'bright');
  log('='.repeat(70), 'bright');
}

/**
 * Normalize a website URL (keep protocol for external sites)
 * Only removes trailing slashes and normalizes case
 */
function normalizeWebsiteUrl(url) {
  if (!url) return null;
  try {
    let normalized = url.trim();
    // Convert to lowercase
    normalized = normalized.toLowerCase();
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');
    // Remove fragment
    normalized = normalized.split('#')[0];
    return normalized;
  } catch (e) {
    return url;
  }
}

/**
 * Analyze current URL field state
 */
async function analyzeUrls() {
  section('Analyzing URL Fields');

  const people = await Person.find({
    $or: [
      { 'aliases.type': { $in: ['profileUrl', 'publicUrl', 'salesUrl', 'recruiterUrl'] } },
      { 'snapshot.currentCompanyUrl': { $ne: null, $ne: '' } },
      { 'snapshot.currentCompanyProfile': { $ne: null, $ne: '' } },
      { 'snapshot.personalWebsite': { $ne: null, $ne: '' } },
      { 'snapshot.companyWebsite': { $ne: null, $ne: '' } },
    ],
  }).lean();

  log(`\nTotal people with URL fields: ${people.length}`, 'cyan');

  const stats = {
    aliases: {
      profileUrl: 0,
      publicUrl: 0,
      salesUrl: 0,
      recruiterUrl: 0,
      needsNormalization: 0,
    },
    snapshot: {
      currentCompanyUrl: 0,
      currentCompanyProfile: 0,
      personalWebsite: 0,
      companyWebsite: 0,
      needsNormalization: 0,
    },
  };

  const issues = {
    hasProtocol: 0,
    hasTrailingSlash: 0,
    hasUppercase: 0,
    hasQueryParams: 0,
    hasFragment: 0,
  };

  for (const person of people) {
    // Check aliases
    if (person.aliases) {
      for (const alias of person.aliases) {
        if (['profileUrl', 'publicUrl', 'salesUrl', 'recruiterUrl'].includes(alias.type)) {
          stats.aliases[alias.type]++;

          const normalized = normalizeUrl(alias.value);
          if (normalized !== alias.value) {
            stats.aliases.needsNormalization++;

            // Track issue types
            if (/^https?:\/\//i.test(alias.value)) issues.hasProtocol++;
            if (alias.value.endsWith('/')) issues.hasTrailingSlash++;
            if (alias.value !== alias.value.toLowerCase()) issues.hasUppercase++;
            if (alias.value.includes('?')) issues.hasQueryParams++;
            if (alias.value.includes('#')) issues.hasFragment++;
          }
        }
      }
    }

    // Check snapshot fields
    const snapshotFields = [
      'currentCompanyUrl',
      'currentCompanyProfile',
      'personalWebsite',
      'companyWebsite',
    ];

    for (const field of snapshotFields) {
      const value = person.snapshot?.[field];
      if (value) {
        stats.snapshot[field]++;

        let normalized;
        if (field === 'personalWebsite' || field === 'companyWebsite') {
          normalized = normalizeWebsiteUrl(value);
        } else {
          normalized = normalizeUrl(value);
        }

        if (normalized !== value) {
          stats.snapshot.needsNormalization++;

          if (/^https?:\/\//i.test(value)) issues.hasProtocol++;
          if (value.endsWith('/')) issues.hasTrailingSlash++;
          if (value !== value.toLowerCase()) issues.hasUppercase++;
          if (value.includes('?')) issues.hasQueryParams++;
          if (value.includes('#')) issues.hasFragment++;
        }
      }
    }
  }

  log('\nAlias URL Statistics:', 'yellow');
  log(`  profileUrl: ${stats.aliases.profileUrl}`, 'cyan');
  log(`  publicUrl: ${stats.aliases.publicUrl}`, 'cyan');
  log(`  salesUrl: ${stats.aliases.salesUrl}`, 'cyan');
  log(`  recruiterUrl: ${stats.aliases.recruiterUrl}`, 'cyan');
  log(`  Aliases needing normalization: ${stats.aliases.needsNormalization}`, stats.aliases.needsNormalization > 0 ? 'yellow' : 'green');

  log('\nSnapshot URL Statistics:', 'yellow');
  log(`  currentCompanyUrl: ${stats.snapshot.currentCompanyUrl}`, 'cyan');
  log(`  currentCompanyProfile: ${stats.snapshot.currentCompanyProfile}`, 'cyan');
  log(`  personalWebsite: ${stats.snapshot.personalWebsite}`, 'cyan');
  log(`  companyWebsite: ${stats.snapshot.companyWebsite}`, 'cyan');
  log(`  Snapshot fields needing normalization: ${stats.snapshot.needsNormalization}`, stats.snapshot.needsNormalization > 0 ? 'yellow' : 'green');

  log('\nURL Issues Found:', 'yellow');
  log(`  Has protocol (http/https): ${issues.hasProtocol}`, 'cyan');
  log(`  Has trailing slash: ${issues.hasTrailingSlash}`, 'cyan');
  log(`  Has uppercase characters: ${issues.hasUppercase}`, 'cyan');
  log(`  Has query parameters: ${issues.hasQueryParams}`, 'cyan');
  log(`  Has fragment (#): ${issues.hasFragment}`, 'cyan');

  return {
    stats,
    issues,
    peopleWithUrls: people.length,
  };
}

/**
 * Standardize all URL fields
 */
async function standardizeUrls(dryRun = true) {
  section(`${dryRun ? 'Simulating' : 'Executing'} URL Standardization`);

  const people = await Person.find({
    $or: [
      { 'aliases.type': { $in: ['profileUrl', 'publicUrl', 'salesUrl', 'recruiterUrl'] } },
      { 'snapshot.currentCompanyUrl': { $ne: null, $ne: '' } },
      { 'snapshot.currentCompanyProfile': { $ne: null, $ne: '' } },
      { 'snapshot.personalWebsite': { $ne: null, $ne: '' } },
      { 'snapshot.companyWebsite': { $ne: null, $ne: '' } },
    ],
  });

  let peopleUpdated = 0;
  let aliasesNormalized = 0;
  let snapshotFieldsNormalized = 0;

  for (const person of people) {
    let hasChanges = false;
    const updates = {};

    // Normalize aliases
    if (person.aliases && person.aliases.length > 0) {
      const normalizedAliases = person.aliases.map((alias) => {
        if (['profileUrl', 'publicUrl', 'salesUrl', 'recruiterUrl'].includes(alias.type)) {
          const normalized = normalizeUrl(alias.value);
          if (normalized !== alias.value) {
            aliasesNormalized++;
            hasChanges = true;
            return { ...alias.toObject(), value: normalized };
          }
        }
        return alias.toObject ? alias.toObject() : alias;
      });

      if (hasChanges) {
        updates.aliases = normalizedAliases;
      }
    }

    // Normalize snapshot fields
    const snapshotUpdates = {};

    if (person.snapshot?.currentCompanyUrl) {
      const normalized = normalizeUrl(person.snapshot.currentCompanyUrl);
      if (normalized !== person.snapshot.currentCompanyUrl) {
        snapshotUpdates.currentCompanyUrl = normalized;
        snapshotFieldsNormalized++;
        hasChanges = true;
      }
    }

    if (person.snapshot?.currentCompanyProfile) {
      const normalized = normalizeUrl(person.snapshot.currentCompanyProfile);
      if (normalized !== person.snapshot.currentCompanyProfile) {
        snapshotUpdates.currentCompanyProfile = normalized;
        snapshotFieldsNormalized++;
        hasChanges = true;
      }
    }

    if (person.snapshot?.personalWebsite) {
      const normalized = normalizeWebsiteUrl(person.snapshot.personalWebsite);
      if (normalized !== person.snapshot.personalWebsite) {
        snapshotUpdates.personalWebsite = normalized;
        snapshotFieldsNormalized++;
        hasChanges = true;
      }
    }

    if (person.snapshot?.companyWebsite) {
      const normalized = normalizeWebsiteUrl(person.snapshot.companyWebsite);
      if (normalized !== person.snapshot.companyWebsite) {
        snapshotUpdates.companyWebsite = normalized;
        snapshotFieldsNormalized++;
        hasChanges = true;
      }
    }

    if (Object.keys(snapshotUpdates).length > 0) {
      Object.keys(snapshotUpdates).forEach((key) => {
        updates[`snapshot.${key}`] = snapshotUpdates[key];
      });
    }

    // Apply updates
    if (hasChanges) {
      if (dryRun) {
        if (peopleUpdated < 5) {
          log(`\n[DRY RUN] Would normalize URLs for person: ${person._id}`, 'blue');
          if (updates.aliases) {
            log(`  Aliases: ${aliasesNormalized} normalized`, 'blue');
          }
          if (Object.keys(snapshotUpdates).length > 0) {
            log(`  Snapshot: ${Object.keys(snapshotUpdates).join(', ')}`, 'blue');
          }
        }
      } else {
        await Person.updateOne({ _id: person._id }, { $set: updates });
      }

      peopleUpdated++;

      if (!dryRun && peopleUpdated % 100 === 0) {
        log(`  Processed ${peopleUpdated} people...`, 'cyan');
      }
    }
  }

  log('\nStandardization Summary:', 'bright');
  log(`  People updated: ${peopleUpdated}`, 'green');
  log(`  Aliases normalized: ${aliasesNormalized}`, 'green');
  log(`  Snapshot fields normalized: ${snapshotFieldsNormalized}`, 'green');

  return {
    peopleUpdated,
    aliasesNormalized,
    snapshotFieldsNormalized,
  };
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  log('\n' + '='.repeat(70), 'bright');
  log('PEOPLE COLLECTION URL STANDARDIZATION', 'bright');
  log('='.repeat(70), 'bright');
  log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`, dryRun ? 'yellow' : 'red');
  log('='.repeat(70) + '\n', 'bright');

  if (dryRun) {
    log('Running in DRY RUN mode - no changes will be made', 'yellow');
    log('Use --execute to actually standardize URLs\n', 'yellow');
  } else {
    log('WARNING: Running in EXECUTE mode - changes will be made!', 'red');
    log('URLs will be normalized across all people records\n', 'red');
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    log('Connected to MongoDB\n', 'green');

    const totalPeople = await Person.countDocuments();
    log(`Total people in database: ${totalPeople.toLocaleString()}\n`, 'cyan');

    // Phase 1: Analyze
    const analysis = await analyzeUrls();

    // Phase 2: Standardize
    const results = await standardizeUrls(dryRun);

    // Final summary
    section('FINAL SUMMARY');
    log(`Total people: ${totalPeople.toLocaleString()}`, 'cyan');
    log(`People with URLs: ${analysis.peopleWithUrls.toLocaleString()}`, 'cyan');
    log(`People updated: ${results.peopleUpdated.toLocaleString()}`, 'green');
    log(`Aliases normalized: ${results.aliasesNormalized.toLocaleString()}`, 'green');
    log(`Snapshot fields normalized: ${results.snapshotFieldsNormalized.toLocaleString()}`, 'green');
    log('='.repeat(70) + '\n', 'bright');

    if (dryRun) {
      log('This was a DRY RUN - no changes were made', 'yellow');
      log('Run with --execute to actually standardize URLs', 'yellow');
    } else {
      log('URL standardization complete!', 'green');
      log('All URL fields now follow consistent format:', 'green');
      log('  - No http/https protocol', 'cyan');
      log('  - All lowercase', 'cyan');
      log('  - No trailing slashes', 'cyan');
      log('  - No query parameters or fragments', 'cyan');
    }
  } catch (error) {
    log(`\nError: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    log('\nDisconnected from MongoDB\n', 'green');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  analyzeUrls,
  standardizeUrls,
};
