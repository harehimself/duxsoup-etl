#!/usr/bin/env node

/**
 * Rebuild People Collection from Observations
 *
 * Admin script to rebuild the people collection from visits/scans observations.
 * Idempotent and replayable - safe to run multiple times.
 *
 * Usage:
 *   node scripts/rebuildPeople.js [options]
 *
 * Options:
 *   --from=YYYY-MM-DD    Start date (default: beginning of time)
 *   --to=YYYY-MM-DD      End date (default: now)
 *   --limit=N            Limit to N observations (for testing)
 *   --source=visit|scan  Only process visits or scans (default: both)
 *   --dry-run            Don't actually upsert, just log what would happen
 *
 * Examples:
 *   node scripts/rebuildPeople.js --from=2024-01-01
 *   node scripts/rebuildPeople.js --limit=100 --dry-run
 *   node scripts/rebuildPeople.js --source=visit
 */

const mongoose = require('mongoose');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const {upsertFromObservation} = require('../src/controllers/personController');
const logger = require('../src/utils/logger');

// Parse command-line arguments
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    const [key, value] = arg.replace('--', '').split('=');
    args[key] = value || true;
  });
  return args;
}

// Build query from arguments
function buildQuery(args) {
  const query = {};

  if (args.from || args.to) {
    const dateFilter = {};
    if (args.from) {
      dateFilter.$gte = new Date(args.from);
    }
    if (args.to) {
      dateFilter.$lte = new Date(args.to);
    }
    query.$or = [
      { VisitTime: dateFilter },
      { ScanTime: dateFilter },
    ];
  }

  return query;
}

// Process observations chronologically
async function rebuildPeople(args) {
  console.log('🔄 Starting people rebuild...', args);

  const stats = {
    visits_processed: 0,
    scans_processed: 0,
    people_upserted: 0,
    errors: 0,
    skipped: 0,
  };

  const startTime = Date.now();

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB');

    const query = buildQuery(args);
    const limit = args.limit ? parseInt(args.limit) : 0;

    // Process visits
    if (!args.source || args.source === 'visit') {
      console.log('\n📥 Processing visits...');

      const visitsCursor = Visit.find(query)
        .sort({ VisitTime: 1 }) // Chronological order
        .limit(limit)
        .cursor();

      for (let visit = await visitsCursor.next(); visit != null; visit = await visitsCursor.next()) {
        try {
          if (args['dry-run']) {
            console.log(`  [DRY RUN] Would upsert from visit ${visit._id}`);
            stats.skipped++;
          } else {
            await upsertFromObservation(visit, 'visit');
            stats.people_upserted++;
          }
          stats.visits_processed++;

          if (stats.visits_processed % 100 === 0) {
            console.log(`  Processed ${stats.visits_processed} visits...`);
          }
        } catch (error) {
          logger.error('Failed to upsert from visit', {
            visit_id: visit._id,
            error: error.message,
          });
          stats.errors++;
        }
      }

      console.log(`✓ Processed ${stats.visits_processed} visits`);
    }

    // Process scans
    if (!args.source || args.source === 'scan') {
      console.log('\n📥 Processing scans...');

      const scansCursor = Scan.find(query)
        .sort({ ScanTime: 1 }) // Chronological order
        .limit(limit)
        .cursor();

      for (let scan = await scansCursor.next(); scan != null; scan = await scansCursor.next()) {
        try {
          if (args['dry-run']) {
            console.log(`  [DRY RUN] Would upsert from scan ${scan._id}`);
            stats.skipped++;
          } else {
            await upsertFromObservation(scan, 'scan');
            stats.people_upserted++;
          }
          stats.scans_processed++;

          if (stats.scans_processed % 100 === 0) {
            console.log(`  Processed ${stats.scans_processed} scans...`);
          }
        } catch (error) {
          logger.error('Failed to upsert from scan', {
            scan_id: scan._id,
            error: error.message,
          });
          stats.errors++;
        }
      }

      console.log(`✓ Processed ${stats.scans_processed} scans`);
    }

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    const throughput = Math.round((stats.visits_processed + stats.scans_processed) / elapsedSeconds);

    console.log('\n✅ Rebuild complete!');
    console.log('Statistics:');
    console.log(`  Visits processed: ${stats.visits_processed}`);
    console.log(`  Scans processed: ${stats.scans_processed}`);
    console.log(`  People upserted: ${stats.people_upserted}`);
    console.log(`  Errors: ${stats.errors}`);
    console.log(`  Skipped (dry-run): ${stats.skipped}`);
    console.log(`  Elapsed: ${elapsedSeconds}s`);
    console.log(`  Throughput: ${throughput} obs/sec`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    logger.error('Rebuild failed', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Run script
const args = parseArgs();

if (args.help || args.h) {
  console.log(`
Rebuild People Collection from Observations

Usage: node scripts/rebuildPeople.js [options]

Options:
  --from=YYYY-MM-DD    Start date (default: beginning of time)
  --to=YYYY-MM-DD      End date (default: now)
  --limit=N            Limit to N observations (for testing)
  --source=visit|scan  Only process visits or scans (default: both)
  --dry-run            Don't actually upsert, just log what would happen
  --help, -h           Show this help message

Examples:
  node scripts/rebuildPeople.js --from=2024-01-01
  node scripts/rebuildPeople.js --limit=100 --dry-run
  node scripts/rebuildPeople.js --source=visit
  `);
  process.exit(0);
}

rebuildPeople(args);
