#!/usr/bin/env node

/**
 * Sample-based Orphaned Observations Analysis - Phase 3
 *
 * Uses statistical sampling to quickly analyze orphaned observations
 * without processing all 75,000+ documents.
 */

const mongoose = require('mongoose');
const fs = require('fs');
const database = require('../src/utils/database');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const identityMatcher = require('../src/utils/identityMatcher');
const logger = require('../src/utils/logger');

const SAMPLE_SIZE = 1000; // Sample 1000 of each type for analysis

async function getAllReferencedObservations() {
  logger.info('Building set of all referenced observation IDs...');

  const referencedVisits = new Set();
  const referencedScans = new Set();

  // Use aggregation to get all observation refs efficiently
  const result = await Person.aggregate([
    {
      $project: {
        visits: { $ifNull: ['$observations.visits', []] },
        scans: { $ifNull: ['$observations.scans', []] }
      }
    },
    {
      $unwind: { path: '$visits', preserveNullAndEmptyArrays: true }
    },
    {
      $group: {
        _id: null,
        visitIds: { $addToSet: '$visits' },
        scanIds: { $push: '$scans' }
      }
    }
  ]);

  // Flatten the scan arrays
  const scanResult = await Person.aggregate([
    {
      $project: {
        scans: { $ifNull: ['$observations.scans', []] }
      }
    },
    {
      $unwind: { path: '$scans', preserveNullAndEmptyArrays: true }
    },
    {
      $group: {
        _id: null,
        scanIds: { $addToSet: '$scans' }
      }
    }
  ]);

  if (result.length > 0 && result[0].visitIds) {
    result[0].visitIds.forEach(id => {
      if (id) referencedVisits.add(id.toString());
    });
  }

  if (scanResult.length > 0 && scanResult[0].scanIds) {
    scanResult[0].scanIds.forEach(id => {
      if (id) referencedScans.add(id.toString());
    });
  }

  logger.info(`Found ${referencedVisits.size} unique referenced visits`);
  logger.info(`Found ${referencedScans.size} unique referenced scans`);

  return { referencedVisits, referencedScans };
}

async function sampleOrphans(collectionName, Model, referencedIds, sampleSize) {
  logger.info(`Sampling ${sampleSize} ${collectionName}...`);

  // Get random sample using aggregation
  const sample = await Model.aggregate([
    { $sample: { size: sampleSize } }
  ]);

  const orphaned = [];
  const referenced = [];

  for (const doc of sample) {
    if (referencedIds.has(doc._id.toString())) {
      referenced.push(doc._id);
    } else {
      orphaned.push(doc);
    }
  }

  logger.info(`Sample: ${referenced.length} referenced, ${orphaned.length} orphaned`);

  return { orphaned, referenced, total: sample.length };
}

async function categorizeOrphan(observation, type) {
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

  return {
    category: 'ambiguous',
    matching_person_ids: matchingPeople.map(p => p._id),
    identifiers,
    observation_id: observation._id,
    type
  };
}

