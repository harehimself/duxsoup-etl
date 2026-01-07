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

    await peopleCollection.createIndex(
      { 'aliases.value': 1 },
      { name: 'aliases_value_1', background: true }
    );
    console.log('  ✓ aliases.value (multikey)');

    await peopleCollection.createIndex(
      { 'aliases.type': 1, 'aliases.value': 1 },
      { name: 'aliases_type_1_value_1', background: true }
    );
    console.log('  ✓ aliases.type + aliases.value (compound)');

    await peopleCollection.createIndex(
      { canonical_id: 1 },
      { name: 'canonical_id_1', unique: true, background: true }
    );
    console.log('  ✓ canonical_id (unique)');

    await peopleCollection.createIndex(
      { 'meta.last_observed_at': -1 },
      { name: 'meta_last_observed_at_-1', background: true }
    );
    console.log('  ✓ meta.last_observed_at (descending)');

    await peopleCollection.createIndex(
      { 'meta.observations_count': -1 },
      { name: 'meta_observations_count_-1', background: true }
    );
    console.log('  ✓ meta.observations_count (descending)');

    await peopleCollection.createIndex(
      { 'snapshot.fullName': 1 },
      { name: 'snapshot_fullName_1', background: true }
    );
    console.log('  ✓ snapshot.fullName');

    await peopleCollection.createIndex(
      { 'snapshot.currentCompany': 1 },
      { name: 'snapshot_currentCompany_1', background: true }
    );
    console.log('  ✓ snapshot.currentCompany');

    await peopleCollection.createIndex(
      { createdAt: -1 },
      { name: 'createdAt_-1', background: true }
    );
    console.log('  ✓ createdAt (descending)');

    // Visit Collection Indexes
    console.log('\nCreating Visit indexes...');
    const visitsCollection = db.collection('visits');

    await visitsCollection.createIndex(
      { event_key: 1 },
      { name: 'event_key_1', unique: true, sparse: true, background: true }
    );
    console.log('  ✓ event_key (unique, sparse)');

    // Scan Collection Indexes
    console.log('\nCreating Scan indexes...');
    const scansCollection = db.collection('scans');

    await scansCollection.createIndex(
      { event_key: 1 },
      { name: 'event_key_1', unique: true, sparse: true, background: true }
    );
    console.log('  ✓ event_key (unique, sparse)');

    // DeadLetter Collection Indexes
    console.log('\nCreating DeadLetter indexes...');
    const deadLettersCollection = db.collection('deadletters');

    await deadLettersCollection.createIndex(
      { observation_id: 1 },
      { name: 'observation_id_1', unique: true, background: true }
    );
    console.log('  ✓ observation_id (unique)');

    await deadLettersCollection.createIndex(
      { status: 1, createdAt: -1 },
      { name: 'status_1_createdAt_-1', background: true }
    );
    console.log('  ✓ status + createdAt (compound)');

    await deadLettersCollection.createIndex(
      { sourceType: 1, status: 1 },
      { name: 'sourceType_1_status_1', background: true }
    );
    console.log('  ✓ sourceType + status (compound)');

    // Merge Collection Indexes
    console.log('\nCreating Merge indexes...');
    const mergesCollection = db.collection('merges');

    await mergesCollection.createIndex(
      { winner_id: 1, timestamp: -1 },
      { name: 'winner_id_1_timestamp_-1', background: true }
    );
    console.log('  ✓ winner_id + timestamp (compound)');

    await mergesCollection.createIndex(
      { loser_ids: 1 },
      { name: 'loser_ids_1', background: true }
    );
    console.log('  ✓ loser_ids');

    await mergesCollection.createIndex(
      { timestamp: -1 },
      { name: 'timestamp_-1', background: true }
    );
    console.log('  ✓ timestamp (descending)');

    // Company Collection Indexes
    console.log('\nCreating Company indexes...');
    const companiesCollection = db.collection('companies');

    await companiesCollection.createIndex(
      { 'aliases.value': 1 },
      { name: 'aliases_value_1', background: true }
    );
    console.log('  ✓ aliases.value (multikey)');

    await companiesCollection.createIndex(
      { 'snapshot.name': 1 },
      { name: 'snapshot_name_1', background: true }
    );
    console.log('  ✓ snapshot.name');

    await companiesCollection.createIndex(
      { createdAt: -1 },
      { name: 'createdAt_-1', background: true }
    );
    console.log('  ✓ createdAt (descending)');

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
