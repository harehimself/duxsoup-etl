#!/usr/bin/env node

/**
 * Atlas Search Index Management Script
 *
 * Creates or updates Atlas Search indexes with static field mappings
 * to avoid the 300-field limit when using dynamic mapping.
 *
 * Problem: Dynamic mapping indexes ALL fields including:
 *   - snapshot._meta (Mixed type with ~35+ nested keys)
 *   - roles[] array (8 fields × N entries)
 *   - education[] array (5 fields × N entries)
 *   This causes: "Field limit exceeded: 309 > 300"
 *
 * Solution: Static mapping indexes only searchable fields (13 fields)
 *
 * Usage:
 *   # View current search indexes
 *   node scripts/createAtlasSearchIndex.js --list
 *
 *   # Output index definition for manual creation
 *   node scripts/createAtlasSearchIndex.js --output
 *
 *   # Create index via Atlas Admin API (requires ATLAS_* env vars)
 *   node scripts/createAtlasSearchIndex.js --create
 *
 * Environment variables (for --create):
 *   ATLAS_PROJECT_ID  - Atlas Project ID
 *   ATLAS_CLUSTER     - Cluster name (e.g., "Cluster0")
 *   ATLAS_PUBLIC_KEY  - Atlas API public key
 *   ATLAS_PRIVATE_KEY - Atlas API private key
 */

const mongoose = require('mongoose');
const https = require('https');
const logger = require('../src/utils/logger');
const indexDefinitions = require('./atlas-search-indexes.json');

const ATLAS_API_BASE = 'cloud.mongodb.com/api/atlas/v1.0';

/**
 * Extract the database name from a MongoDB connection URI.
 * Falls back to the value in atlas-search-indexes.json if parsing fails.
 */
function getDatabaseName(mongoUri, fallback) {
  if (!mongoUri) return fallback;
  try {
    const url = new URL(mongoUri);
    // pathname is "/<dbname>" or "/<dbname>?options"
    const dbName = url.pathname.split('/')[1];
    if (dbName) return dbName;
  } catch {
    // Non-standard URI format — try regex as fallback
    const match = mongoUri.match(/\/\/[^/]+\/([^?]+)/);
    if (match && match[1]) return match[1];
  }
  return fallback;
}

async function listSearchIndexes() {
  console.log('📋 Listing current search indexes...\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB_NAME || "duxsoup" });
  console.log('✓ Connected to MongoDB\n');

  const db = mongoose.connection.db;

  // List indexes on people collection
  const peopleCollection = db.collection('people');

  try {
    // Get regular indexes
    const indexes = await peopleCollection.indexes();
    console.log('Regular indexes on people collection:');
    indexes.forEach((idx) => {
      const keys = Object.keys(idx.key)
        .map((k) => `${k}: ${idx.key[k]}`)
        .join(', ');
      console.log(`  - ${idx.name}: { ${keys} }`);
    });

    // Note: Atlas Search indexes are managed separately via Atlas API
    console.log('\n⚠️  Atlas Search indexes cannot be listed via MongoDB driver.');
    console.log('   Use Atlas UI or mongocli to view search indexes.');
    console.log('\n   Atlas UI: https://cloud.mongodb.com/');
    console.log('   mongocli: mongocli atlas clusters search indexes list');
  } catch (error) {
    console.error('Error listing indexes:', error.message);
  }

  await mongoose.connection.close();
}

function outputIndexDefinition() {
  console.log('📄 Atlas Search Index Definition\n');
  console.log('Copy this JSON and paste it in Atlas UI > Search > Create Index > JSON Editor:\n');
  console.log('─'.repeat(70));

  const peopleIndex = indexDefinitions.indexes.find(
    (idx) => idx.collectionName === 'people'
  );

  if (peopleIndex) {
    console.log(JSON.stringify(peopleIndex.definition, null, 2));
  }

  console.log('─'.repeat(70));
  console.log('\nSteps to apply:');
  console.log('1. Go to Atlas UI > Database > Browse Collections > Search');
  console.log('2. Delete the failing "default" index on "people" collection');
  console.log('3. Click "Create Search Index"');
  console.log('4. Select "JSON Editor"');
  console.log('5. Paste the definition above');
  console.log('6. Index Name: "default"');
  console.log('7. Collection: "people"');
  console.log('8. Click "Create Search Index"');
  console.log('\nThe index will build in the background (usually < 5 minutes).\n');
}

async function createViaAtlasAPI() {
  const { ATLAS_PROJECT_ID, ATLAS_CLUSTER, ATLAS_PUBLIC_KEY, ATLAS_PRIVATE_KEY } =
    process.env;

  if (!ATLAS_PROJECT_ID || !ATLAS_CLUSTER || !ATLAS_PUBLIC_KEY || !ATLAS_PRIVATE_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('   ATLAS_PROJECT_ID, ATLAS_CLUSTER, ATLAS_PUBLIC_KEY, ATLAS_PRIVATE_KEY');
    console.error('\nUse --output to get the index definition for manual creation.');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI;

  const peopleIndex = indexDefinitions.indexes.find(
    (idx) => idx.collectionName === 'people'
  );

  const database = getDatabaseName(mongoUri, peopleIndex.database);
  console.log(`🚀 Creating Atlas Search index via API (database: ${database})...\n`);

  const requestBody = JSON.stringify({
    collectionName: peopleIndex.collectionName,
    database,
    name: peopleIndex.name,
    mappings: peopleIndex.definition.mappings,
  });

  const auth = Buffer.from(`${ATLAS_PUBLIC_KEY}:${ATLAS_PRIVATE_KEY}`).toString('base64');

  const options = {
    hostname: ATLAS_API_BASE.split('/')[0],
    path: `/api/atlas/v1.0/groups/${ATLAS_PROJECT_ID}/clusters/${ATLAS_CLUSTER}/fts/indexes`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': requestBody.length,
      Authorization: `Basic ${auth}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('✅ Search index created successfully!');
          console.log('   Index will build in the background.\n');
          resolve(JSON.parse(data));
        } else {
          console.error(`❌ API Error (${res.statusCode}):`, data);
          reject(new Error(data));
        }
      });
    });

    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list') || args.includes('-l')) {
    await listSearchIndexes();
  } else if (args.includes('--output') || args.includes('-o')) {
    outputIndexDefinition();
  } else if (args.includes('--create') || args.includes('-c')) {
    await createViaAtlasAPI();
  } else {
    console.log('Atlas Search Index Management\n');
    console.log('Usage:');
    console.log('  --list, -l     List current indexes (regular only)');
    console.log('  --output, -o   Output index definition for manual creation');
    console.log('  --create, -c   Create index via Atlas Admin API\n');
    console.log('Recommended: Use --output and apply via Atlas UI\n');

    // Default to output
    outputIndexDefinition();
  }
}

// Only run when executed directly (not when required for testing)
if (require.main === module) {
  main().catch((error) => {
    logger.error('Script failed', { error: error.message });
    console.error('Error:', error.message);
    process.exit(1);
  });
}

module.exports = { getDatabaseName };
