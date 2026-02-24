#!/usr/bin/env node

/**
 * Merge duplicate people with high-confidence heuristics.
 *
 * Usage:
 *   node scripts/merge-duplicates.js --dry-run --output=merge-review.csv
 *   node scripts/merge-duplicates.js --execute --limit-groups=100
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const Person = require('../src/models/person');
const identityResolverService = require('../src/services/identityResolverService');
const logger = require('../src/utils/logger');

const args = process.argv.slice(2);
const isExecute = args.includes('--execute');
const isDryRun = args.includes('--dry-run') || !isExecute;
const isForce = args.includes('--force');

const limitArg = args.find(arg => arg.startsWith('--limit-groups='));
const limitGroups = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

const outputArg = args.find(arg => arg.startsWith('--output='));
const outputPath = outputArg
  ? outputArg.split('=')[1]
  : path.join(process.cwd(), 'merge-duplicates.csv');

function normalizeValue(value) {
  return value ? value.toString().trim().toLowerCase() : null;
}

function buildGroupKey(person) {
  const name = normalizeValue(person.snapshot?.fullName);
  const company = normalizeValue(person.snapshot?.currentCompany);
  if (!name || !company) {
    return null;
  }

  const location = normalizeValue(person.snapshot?.location);
  const title = normalizeValue(person.snapshot?.currentTitle);

  if (location) {
    return `${name}|${company}|location:${location}`;
  }

  if (title) {
    return `${name}|${company}|title:${title}`;
  }

  return null;
}

function formatCsvRow(values) {
  return values
    .map(value => {
      const text = value === null || value === undefined ? '' : value.toString();
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    })
    .join(',');
}

async function run() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is not set');
  }

  await mongoose.connect(mongoUri, {
    dbName: process.env.MONGODB_DB_NAME || "duxsoup",
    serverSelectionTimeoutMS: 30000,
  });

  logger.info('Connected to MongoDB');

  const cursor = Person.find(
    {},
    {
      _id: 1,
      canonical_id: 1,
      aliases: 1,
      snapshot: 1,
      observations: 1,
    },
  ).cursor();

  const grouped = new Map();

  for await (const person of cursor) {
    const key = buildGroupKey(person);
    if (!key) {
      continue;
    }

    const existing = grouped.get(key) || [];
    existing.push(person);
    grouped.set(key, existing);
  }

  const candidateGroups = Array.from(grouped.values()).filter(
    group => group.length > 1,
  );

  logger.info('Found candidate groups', {
    groups: candidateGroups.length,
    dryRun: isDryRun,
  });

  let processedGroups = 0;
  let mergedGroups = 0;
  let mergedPeople = 0;

  const csvRows = [
    formatCsvRow([
      'groupKey',
      'fullName',
      'currentCompany',
      'location',
      'currentTitle',
      'personIds',
      'canonicalIds',
      'observationsCount',
      'aliasCounts',
    ]),
  ];

  for (const group of candidateGroups) {
    if (limitGroups && processedGroups >= limitGroups) {
      break;
    }

    processedGroups += 1;

    const representative = group[0];
    const groupKey = buildGroupKey(representative);

    csvRows.push(
      formatCsvRow([
        groupKey,
        representative.snapshot?.fullName || '',
        representative.snapshot?.currentCompany || '',
        representative.snapshot?.location || '',
        representative.snapshot?.currentTitle || '',
        group.map(person => person._id).join('|'),
        group.map(person => person.canonical_id).join('|'),
        group
          .map(
            person =>
              (person.observations?.visits?.length || 0) +
              (person.observations?.scans?.length || 0),
          )
          .join('|'),
        group.map(person => person.aliases?.length || 0).join('|'),
      ]),
    );

    if (isDryRun) {
      continue;
    }

    const ids = group.map(person => person._id);
    const people = await Person.find({ _id: { $in: ids } });

    if (people.length < 2) {
      continue;
    }

    const winner = identityResolverService.determineWinner(people);
    const losers = people.filter(person => person._id !== winner._id);

    await identityResolverService.mergePeople(winner, losers, {
      reason: 'duplicate_detection',
      force: isForce,
    });

    mergedGroups += 1;
    mergedPeople += losers.length;
  }

  if (isDryRun) {
    fs.writeFileSync(outputPath, csvRows.join('\n'));
  }

  logger.info('Duplicate merge summary', {
    processedGroups,
    mergedGroups,
    mergedPeople,
    outputPath: isDryRun ? outputPath : null,
    mode: isDryRun ? 'dry-run' : 'execute',
  });

  await mongoose.disconnect();
}

run().catch(error => {
  logger.error('Duplicate merge failed', { error: error.message });
  process.exit(1);
});
