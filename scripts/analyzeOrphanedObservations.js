#!/usr/bin/env node

/**
 * Orphaned Observations Analysis - Phase 3
 *
 * Analyzes orphaned Visit and Scan documents (not referenced by any Person).
 * Categorizes them as:
 * - Linkable: Found exactly 1 matching Person
 * - Ambiguous: Found 2+ matching People
 * - Unresolvable: No matching Person or missing stable ID
 */

const mongoose = require('mongoose');
const fs = require('fs');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const identityMatcher = require('../src/utils/identityMatcher');
const logger = require('../src/utils/logger');

async function categorizeOrphan(observation, type) {
  // Extract identifiers using centralized identity matcher
  const identifiers = identityMatcher.extractIdentifiers(observation);
  const primary = identityMatcher.getPrimaryIdentifier(identifiers);

  if (!primary) {
    return {
      category: 'unresolvable',
      reason: 'no_stable_id',
      identifiers: {},
      observation_id: observation._id,
      type
    };
  }

  // Build query to find matching Person by aliases
  const aliasQueries = [];

  if (identifiers.salesNavId) {
    aliasQueries.push({ 'aliases.type': 'salesNavId', 'aliases.value': identifiers.salesNavId });
  }
  if (identifiers.linkedInUsername) {
    aliasQueries.push({ 'aliases.type': 'linkedInUsername', 'aliases.value': identifiers.linkedInUsername });
  }
  if (identifiers.numericId) {
    aliasQueries.push({ 'aliases.type': 'numericId', 'aliases.value': identifiers.numericId });
  }
  if (identifiers.profileUrl) {
    aliasQueries.push({ 'aliases.type': 'profileUrl', 'aliases.value': identifiers.profileUrl });
  }

  if (aliasQueries.length === 0) {
    return {
      category: 'unresolvable',
      reason: 'no_queryable_identifiers',
      identifiers,
      observation_id: observation._id,
      type
    };
  }

  const matchingPeople = await Person.find({ $or: aliasQueries }, { _id: 1 }).lean();

  if (matchingPeople.length === 0) {
    return {
      category: 'unresolvable',
      reason: 'person_not_found',
      identifiers,
      observation_id: observation._id,
      type
    };
  }

  if (matchingPeople.length === 1) {
    return {
      category: 'linkable',
      person_id: matchingPeople[0]._id,
      match_type: primary.type,
      identifiers,
      observation_id: observation._id,
      type
    };
  }

  // Multiple matches
  return {
    category: 'ambiguous',
    matching_person_ids: matchingPeople.map(p => p._id),
    identifiers,
    observation_id: observation._id,
    type
  };
}