async function main() {
  try {
    await database.connect();
    logger.info('Starting sample-based orphaned observations analysis...');

    // Get total counts
    const totalPeople = await Person.countDocuments();
    const totalVisits = await Visit.countDocuments();
    const totalScans = await Scan.countDocuments();

    logger.info(`Database: ${totalPeople} people, ${totalVisits} visits, ${totalScans} scans`);

    // Step 1: Get all referenced observations
    const { referencedVisits, referencedScans } = await getAllReferencedObservations();

    // Step 2: Sample observations
    const visitSample = await sampleOrphans('visits', Visit, referencedVisits, Math.min(SAMPLE_SIZE, totalVisits));
    const scanSample = await sampleOrphans('scans', Scan, referencedScans, Math.min(SAMPLE_SIZE, totalScans));

    // Step 3: Categorize orphaned samples
    logger.info('Categorizing orphaned samples...');

    const categorized = {
      visits: { linkable: [], ambiguous: [], unresolvable: [] },
      scans: { linkable: [], ambiguous: [], unresolvable: [] }
    };

    for (const visit of visitSample.orphaned) {
      const result = await categorizeOrphan(visit, 'visit');
      categorized.visits[result.category].push(result);
    }

    for (const scan of scanSample.orphaned) {
      const result = await categorizeOrphan(scan, 'scan');
      categorized.scans[result.category].push(result);
    }

    // Step 4: Extrapolate to full dataset
    const visitOrphanRate = visitSample.orphaned.length / visitSample.total;
    const scanOrphanRate = scanSample.orphaned.length / scanSample.total;

    const estimatedOrphanedVisits = Math.round(totalVisits * visitOrphanRate);
    const estimatedOrphanedScans = Math.round(totalScans * scanOrphanRate);

    const visitLinkableRate = categorized.visits.linkable.length / (visitSample.orphaned.length || 1);
    const visitAmbiguousRate = categorized.visits.ambiguous.length / (visitSample.orphaned.length || 1);
    const visitUnresolvableRate = categorized.visits.unresolvable.length / (visitSample.orphaned.length || 1);

    const scanLinkableRate = categorized.scans.linkable.length / (scanSample.orphaned.length || 1);
    const scanAmbiguousRate = categorized.scans.ambiguous.length / (scanSample.orphaned.length || 1);
    const scanUnresolvableRate = categorized.scans.unresolvable.length / (scanSample.orphaned.length || 1);

    // Step 5: Print report
    console.log('\n');
    console.log('ORPHANED OBSERVATIONS ANALYSIS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`Sample Size: ${SAMPLE_SIZE} per type\n`);

    console.log('Visits:');
    console.log(`  Total: ${totalVisits.toLocaleString()}`);
    console.log(`  Referenced (unique): ${referencedVisits.size.toLocaleString()}`);
    console.log(`  Orphaned (estimated): ${estimatedOrphanedVisits.toLocaleString()} (${(visitOrphanRate * 100).toFixed(1)}% of total)`);
    console.log('  ');
    console.log('  Sample Breakdown:');
    console.log(`    Sampled: ${visitSample.total}`);
    console.log(`    Referenced: ${visitSample.referenced.length}`);
    console.log(`    Orphaned: ${visitSample.orphaned.length}`);
    console.log('  ');
    console.log('  Estimated Full Dataset:');
    console.log(`    Linkable: ~${Math.round(estimatedOrphanedVisits * visitLinkableRate).toLocaleString()} (${(visitLinkableRate * 100).toFixed(1)}%)`);
    console.log(`    Ambiguous: ~${Math.round(estimatedOrphanedVisits * visitAmbiguousRate).toLocaleString()} (${(visitAmbiguousRate * 100).toFixed(1)}%)`);
    console.log(`    Unresolvable: ~${Math.round(estimatedOrphanedVisits * visitUnresolvableRate).toLocaleString()} (${(visitUnresolvableRate * 100).toFixed(1)}%)`);
    console.log('');

    console.log('Scans:');
    console.log(`  Total: ${totalScans.toLocaleString()}`);
    console.log(`  Referenced (unique): ${referencedScans.size.toLocaleString()}`);
    console.log(`  Orphaned (estimated): ${estimatedOrphanedScans.toLocaleString()} (${(scanOrphanRate * 100).toFixed(1)}% of total)`);
    console.log('  ');
    console.log('  Sample Breakdown:');
    console.log(`    Sampled: ${scanSample.total}`);
    console.log(`    Referenced: ${scanSample.referenced.length}`);
    console.log(`    Orphaned: ${scanSample.orphaned.length}`);
    console.log('  ');
    console.log('  Estimated Full Dataset:');
    console.log(`    Linkable: ~${Math.round(estimatedOrphanedScans * scanLinkableRate).toLocaleString()} (${(scanLinkableRate * 100).toFixed(1)}%)`);
    console.log(`    Ambiguous: ~${Math.round(estimatedOrphanedScans * scanAmbiguousRate).toLocaleString()} (${(scanAmbiguousRate * 100).toFixed(1)}%)`);
    console.log(`    Unresolvable: ~${Math.round(estimatedOrphanedScans * scanUnresolvableRate).toLocaleString()} (${(scanUnresolvableRate * 100).toFixed(1)}%)`);
    console.log('');

    // Sample linkable
    console.log('Sample linkable visits (first 5):');
    categorized.visits.linkable.slice(0, 5).forEach(item => {
      console.log(`  - ${item.observation_id} | ${item.person_id} | ${item.match_type}`);
    });
    console.log('');

    console.log('Sample linkable scans (first 5):');
    categorized.scans.linkable.slice(0, 5).forEach(item => {
      console.log(`  - ${item.observation_id} | ${item.person_id} | ${item.match_type}`);
    });
    console.log('');

    // Sample unresolvable
    console.log('Sample unresolvable visits (first 5):');
    categorized.visits.unresolvable.slice(0, 5).forEach(item => {
      const ids = Object.entries(item.identifiers)
        .filter(([k, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') || 'none';
      console.log(`  - ${item.observation_id} | ${ids} | ${item.reason}`);
    });
    console.log('');

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

    // Save report
    const reportPath = '/home/harelabs/01-projects/duxsoup-etl/orphaned-observations-sample-report.json';
    fs.writeFileSync(reportPath, JSON.stringify({
      metadata: {
        sampleSize: SAMPLE_SIZE,
        timestamp: new Date().toISOString()
      },
      summary: {
        visits: {
          total: totalVisits,
          referencedUnique: referencedVisits.size,
          sampledTotal: visitSample.total,
          sampledReferenced: visitSample.referenced.length,
          sampledOrphaned: visitSample.orphaned.length,
          orphanRate: visitOrphanRate,
          estimatedOrphaned: estimatedOrphanedVisits,
          estimatedLinkable: Math.round(estimatedOrphanedVisits * visitLinkableRate),
          estimatedAmbiguous: Math.round(estimatedOrphanedVisits * visitAmbiguousRate),
          estimatedUnresolvable: Math.round(estimatedOrphanedVisits * visitUnresolvableRate)
        },
        scans: {
          total: totalScans,
          referencedUnique: referencedScans.size,
          sampledTotal: scanSample.total,
          sampledReferenced: scanSample.referenced.length,
          sampledOrphaned: scanSample.orphaned.length,
          orphanRate: scanOrphanRate,
          estimatedOrphaned: estimatedOrphanedScans,
          estimatedLinkable: Math.round(estimatedOrphanedScans * scanLinkableRate),
          estimatedAmbiguous: Math.round(estimatedOrphanedScans * scanAmbiguousRate),
          estimatedUnresolvable: Math.round(estimatedOrphanedScans * scanUnresolvableRate)
        }
      },
      samples: categorized
    }, null, 2));

    console.log(`Detailed report saved to: ${reportPath}\n`);

    logger.info('Analysis complete');
    process.exit(0);
  } catch (error) {
    logger.error('Analysis failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

main();
