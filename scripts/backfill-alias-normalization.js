#!/usr/bin/env node

/**
 * Backfill alias normalization for existing people records.
 *
 * Adds normalized aliases without changing canonical IDs.
 *
 * Usage:
 *   node scripts/backfill-alias-normalization.js --dry-run
 *   node scripts/backfill-alias-normalization.js --execute
 *   node scripts/backfill-alias-normalization.js --execute --limit=1000 --batch-size=200
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Person = require('../src/models/person');
const logger = require('../src/utils/logger');
const identityMatcher = require('../src/utils/identityMatcher');
const {
  extractSalesNavIdFromUrl,
  normalizeToCanonicalCase,
  extractNumericId,
} = require('../src/utils/salesNavIdExtractor');

const args = process.argv.slice(2);
const isExecute = args.includes('--execute');
const isDryRun = args.includes('--dry-run') || !isExecute;

const limitArg = args.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

const batchArg = args.find(arg => arg.startsWith('--batch-size='));
const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) : 250;

function normalizeValue(value) {
  return value ? value.toString().trim().toLowerCase() : null;
}

function isLikelyLinkedInUrl(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.includes('linkedin.com/');
}

function extractUsernameFromUrl(url) {
  if (!url) return null;
  const normalized = identityMatcher.normalizeUrl(url);
  if (!normalized) return null;
  const match = normalized.match(/linkedin\.com\/in\/([^\/\?]+)/);
  if (!match) return null;
  return match[1].toLowerCase();
}

function buildAliasMap(aliases = []) {
  const map = new Map();
  aliases.forEach(alias => {
    if (!alias?.type || !alias?.value) return;
    map.set(`${alias.type}:${alias.value}`, alias.value);
  });
  return map;
}

function addAlias(aliasesToAdd, existingMap, type, value) {
  if (!value) return;
  const key = `${type}:${value}`;
  if (existingMap.has(key)) return;
  existingMap.set(key, value);
  aliasesToAdd.push({ type, value });
}

async function run() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is not set');
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 30000,
  });

  logger.info('Connected to MongoDB');

  const query = {};
  if (limit) {
    logger.info(`Limiting to ${limit} records`);
  }

  const cursor = Person.find(query).cursor();

  let processed = 0;
  let updated = 0;
  let totalAliasesAdded = 0;

  const pendingUpdates = [];

  for await (const person of cursor) {
    if (limit && processed >= limit) {
      break;
    }

    processed += 1;
    const existingMap = buildAliasMap(person.aliases);
    const aliasesToAdd = [];

    const allAliasValues = (person.aliases || [])
      .filter(alias => alias?.value && isLikelyLinkedInUrl(alias.value))
      .map(alias => alias.value)
      .filter(Boolean);

    allAliasValues.forEach(value => {
      const normalizedUrl = identityMatcher.normalizeUrl(value);
      if (normalizedUrl && normalizedUrl !== value) {
        addAlias(aliasesToAdd, existingMap, 'profileUrl', normalizedUrl);
      }

      const publicUrl = identityMatcher.normalizePublicProfileUrl(value);
      if (publicUrl) {
        addAlias(aliasesToAdd, existingMap, 'publicUrl', publicUrl);
      }

      const username = extractUsernameFromUrl(value);
      if (username) {
        addAlias(aliasesToAdd, existingMap, 'linkedInUsername', username);
      }

      const salesNavId = extractSalesNavIdFromUrl(value);
      if (salesNavId) {
        addAlias(
          aliasesToAdd,
          existingMap,
          'salesNavId',
          normalizeToCanonicalCase(salesNavId),
        );
      }
    });

    const duxsoupAlias = (person.aliases || []).find(
      alias => alias?.type === 'duxsoupId' && alias?.value,
    );

    if (duxsoupAlias?.value) {
      const normalizedDuxsoup = identityMatcher.normalizeDuxsoupId(
        duxsoupAlias.value,
      );
      if (normalizedDuxsoup && normalizedDuxsoup !== duxsoupAlias.value) {
        addAlias(aliasesToAdd, existingMap, 'duxsoupId', normalizedDuxsoup);
      }

      const numericId = extractNumericId(duxsoupAlias.value);
      if (numericId) {
        addAlias(aliasesToAdd, existingMap, 'numericId', numericId);
      }
    }

    const salesNavAlias = (person.aliases || []).find(
      alias => alias?.type === 'salesNavId' && alias?.value,
    );
    if (salesNavAlias?.value) {
      const canonical = normalizeToCanonicalCase(salesNavAlias.value);
      if (canonical && canonical !== salesNavAlias.value) {
        addAlias(aliasesToAdd, existingMap, 'salesNavId', canonical);
      }
    }

    if (aliasesToAdd.length > 0) {
      updated += 1;
      totalAliasesAdded += aliasesToAdd.length;

      if (!isDryRun) {
        pendingUpdates.push({
          updateOne: {
            filter: { _id: person._id },
            update: { $addToSet: { aliases: { $each: aliasesToAdd } } },
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

  logger.info('Alias normalization backfill complete', {
    processed,
    updated,
    totalAliasesAdded,
    mode: isDryRun ? 'dry-run' : 'execute',
  });

  await mongoose.disconnect();
}

run().catch(error => {
  logger.error('Alias normalization backfill failed', { error: error.message });
  process.exit(1);
});
