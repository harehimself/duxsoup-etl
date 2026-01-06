#!/usr/bin/env node

/**
 * Drop Duplicate ID Index Migration
 *
 * Removes the unique constraint on the `id` field in visits and scans collections.
 * Only event_key should be unique for idempotency.
 *
 * Run this ONCE after deploying the model changes to production.
 */

const mongoose = require('mongoose');

async function dropIndexes() {
  console.log('🔧 Dropping duplicate id indexes...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/duxsoup-etl';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB\n');

    const db = mongoose.connection.db;

    // Drop id_1 index from visits collection
    try {
      await db.collection('visits').dropIndex('id_1');
      console.log('✓ Dropped id_1 index from visits collection');
    } catch (error) {
      if (error.code === 27 || error.codeName === 'IndexNotFound') {
        console.log('⚠ id_1 index not found in visits (already dropped or never existed)');
      } else {
        throw error;
      }
    }

    // Drop id_1 index from scans collection
    try {
      await db.collection('scans').dropIndex('id_1');
      console.log('✓ Dropped id_1 index from scans collection');
    } catch (error) {
      if (error.code === 27 || error.codeName === 'IndexNotFound') {
        console.log('⚠ id_1 index not found in scans (already dropped or never existed)');
      } else {
        throw error;
      }
    }

    console.log('\n✅ Index migration complete!\n');

    // Show remaining indexes
    console.log('Current indexes on visits:');
    const visitIndexes = await db.collection('visits').indexes();
    visitIndexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    console.log('\nCurrent indexes on scans:');
    const scanIndexes = await db.collection('scans').indexes();
    scanIndexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    console.log('\nExpected indexes:');
    console.log('  - _id_1 (MongoDB default)');
    console.log('  - event_key_1 (unique, for idempotency)');
    console.log('  - Profile_1 (for lookups)');
    console.log('  - VisitTime_1 or ScanTime_1 (for time-based queries)');
    console.log('  - id_1 should NOT be present (removed by this script)\n');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error dropping indexes:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

dropIndexes();