async function analyzeOrphanedObservations() {
  // Connect to the production database
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup';
  await mongoose.connect(mongoUri);

  logger.info('Starting orphaned observations analysis...');
  logger.info(`Connected to: ${mongoUri}`);

  // Step 1: Get all referenced observations
  logger.info('Fetching all observation references from people...');

  const people = await Person.find({}, { 'observations.visits': 1, 'observations.scans': 1 }).lean();

  const referencedVisits = new Set();
  const referencedScans = new Set();

  people.forEach(person => {
    if (person.observations?.visits) {
      person.observations.visits.forEach(id => referencedVisits.add(id.toString()));
    }
    if (person.observations?.scans) {
      person.observations.scans.forEach(id => referencedScans.add(id.toString()));
    }
  });

  logger.info(`Found ${referencedVisits.size} referenced visits, ${referencedScans.size} referenced scans`);

  // Step 2: Find orphaned observations
  logger.info('Finding orphaned observations...');

  const totalVisits = await Visit.countDocuments();
  const totalScans = await Scan.countDocuments();

  const allVisitIds = await Visit.find({}, { _id: 1 }).lean();
  const allScanIds = await Scan.find({}, { _id: 1 }).lean();

  const orphanedVisitIds = allVisitIds
    .filter(v => !referencedVisits.has(v._id.toString()))
    .map(v => v._id);

  const orphanedScanIds = allScanIds
    .filter(s => !referencedScans.has(s._id.toString()))
    .map(s => s._id);

  logger.info(`Total visits: ${totalVisits}, Orphaned: ${orphanedVisitIds.length}`);
  logger.info(`Total scans: ${totalScans}, Orphaned: ${orphanedScanIds.length}`);

  // Step 3: Categorize orphans
  logger.info('Categorizing orphaned observations...');

  const categorized = {
    visits: { linkable: [], ambiguous: [], unresolvable: [] },
    scans: { linkable: [], ambiguous: [], unresolvable: [] }
  };

  // Process visits in batches
  const visitBatchSize = 100;
  for (let i = 0; i < orphanedVisitIds.length; i += visitBatchSize) {
    const batch = orphanedVisitIds.slice(i, i + visitBatchSize);
    const visits = await Visit.find({ _id: { $in: batch } }).lean();

    for (const visit of visits) {
      const result = await categorizeOrphan(visit, 'visit');
      categorized.visits[result.category].push(result);
    }

    logger.info(`Processed ${Math.min(i + visitBatchSize, orphanedVisitIds.length)}/${orphanedVisitIds.length} visits`);
  }

  // Process scans in batches
  const scanBatchSize = 100;
  for (let i = 0; i < orphanedScanIds.length; i += scanBatchSize) {
    const batch = orphanedScanIds.slice(i, i + scanBatchSize);
    const scans = await Scan.find({ _id: { $in: batch } }).lean();

    for (const scan of scans) {
      const result = await categorizeOrphan(scan, 'scan');
      categorized.scans[result.category].push(result);
    }

    logger.info(`Processed ${Math.min(i + scanBatchSize, orphanedScanIds.length)}/${orphanedScanIds.length} scans`);
  }

  // Step 4: Print report
  console.log('\n');
  console.log('ORPHANED OBSERVATIONS ANALYSIS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Visits:');
  console.log(`  Total: ${totalVisits}`);
  console.log(`  Referenced: ${referencedVisits.size}`);
  console.log(`  Orphaned: ${orphanedVisitIds.length}`);
  console.log('  ');
  console.log('  Breakdown:');
  console.log(`    Linkable: ${categorized.visits.linkable.length} (can link to existing Person)`);
  console.log(`    Ambiguous: ${categorized.visits.ambiguous.length} (matches 2+ People)`);
  console.log(`    Unresolvable: ${categorized.visits.unresolvable.length} (no matching Person)`);
  console.log('');

  console.log('Scans:');
  console.log(`  Total: ${totalScans}`);
  console.log(`  Referenced: ${referencedScans.size}`);
  console.log(`  Orphaned: ${orphanedScanIds.length}`);
  console.log('  ');
  console.log('  Breakdown:');
  console.log(`    Linkable: ${categorized.scans.linkable.length} (can link to existing Person)`);
  console.log(`    Ambiguous: ${categorized.scans.ambiguous.length} (matches 2+ People)`);
  console.log(`    Unresolvable: ${categorized.scans.unresolvable.length} (no matching Person)`);
  console.log('');

  // Sample linkable visits
  console.log('Sample linkable visits (first 5):');
  categorized.visits.linkable.slice(0, 5).forEach(item => {
    console.log(`  - ${item.observation_id} | ${item.person_id} | ${item.match_type}`);
  });
  console.log('');

  // Sample linkable scans
  console.log('Sample linkable scans (first 5):');
  categorized.scans.linkable.slice(0, 5).forEach(item => {
    console.log(`  - ${item.observation_id} | ${item.person_id} | ${item.match_type}`);
  });
  console.log('');

  // Sample unresolvable visits
  console.log('Sample unresolvable visits (first 5):');
  categorized.visits.unresolvable.slice(0, 5).forEach(item => {
    const ids = Object.entries(item.identifiers)
      .filter(([k, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || 'none';
    console.log(`  - ${item.observation_id} | ${ids} | ${item.reason}`);
  });
  console.log('');

  // Sample unresolvable scans
  console.log('Sample unresolvable scans (first 5):');
  categorized.scans.unresolvable.slice(0, 5).forEach(item => {
    const ids = Object.entries(item.identifiers)
      .filter(([k, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || 'none';
    console.log(`  - ${item.observation_id} | ${ids} | ${item.reason}`);
  });
  console.log('');

  // Sample ambiguous
  if (categorized.visits.ambiguous.length > 0) {
    console.log('Sample ambiguous visits (first 3):');
    categorized.visits.ambiguous.slice(0, 3).forEach(item => {
      console.log(`  - ${item.observation_id} | matches: ${item.matching_person_ids.join(', ')}`);
    });
    console.log('');
  }

  if (categorized.scans.ambiguous.length > 0) {
    console.log('Sample ambiguous scans (first 3):');
    categorized.scans.ambiguous.slice(0, 3).forEach(item => {
      console.log(`  - ${item.observation_id} | matches: ${item.matching_person_ids.join(', ')}`);
    });
    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Save detailed results to file
  const reportPath = '/home/harelabs/01-projects/duxsoup-etl/orphaned-observations-report.json';
  fs.writeFileSync(reportPath, JSON.stringify({
    summary: {
      visits: {
        total: totalVisits,
        referenced: referencedVisits.size,
        orphaned: orphanedVisitIds.length,
        linkable: categorized.visits.linkable.length,
        ambiguous: categorized.visits.ambiguous.length,
        unresolvable: categorized.visits.unresolvable.length
      },
      scans: {
        total: totalScans,
        referenced: referencedScans.size,
        orphaned: orphanedScanIds.length,
        linkable: categorized.scans.linkable.length,
        ambiguous: categorized.scans.ambiguous.length,
        unresolvable: categorized.scans.unresolvable.length
      }
    },
    details: categorized
  }, null, 2));

  console.log(`\nDetailed report saved to: ${reportPath}\n`);

  logger.info('Analysis complete');
  await mongoose.disconnect();
}

analyzeOrphanedObservations().catch(console.error);
