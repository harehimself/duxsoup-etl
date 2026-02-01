#!/usr/bin/env node

/**
 * DuxSoup ETL Operations CLI
 *
 * Unified entry point for all operational scripts.
 *
 * Usage:
 *   node scripts/cli.js <command> [options]
 *
 * Commands:
 *   merge-duplicates    Find and merge duplicate person records
 *   link-orphans        Link orphaned observations to canonical people
 *   migrate-url-ids     Migrate URL-based person _id values to stable IDs
 *   replay-dead-letters Replay failed person upserts from the dead letter queue
 *   rebuild-companies   Rebuild company collection from observations
 *   rebuild-locations   Rebuild location collection from observations
 *   backfill-canonical  Backfill missing canonical IDs
 *   dedupe-aliases      Deduplicate alias arrays
 *   backfill-seniority  Backfill seniority classifications
 *   health-check        Run a health check against the database
 *
 * Global options:
 *   --dry-run           Preview changes without writing (default for destructive ops)
 *   --execute           Actually perform the operation
 *   --resume            Resume from last checkpoint (if available)
 *   --help              Show this help message
 */

const path = require('path');
const { execFileSync, execFile } = require('child_process');

const COMMANDS = {
  'merge-duplicates': {
    script: 'merge-duplicates.js',
    description: 'Find and merge duplicate person records',
    defaultDryRun: true,
  },
  'link-orphans': {
    script: 'link-orphaned-observations.js',
    description: 'Link orphaned observations to canonical people',
    defaultDryRun: true,
  },
  'migrate-url-ids': {
    script: 'migrate-url-to-stable-ids.js',
    description: 'Migrate URL-based person _id values to stable IDs',
    defaultDryRun: true,
  },
  'replay-dead-letters': {
    script: 'replayDeadLetters.js',
    description: 'Replay failed person upserts from the dead letter queue',
    defaultDryRun: false,
  },
  'rebuild-companies': {
    script: 'rebuildCompanies.js',
    description: 'Rebuild company collection from observations',
    defaultDryRun: true,
  },
  'rebuild-locations': {
    script: 'rebuildLocations.js',
    description: 'Rebuild location collection from observations',
    defaultDryRun: true,
  },
  'backfill-canonical': {
    script: 'backfillCanonicalId.js',
    description: 'Backfill missing canonical IDs',
    defaultDryRun: true,
  },
  'dedupe-aliases': {
    script: 'dedupeAliases.js',
    description: 'Deduplicate alias arrays on person records',
    defaultDryRun: true,
  },
  'backfill-seniority': {
    script: 'backfillSeniority.js',
    description: 'Backfill seniority classifications on person roles',
    defaultDryRun: false,
  },
  'health-check': {
    script: 'health-check.js',
    description: 'Run a health check against the database',
    defaultDryRun: false,
  },
  'dedupe-observations': {
    script: 'dedupeObservations.js',
    description: 'Remove duplicate visit/scan observations',
    defaultDryRun: true,
  },
  'analyze-duplicates': {
    script: 'analyze-duplicates.js',
    description: 'Analyze potential duplicate person records',
    defaultDryRun: false,
  },
};

function printHelp() {
  console.log('DuxSoup ETL Operations CLI\n');
  console.log('Usage: node scripts/cli.js <command> [options]\n');
  console.log('Commands:');

  const maxLen = Math.max(...Object.keys(COMMANDS).map(k => k.length));
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    const dryRunNote = cmd.defaultDryRun ? ' (dry-run by default)' : '';
    console.log(`  ${name.padEnd(maxLen + 2)}${cmd.description}${dryRunNote}`);
  }

  console.log('\nGlobal options:');
  console.log('  --dry-run     Preview changes without writing');
  console.log('  --execute     Actually perform the operation');
  console.log('  --resume      Resume from last checkpoint (if available)');
  console.log('  --help        Show this help message');
  console.log('\nExamples:');
  console.log('  node scripts/cli.js merge-duplicates --dry-run');
  console.log('  node scripts/cli.js link-orphans --execute');
  console.log('  node scripts/cli.js migrate-url-ids --execute --resume');
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const commandName = args[0];
  const command = COMMANDS[commandName];

  if (!command) {
    console.error(`Unknown command: ${commandName}\n`);
    console.error(`Available commands: ${Object.keys(COMMANDS).join(', ')}`);
    process.exit(1);
  }

  const scriptPath = path.join(__dirname, command.script);
  const passthrough = args.slice(1);

  // If the command defaults to dry-run and user didn't specify --execute, inject --dry-run
  if (command.defaultDryRun && !passthrough.includes('--execute')) {
    if (!passthrough.includes('--dry-run')) {
      passthrough.push('--dry-run');
    }
  }

  console.log(`Running: ${commandName} ${passthrough.join(' ')}\n`);

  try {
    execFileSync('node', [scriptPath, ...passthrough], {
      stdio: 'inherit',
      env: process.env,
    });
  } catch (error) {
    if (error.status) {
      process.exit(error.status);
    }
    throw error;
  }
}

main();
