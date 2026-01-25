#!/usr/bin/env node

/**
 * Backfill Missing Companies
 *
 * Re-processes observations from January 7 onwards to extract companies
 * that were missed due to the payload path bug.
 *
 * Usage:
 *   node scripts/backfill-companies.js --dry-run    # Preview changes
 *   node scripts/backfill-companies.js --execute    # Apply changes
 *   node scripts/backfill-companies.js --limit 100  # Test with 100 observations
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../src/utils/database');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const Company = require('../src/models/company');
const { upsertCompanyFromObservation } = require('../src/controllers/companyController');
const logger = require('../src/utils/logger');

const stats = {
  total: 0,
  processed: 0,
  companiesCreated: 0,
  companiesUpdated: 0,
  skipped: 0,
  failed: 0,
  errors: [],
};

async function backfillObservations(dryRun, limit) {
  const cutoffDate = new Date('2026-01-07T00:00:00Z');

  console.log(`Fetching observations since ${cutoffDate.toISOString()}...`);

  // Count total observations
  const query = { createdAt: { $gte: cutoffDate } };
  const visitCount = await Visit.countDocuments(query);
  const scanCount = await Scan.countDocuments(query);

  console.log(`Found ${visitCount} visits and ${scanCount} scans\n`);

  if (limit) {
    console.log(`Processing first ${limit} observations only (--limit=${limit})\n`);
  }

  stats.total = limit ? Math.min(limit, visitCount + scanCount) : (visitCount + scanCount);

  // Process in batches to avoid memory issues
  const batchSize = 1000;
  let processedVisits = 0;
  let processedScans = 0;

  // Process visits in batches
  console.log('Processing visits...');
  while (processedVisits < (limit || visitCount)) {
    const remaining = limit ? Math.min(batchSize, limit - processedVisits) : batchSize;
    const visits = await Visit.find(query)
      .sort({ _id: 1 })  // Sort by _id instead of createdAt (indexed)
      .skip(processedVisits)
      .limit(remaining);

    if (visits.length === 0) break;

    for (const visit of visits) {
      await processObservation(visit, 'visit', dryRun);
    }

    processedVisits += visits.length;
    if (processedVisits % 100 === 0) {
      console.log(`  Processed ${processedVisits}/${limit || visitCount} visits...`);
    }

    if (limit && processedVisits >= limit) break;
    if (visits.length < batchSize) break;
  }

  // Process scans in batches
  if (!limit || processedVisits < limit) {
    console.log('Processing scans...');
    const scanLimit = limit ? (limit - processedVisits) : null;

    while (processedScans < (scanLimit || scanCount)) {
      const remaining = scanLimit ? Math.min(batchSize, scanLimit - processedScans) : batchSize;
      const scans = await Scan.find(query)
        .sort({ _id: 1 })  // Sort by _id instead of createdAt (indexed)
        .skip(processedScans)
        .limit(remaining);

      if (scans.length === 0) break;

      for (const scan of scans) {
        await processObservation(scan, 'scan', dryRun);
      }

      processedScans += scans.length;
      if (processedScans % 100 === 0) {
        console.log(`  Processed ${processedScans}/${scanLimit || scanCount} scans...`);
      }

      if (scanLimit && processedScans >= scanLimit) break;
      if (scans.length < batchSize) break;
    }
  }

  console.log(`\nTotal processed: ${processedVisits} visits + ${processedScans} scans\n`);
}

async function processObservation(observation, sourceType, dryRun) {
  stats.processed++;

  try {
    // Check if observation has company data
    const webhookData =
      observation.rawData?.data || observation.rawData || observation;

    if (!webhookData.Company && !webhookData.CompanyProfile) {
      stats.skipped++;
      return;
    }

    if (dryRun) {
      console.log(`[DRY RUN] Would process ${sourceType} ${observation._id.toString().slice(-8)}`);
      console.log(`  Company: ${webhookData.Company || 'N/A'}`);
      console.log(`  CompanyProfile: ${webhookData.CompanyProfile ? 'PRESENT' : 'N/A'}`);

      // Try to determine if company would be created
      const { resolveCompanyIdentity } = require('../src/utils/identityResolver');
      const identity = resolveCompanyIdentity(webhookData);

      if (identity.company_id) {
        // Check if company already exists
        const existing = await Company.findOne({
          canonical_id: identity.canonical_id,
        });

        if (existing) {
          console.log(`  Would UPDATE existing company: ${existing._id}`);
        } else {
          console.log(`  Would CREATE new company: ${identity.company_id}`);
          stats.companiesCreated++;
        }
      } else {
        console.log(`  Would SKIP (no numeric company ID)`);
        stats.skipped++;
      }

      console.log('');
      return;
    }

    // Execute upsert
    const existingCompanyCount = await Company.countDocuments();

    const company = await upsertCompanyFromObservation(observation, sourceType);

    if (company) {
      const newCompanyCount = await Company.countDocuments();

      if (newCompanyCount > existingCompanyCount) {
        stats.companiesCreated++;
        logger.info('Created company during backfill', {
          company_id: company._id,
          canonical_id: company.canonical_id,
          observation_id: observation._id,
          sourceType,
        });
      } else {
        stats.companiesUpdated++;
        logger.info('Updated company during backfill', {
          company_id: company._id,
          canonical_id: company.canonical_id,
          observation_id: observation._id,
          sourceType,
        });
      }
    } else {
      stats.skipped++;
    }
  } catch (error) {
    stats.failed++;
    stats.errors.push({
      observation_id: observation._id,
      sourceType,
      error: error.message,
    });

    logger.error('Failed to backfill company from observation', {
      observation_id: observation._id,
      sourceType,
      error: error.message,
      stack: error.stack,
    });
  }
}

function generateReport(dryRun) {
  console.log('\n========================================');
  console.log('COMPANY BACKFILL REPORT');
  console.log('========================================\n');

  console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'EXECUTE (writing to database)'}\n`);

  console.log('Summary:');
  console.log(`  Total observations analyzed: ${stats.total}`);
  console.log(`  Observations processed: ${stats.processed}`);
  console.log(`  Companies created: ${stats.companiesCreated}`);
  console.log(`  Companies updated: ${stats.companiesUpdated}`);
  console.log(`  Skipped (no company data or ID): ${stats.skipped}`);
  console.log(`  Failed: ${stats.failed}\n`);

  if (stats.failed > 0 && stats.errors.length > 0) {
    console.log('Errors (first 10):');
    stats.errors.slice(0, 10).forEach((err, idx) => {
      console.log(`  ${idx + 1}. Observation ${err.observation_id} (${err.sourceType})`);
      console.log(`     Error: ${err.error}`);
    });
    console.log('');
  }

  if (dryRun && stats.companiesCreated > 0) {
    console.log(`✅ Dry run complete. Run with --execute to create ${stats.companiesCreated} companies.\n`);
  } else if (!dryRun && (stats.companiesCreated > 0 || stats.companiesUpdated > 0)) {
    console.log(`✅ Backfill complete. Created ${stats.companiesCreated} companies, updated ${stats.companiesUpdated}.\n`);
  } else if (!dryRun) {
    console.log('✅ Backfill complete. No new companies to create.\n');
  } else {
    console.log('✅ Dry run complete. No companies would be created.\n');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  try {
    console.log('Connecting to database...');
    await database.connect();

    await backfillObservations(dryRun, limit);

    generateReport(dryRun);

    await database.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { backfillObservations, processObservation };
