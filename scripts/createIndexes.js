#!/usr/bin/env node

/**
 * Index Migration Script
 *
 * Creates all required indexes for canonical identity resolution system.
 * Run this during deployment if autoIndex is disabled in production.
 *
 * Usage:
 *   node scripts/createIndexes.js
 */

const mongoose = require('mongoose');
const logger = require('../src/utils/logger');

const indexCache = new Map();
const fixNonUnique = process.argv.includes('--fix-non-unique');

function keysEqual(a, b) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => a[key] === b[key]);
}

async function getIndexes(collection) {
  const name = collection.collectionName;
  if (!indexCache.has(name)) {
    try {
      indexCache.set(name, await collection.indexes());
    } catch (error) {
      if (error.codeName === 'NamespaceNotFound' || /ns does not exist/i.test(error.message)) {
        return null;
      }
      throw error;
    }
  }
  return indexCache.get(name);
}

async function ensureIndex(collection, key, options, label) {
  const indexes = await getIndexes(collection);
  if (!indexes) {
    console.log(`  - ${label} (skipped, collection missing)`);
    return;
  }
  const existing = indexes.find(idx => keysEqual(idx.key, key));

  if (existing) {
    if (options?.unique && !existing.unique) {
      if (!fixNonUnique) {
        throw new Error(`Existing index for ${label} is not unique`);
      }
      await collection.dropIndex(existing.name);
      indexCache.delete(collection.collectionName);
      await collection.createIndex(key, options);
      console.log(`  ✓ ${label} (recreated as unique)`);
      return;
    }
    console.log(`  ✓ ${label} (exists)`);
    return;
  }

  await collection.createIndex(key, options);
  indexCache.delete(collection.collectionName);
  console.log(`  ✓ ${label}`);
}

async function createIndexes() {
  console.log('📊 Starting index creation...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB\n');

    const db = mongoose.connection.db;

    // Person Collection Indexes
    console.log('Creating Person indexes...');
    const peopleCollection = db.collection('people');

    await ensureIndex(
      peopleCollection,
      { 'aliases.value': 1 },
      { name: 'aliases_value_1', background: true },
      'aliases.value (multikey)'
    );

    await ensureIndex(
      peopleCollection,
      { 'aliases.type': 1, 'aliases.value': 1 },
      { name: 'aliases_type_1_value_1', background: true },
      'aliases.type + aliases.value (compound)'
    );

    await ensureIndex(
      peopleCollection,
      { canonical_id: 1 },
      { name: 'canonical_id_1', unique: true, background: true },
      'canonical_id (unique)'
    );

    await ensureIndex(
      peopleCollection,
      { 'meta.last_observed_at': -1 },
      { name: 'meta_last_observed_at_-1', background: true },
      'meta.last_observed_at (descending)'
    );

    await ensureIndex(
      peopleCollection,
      { 'meta.observations_count': -1 },
      { name: 'meta_observations_count_-1', background: true },
      'meta.observations_count (descending)'
    );

    await ensureIndex(
      peopleCollection,
      { 'snapshot.fullName': 1 },
      { name: 'snapshot_fullName_1', background: true },
      'snapshot.fullName'
    );

    await ensureIndex(
      peopleCollection,
      { 'snapshot.currentCompany': 1 },
      { name: 'snapshot_currentCompany_1', background: true },
      'snapshot.currentCompany'
    );

    await ensureIndex(
      peopleCollection,
      { createdAt: -1 },
      { name: 'createdAt_-1', background: true },
      'createdAt (descending)'
    );

    // Visit Collection Indexes
    console.log('\nCreating Visit indexes...');
    const visitsCollection = db.collection('visits');

    await ensureIndex(
      visitsCollection,
      { event_key: 1 },
      { name: 'event_key_1', unique: true, sparse: true, background: true },
      'event_key (unique, sparse)'
    );

    // Scan Collection Indexes
    console.log('\nCreating Scan indexes...');
    const scansCollection = db.collection('scans');

    await ensureIndex(
      scansCollection,
      { event_key: 1 },
      { name: 'event_key_1', unique: true, sparse: true, background: true },
      'event_key (unique, sparse)'
    );

    // DeadLetter Collection Indexes
    console.log('\nCreating DeadLetter indexes...');
    const deadLettersCollection = db.collection('deadletters');

    await ensureIndex(
      deadLettersCollection,
      { observation_id: 1 },
      { name: 'observation_id_1', unique: true, background: true },
      'observation_id (unique)'
    );

    await ensureIndex(
      deadLettersCollection,
      { status: 1, createdAt: -1 },
      { name: 'status_1_createdAt_-1', background: true },
      'status + createdAt (compound)'
    );

    await ensureIndex(
      deadLettersCollection,
      { sourceType: 1, status: 1 },
      { name: 'sourceType_1_status_1', background: true },
      'sourceType + status (compound)'
    );

    // Merge Collection Indexes
    console.log('\nCreating Merge indexes...');
    const mergesCollection = db.collection('merges');

    await ensureIndex(
      mergesCollection,
      { winner_id: 1, timestamp: -1 },
      { name: 'winner_id_1_timestamp_-1', background: true },
      'winner_id + timestamp (compound)'
    );

    await ensureIndex(
      mergesCollection,
      { loser_ids: 1 },
      { name: 'loser_ids_1', background: true },
      'loser_ids'
    );

    await ensureIndex(
      mergesCollection,
      { timestamp: -1 },
      { name: 'timestamp_-1', background: true },
      'timestamp (descending)'
    );

    // Company Collection Indexes
    console.log('\nCreating Company indexes...');
    const companiesCollection = db.collection('companies');

    await ensureIndex(
      companiesCollection,
      { 'aliases.value': 1 },
      { name: 'aliases_value_1', background: true },
      'aliases.value (multikey)'
    );

    await ensureIndex(
      companiesCollection,
      { 'snapshot.name': 1 },
      { name: 'snapshot_name_1', background: true },
      'snapshot.name'
    );

    await ensureIndex(
      companiesCollection,
      { createdAt: -1 },
      { name: 'createdAt_-1', background: true },
      'createdAt (descending)'
    );

    console.log('\n✅ All indexes created successfully!');

    // List all indexes for verification
    console.log('\n📋 Verification - Current Indexes:\n');

    const collections = [
      { name: 'people', collection: peopleCollection },
      { name: 'visits', collection: visitsCollection },
      { name: 'scans', collection: scansCollection },
      { name: 'deadletters', collection: deadLettersCollection },
      { name: 'merges', collection: mergesCollection },
      { name: 'companies', collection: companiesCollection },
    ];

    for (const { name, collection } of collections) {
      const indexes = await collection.indexes();
      console.log(`${name} (${indexes.length} indexes):`);
      indexes.forEach(idx => {
        const keys = Object.keys(idx.key).map(k => `${k}: ${idx.key[k]}`).join(', ');
        const unique = idx.unique ? ' [UNIQUE]' : '';
        const sparse = idx.sparse ? ' [SPARSE]' : '';
        console.log(`  - ${idx.name}: { ${keys} }${unique}${sparse}`);
      });
      console.log('');
    }

    await mongoose.connection.close();
    console.log('✓ Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating indexes:', error.message);
    logger.error('Index creation failed', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

createIndexes();
