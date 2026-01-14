#!/usr/bin/env node

/**
 * Safe People Duplicate Detection and Merge Script
 *
 * Detects and merges duplicate person records using multiple strategies:
 * 1. Overlapping aliases (same alias value on multiple people)
 * 2. Same Sales Navigator ID or Numeric ID
 * 3. Same name + overlapping identifiers
 *
 * Merge Strategy:
 * - Keep person with most observations (richer data)
 * - Merge observations arrays (visits + scans)
 * - Merge aliases (dedupe by type+value)
 * - Merge roles (dedupe by timeline)
 * - Update snapshot with most recent data
 * - Create Merge audit record
 * - Backup before deletion
 *
 * Usage:
 *   node scripts/dedupe-people.js --dry-run
 *   node scripts/dedupe-people.js --execute
 *   node scripts/dedupe-people.js --strategy=aliases --dry-run
 *   node scripts/dedupe-people.js --strategy=all --execute
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Person = require('../src/models/person');
const Merge = require('../src/models/merge');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');

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
 * Detection Strategy 1: Overlapping Aliases
 * Find people who share the same alias value
 */
async function detectOverlappingAliases() {
  section('Strategy 1: Detect Overlapping Aliases');

  const duplicates = await Person.aggregate([
    { $match: { aliases: { $exists: true, $ne: [] } } },
    { $unwind: '$aliases' },
    {
      $group: {
        _id: {
          type: '$aliases.type',
          value: '$aliases.value',
        },
        count: { $sum: 1 },
        person_ids: { $addToSet: '$_id' },
        canonical_ids: { $addToSet: '$canonical_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);

  log(`\nFound ${duplicates.length} alias conflicts`, duplicates.length > 0 ? 'yellow' : 'green');

  if (duplicates.length > 0) {
    log('\nTop 10 conflicting aliases:', 'yellow');
    for (const dup of duplicates.slice(0, 10)) {
      const displayValue = dup._id.value.length > 50
        ? dup._id.value.substring(0, 50) + '...'
        : dup._id.value;
      log(`  ${dup._id.type}: ${displayValue}`, 'cyan');
      log(`    ${dup.count} people affected: ${dup.person_ids.join(', ')}`, 'cyan');
    }
  }

  return duplicates;
}

/**
 * Detection Strategy 2: Same Stable Identifier
 * Find people with same Sales Nav ID or Numeric ID in aliases
 */
async function detectSameStableId() {
  section('Strategy 2: Detect Same Stable Identifier');

  // Find Sales Nav ID duplicates
  const salesNavDupes = await Person.aggregate([
    { $match: { 'aliases.type': 'salesNavId' } },
    { $unwind: '$aliases' },
    { $match: { 'aliases.type': 'salesNavId' } },
    {
      $group: {
        _id: '$aliases.value',
        count: { $sum: 1 },
        person_ids: { $addToSet: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);

  // Find Numeric ID duplicates
  const numericIdDupes = await Person.aggregate([
    { $match: { 'aliases.type': 'numericId' } },
    { $unwind: '$aliases' },
    { $match: { 'aliases.type': 'numericId' } },
    {
      $group: {
        _id: '$aliases.value',
        count: { $sum: 1 },
        person_ids: { $addToSet: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);

  log(`\nSales Nav ID duplicates: ${salesNavDupes.length}`, salesNavDupes.length > 0 ? 'red' : 'green');
  log(`Numeric ID duplicates: ${numericIdDupes.length}`, numericIdDupes.length > 0 ? 'red' : 'green');

  if (salesNavDupes.length > 0) {
    log('\nTop 5 Sales Nav ID duplicates:', 'yellow');
    for (const dup of salesNavDupes.slice(0, 5)) {
      log(`  ${dup._id}: ${dup.person_ids.join(', ')}`, 'cyan');
    }
  }

  if (numericIdDupes.length > 0) {
    log('\nTop 5 Numeric ID duplicates:', 'yellow');
    for (const dup of numericIdDupes.slice(0, 5)) {
      log(`  ${dup._id}: ${dup.person_ids.join(', ')}`, 'cyan');
    }
  }

  return [...salesNavDupes, ...numericIdDupes];
}

/**
 * Detection Strategy 3: Same Name + Location
 * Find people with identical full names and locations (may be legitimate different people)
 */
async function detectSameNameLocation() {
  section('Strategy 3: Detect Same Name + Location (Review Needed)');

  const duplicates = await Person.aggregate([
    {
      $match: {
        'snapshot.fullName': { $ne: null, $ne: '' },
        'snapshot.location': { $ne: null, $ne: '' },
      },
    },
    {
      $group: {
        _id: {
          name: '$snapshot.fullName',
          location: '$snapshot.location',
        },
        count: { $sum: 1 },
        person_ids: { $addToSet: '$_id' },
        companies: { $addToSet: '$snapshot.currentCompany' },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);

  log(`\nFound ${duplicates.length} name+location duplicates (manual review recommended)`, 'yellow');

  if (duplicates.length > 0) {
    log('\nTop 10 cases:', 'yellow');
    for (const dup of duplicates.slice(0, 10)) {
      log(`  ${dup._id.name} @ ${dup._id.location}`, 'cyan');
      log(`    ${dup.count} people, companies: ${dup.companies.filter(Boolean).join(', ')}`, 'cyan');
    }
  }

  return duplicates;
}

/**
 * Group people by duplicate detection
 * Returns array of duplicate groups to merge
 */
async function groupDuplicates(aliasDuplicates, stableIdDuplicates) {
  const groups = [];

  // Process overlapping aliases
  for (const dup of aliasDuplicates) {
    const peopleData = await Person.find({ _id: { $in: dup.person_ids } }).lean();

    groups.push({
      reason: 'alias_conflict',
      aliasType: dup._id.type,
      aliasValue: dup._id.value,
      people: peopleData,
    });
  }

  // Process stable ID duplicates
  for (const dup of stableIdDuplicates) {
    const peopleData = await Person.find({ _id: { $in: dup.person_ids } }).lean();

    groups.push({
      reason: 'duplicate_detection',
      identifier: dup._id,
      people: peopleData,
    });
  }

  return groups;
}

/**
 * Choose which person to keep (winner) based on data richness
 * Priority: Most observations > Most recent observation > Oldest record
 */
function chooseWinner(people) {
  return people.sort((a, b) => {
    // 1. Most observations (visits + scans)
    const aObsCount = (a.observations?.visits?.length || 0) + (a.observations?.scans?.length || 0);
    const bObsCount = (b.observations?.visits?.length || 0) + (b.observations?.scans?.length || 0);
    if (aObsCount !== bObsCount) return bObsCount - aObsCount;

    // 2. Most recent observation
    const aLastObs = a.meta?.lastObservedAt || new Date(0);
    const bLastObs = b.meta?.lastObservedAt || new Date(0);
    if (aLastObs !== bLastObs) return bLastObs - aLastObs;

    // 3. Oldest created (original record)
    return (a.createdAt || new Date()) - (b.createdAt || new Date());
  })[0];
}

/**
 * Merge two people - combine aliases, observations, roles
 */
function mergePeople(winner, loser) {
  const merged = { ...winner };

  // Merge aliases (dedupe by type+value)
  const aliasMap = new Map();

  for (const alias of [...(winner.aliases || []), ...(loser.aliases || [])]) {
    const key = `${alias.type}:${alias.value}`;
    if (!aliasMap.has(key)) {
      aliasMap.set(key, alias);
    }
  }
  merged.aliases = Array.from(aliasMap.values());

  // Merge observations
  merged.observations = {
    visits: [
      ...(winner.observations?.visits || []),
      ...(loser.observations?.visits || []),
    ],
    scans: [
      ...(winner.observations?.scans || []),
      ...(loser.observations?.scans || []),
    ],
  };

  // Merge roles (dedupe by title+company+startDate)
  const roleMap = new Map();

  for (const role of [...(winner.snapshot?.roles || []), ...(loser.snapshot?.roles || [])]) {
    const key = `${role.title}|${role.companyName}|${role.startDate}`;
    if (!roleMap.has(key)) {
      roleMap.set(key, role);
    }
  }
  if (!merged.snapshot) merged.snapshot = {};
  merged.snapshot.roles = Array.from(roleMap.values());

  // Merge education (dedupe by school+degree+field)
  const educationMap = new Map();

  for (const edu of [...(winner.snapshot?.education || []), ...(loser.snapshot?.education || [])]) {
    const key = `${edu.school}|${edu.degree}|${edu.field}`;
    if (!educationMap.has(key)) {
      educationMap.set(key, edu);
    }
  }
  merged.snapshot.education = Array.from(educationMap.values());

  // Merge skills (unique)
  merged.snapshot.skills = [
    ...new Set([
      ...(winner.snapshot?.skills || []),
      ...(loser.snapshot?.skills || []),
    ]),
  ];

  // Update observation metadata
  merged.meta = {
    ...winner.meta,
    observationsCount: merged.observations.visits.length + merged.observations.scans.length,
    lastObservedAt: new Date(Math.max(
      winner.meta?.lastObservedAt || 0,
      loser.meta?.lastObservedAt || 0,
    )),
  };

  return merged;
}

/**
 * Perform safe merge of duplicate groups
 */
async function performMerge(duplicateGroups, dryRun = true) {
  section(`${dryRun ? 'Simulating' : 'Performing'} Merge`);

  if (duplicateGroups.length === 0) {
    log('No duplicates to merge', 'green');
    return { merged: 0, kept: 0 };
  }

  let mergedCount = 0;
  let keptCount = 0;
  const backupCollection = 'people_merge_backup';

  if (!dryRun) {
    log(`Backing up merged people to: ${backupCollection}`, 'cyan');
  }

  for (const group of duplicateGroups) {
    const winner = chooseWinner(group.people);
    const losers = group.people.filter(p => p._id !== winner._id);

    if (dryRun) {
      log(`\n[DRY RUN] Would merge ${losers.length} people into ${winner._id}`, 'blue');
      log(`  Reason: ${group.reason}`, 'blue');
      log(`  Winner: ${winner._id} (${winner.observations?.visits?.length || 0} visits, ${winner.observations?.scans?.length || 0} scans)`, 'blue');
      for (const loser of losers) {
        log(`  Loser: ${loser._id} (${loser.observations?.visits?.length || 0} visits, ${loser.observations?.scans?.length || 0} scans)`, 'blue');
      }
    } else {
      // Merge data
      let mergedPerson = winner;
      for (const loser of losers) {
        mergedPerson = mergePeople(mergedPerson, loser);
      }

      // Update winner with merged data
      await Person.updateOne({ _id: winner._id }, { $set: mergedPerson });

      // Update observations to point to winner
      const loserIds = losers.map(l => l._id);
      await Visit.updateMany(
        { 'person_id': { $in: loserIds } },
        { $set: { person_id: winner._id } }
      );
      await Scan.updateMany(
        { 'person_id': { $in: loserIds } },
        { $set: { person_id: winner._id } }
      );

      // Create merge audit record
      await Merge.create({
        winner_id: winner._id,
        loser_ids: loserIds,
        reason: group.reason,
        metadata: {
          aliasType: group.aliasType,
          aliasValue: group.aliasValue,
          identifier: group.identifier,
          winnerObservations: mergedPerson.observations.visits.length + mergedPerson.observations.scans.length,
        },
      });

      // Backup and delete losers
      for (const loser of losers) {
        // Use replaceOne with upsert to handle duplicates in backup
        await mongoose.connection.db.collection(backupCollection).replaceOne(
          { _id: loser._id },
          {
            ...loser,
            _merge_reason: group.reason,
            _merge_date: new Date(),
            _merged_into: winner._id,
          },
          { upsert: true }
        );

        await Person.deleteOne({ _id: loser._id });
        mergedCount++;
      }

      keptCount++;

      if (keptCount % 10 === 0) {
        log(`Processed ${keptCount} groups (${mergedCount} people merged)...`, 'cyan');
      }
    }
  }

  log('\nMerge Summary:', 'bright');
  log(`  Groups processed: ${duplicateGroups.length}`, 'cyan');
  log(`  Winners kept: ${dryRun ? duplicateGroups.length : keptCount}`, 'green');
  log(`  Losers merged: ${dryRun ? duplicateGroups.reduce((sum, g) => sum + (g.people.length - 1), 0) : mergedCount}`, 'yellow');

  if (!dryRun) {
    log(`  Backup location: ${backupCollection}`, 'cyan');
  }

  return { merged: mergedCount, kept: keptCount };
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const strategyArg = args.find(arg => arg.startsWith('--strategy='));
  const strategy = strategyArg ? strategyArg.split('=')[1] : 'all';

  log('\n' + '='.repeat(70), 'bright');
  log('PEOPLE DUPLICATE DETECTION AND MERGE', 'bright');
  log('='.repeat(70), 'bright');
  log(`Strategy: ${strategy}`, 'cyan');
  log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`, dryRun ? 'yellow' : 'red');
  log('='.repeat(70) + '\n', 'bright');

  if (dryRun) {
    log('Running in DRY RUN mode - no changes will be made', 'yellow');
    log('Use --execute to actually perform merge\n', 'yellow');
  } else {
    log('WARNING: Running in EXECUTE mode - changes will be made!', 'red');
    log('Merged people will be backed up before deletion\n', 'red');
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    log('Connected to MongoDB\n', 'green');

    const totalPeople = await Person.countDocuments();
    log(`Total people in database: ${totalPeople.toLocaleString()}\n`, 'cyan');

    let aliasDuplicates = [];
    let stableIdDuplicates = [];
    let nameLocationDuplicates = [];

    // Run detection strategies
    if (strategy === 'all' || strategy === 'aliases') {
      aliasDuplicates = await detectOverlappingAliases();
    }

    if (strategy === 'all' || strategy === 'stable-ids') {
      stableIdDuplicates = await detectSameStableId();
    }

    if (strategy === 'all' || strategy === 'names') {
      nameLocationDuplicates = await detectSameNameLocation();
      log('\nNOTE: Name+location duplicates require manual review (may be different people)', 'yellow');
      log('Use --strategy=aliases or --strategy=stable-ids for safe automatic merge\n', 'yellow');
    }

    // Only auto-merge alias and stable ID duplicates (safe)
    const safeToMerge = [...aliasDuplicates, ...stableIdDuplicates];

    if (safeToMerge.length === 0) {
      log('\nNo duplicates found to merge!', 'green');
    } else {
      const duplicateGroups = await groupDuplicates(aliasDuplicates, stableIdDuplicates);
      const mergeResults = await performMerge(duplicateGroups, dryRun);

      // Final summary
      section('FINAL SUMMARY');
      log(`Original people: ${totalPeople.toLocaleString()}`, 'cyan');
      log(`Duplicate groups found: ${duplicateGroups.length}`, 'yellow');
      log(`People after merge: ${(totalPeople - mergeResults.merged).toLocaleString()}`, 'green');
      log('='.repeat(70) + '\n', 'bright');

      if (dryRun) {
        log('This was a DRY RUN - no changes were made', 'yellow');
        log('Run with --execute to actually perform merge', 'yellow');
      } else {
        log('Merge complete!', 'green');
        log('Backup collection: people_merge_backup', 'cyan');
        log('Merge audit records created in merges collection', 'cyan');
      }
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
  detectOverlappingAliases,
  detectSameStableId,
  detectSameNameLocation,
  mergePeople,
  performMerge,
};
