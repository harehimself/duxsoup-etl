#!/usr/bin/env node

/**
 * Audit salesNavId capitalization patterns and optionally standardize aliases.
 *
 * Usage:
 *   node scripts/audit-salesnavid-case.js --dry-run
 *   node scripts/audit-salesnavid-case.js --execute
 *   node scripts/audit-salesnavid-case.js --execute --limit=1000 --batch-size=200
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Person = require('../src/models/person');
const logger = require('../src/utils/logger');
const { normalizeToCanonicalCase } = require('../src/utils/salesNavIdExtractor');

const args = process.argv.slice(2);
const isExecute = args.includes('--execute');
const isDryRun = args.includes('--dry-run') || !isExecute;

const limitArg = args.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

const batchArg = args.find((arg) => arg.startsWith('--batch-size='));
const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) : 250;

function classifySalesNavId(value) {
  if (!value || typeof value !== 'string') {
    return 'missing';
  }

  const canonical = normalizeToCanonicalCase(value);
  if (!canonical) {
    return 'missing';
  }

  const hasCanonicalPrefix = /^(ACw|ACo)AA/.test(canonical);
  if (!hasCanonicalPrefix) {
    return 'nonstandard';
  }

  if (value === canonical) {
    return 'canonical';
  }

  if (value.toLowerCase() === canonical.toLowerCase()) {
    if (value === value.toLowerCase()) {
      return 'lowercase';
    }
    return 'mixed';
  }

  return 'nonstandard';
}

function normalizeSalesNavAliases(aliases = []) {
  let changed = false;
  const updated = [];
  const seenSalesNav = new Set();

  aliases.forEach((alias) => {
    if (!alias?.type || !alias?.value) {
      updated.push(alias);
      return;
    }

    if (alias.type !== 'salesNavId') {
      updated.push(alias);
      return;
    }

    const canonical = normalizeToCanonicalCase(alias.value) || alias.value;
    const key = `${alias.type}:${canonical}`;

    if (seenSalesNav.has(key)) {
      changed = true;
      return;
    }

    if (canonical !== alias.value) {
      changed = true;
    }

    seenSalesNav.add(key);
    updated.push({
      ...alias,
      value: canonical,
    });
  });

  return { updated, changed };
}

async function run() {
  // Prefer shorthand, then standard.
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('Database connection string (MONGO_URI or MONGODB_URI) is missing.');
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 30000,
  });

  logger.info('Connected to MongoDB');

  if (limit) {
    logger.info(`Limiting to ${limit} records`);
  }

  const cursor = Person.find({}).cursor();

  let processed = 0;
  let peopleWithSalesNav = 0;
  let peopleMissingSalesNav = 0;
  let peopleWithCaseVariants = 0;
  let peopleWithMultipleIds = 0;

  const counts = {
    canonical: 0,
    lowercase: 0,
    mixed: 0,
    nonstandard: 0,
  };

  const caseVariantKeys = new Map();
  const pendingUpdates = [];
  let updatedPeople = 0;

  for await (const person of cursor) {
    if (limit && processed >= limit) {
      break;
    }

    processed += 1;
    const aliases = person.aliases || [];
    const salesNavAliases = aliases.filter(
      (alias) => alias?.type === 'salesNavId' && alias?.value,
    );

    if (salesNavAliases.length === 0) {
      peopleMissingSalesNav += 1;
    } else {
      peopleWithSalesNav += 1;
    }

    const normalizedKeys = new Map();
    salesNavAliases.forEach((alias) => {
      const classification = classifySalesNavId(alias.value);
      counts[classification] += 1;

      const canonical = normalizeToCanonicalCase(alias.value) || alias.value;
      const key = canonical.toLowerCase();
      const variants = normalizedKeys.get(key) || new Set();
      variants.add(alias.value);
      normalizedKeys.set(key, variants);
    });

    for (const [key, variants] of normalizedKeys.entries()) {
      if (variants.size > 1) {
        peopleWithCaseVariants += 1;
        caseVariantKeys.set(key, (caseVariantKeys.get(key) || 0) + 1);
        break;
      }
    }

    if (normalizedKeys.size > 1) {
      peopleWithMultipleIds += 1;
    }

    if (!isDryRun && salesNavAliases.length > 0) {
      const { updated, changed } = normalizeSalesNavAliases(aliases);
      if (changed) {
        updatedPeople += 1;
        pendingUpdates.push({
          updateOne: {
            filter: { _id: person._id },
            update: { $set: { aliases: updated } },
          },
        });
      }
    }

    if (!isDryRun && pendingUpdates.length >= batchSize) {
      await Person.bulkWrite(pendingUpdates);
      pendingUpdates.length = 0;
    }
  }

  if (!isDryRun && pendingUpdates.length > 0) {
    await Person.bulkWrite(pendingUpdates);
  }

  logger.info('salesNavId capitalization audit complete', {
    processed,
    peopleWithSalesNav,
    peopleMissingSalesNav,
    peopleWithCaseVariants,
    peopleWithMultipleIds,
    caseVariantKeys: caseVariantKeys.size,
    counts,
    updatedPeople: isDryRun ? 0 : updatedPeople,
    mode: isDryRun ? 'dry-run' : 'execute',
  });

  await mongoose.disconnect();
}

run().catch((error) => {
  logger.error('salesNavId capitalization audit failed', { error: error.message });
  process.exit(1);
});
