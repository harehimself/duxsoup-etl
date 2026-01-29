#!/usr/bin/env node

const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config();
const Visit = require('../src/models/visit');

function computeEventKey(doc) {
  const userid = doc.userid || doc.rawData?.userid || 'no-user';
  const type = doc.rawData?.type || (doc.VisitTime ? 'visit' : 'scan');
  const time = doc.time || doc.VisitTime || doc.ScanTime || doc.createdAt;
  const id = doc.id;
  if (!id) return null;
  const components = [userid, type, time, id];
  const keyString = components.join('|');
  return crypto.createHash('sha1').update(keyString).digest('hex');
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('Connected to MongoDB\n');

    // Find legacy records without event_key
    const totalLegacy = await Visit.countDocuments({ event_key: null });
    console.log(`Total legacy records: ${totalLegacy}`);
    console.log('Analyzing first 5000 legacy records for duplicates...\n');

    const legacyRecords = await Visit.find({ event_key: null }).lean();

    // Compute event_keys and look for duplicates
    const eventKeyMap = new Map();
    const duplicates = [];

    legacyRecords.forEach(doc => {
      const eventKey = computeEventKey(doc);
      if (!eventKey) return;

      if (eventKeyMap.has(eventKey)) {
        duplicates.push({
          eventKey,
          first: eventKeyMap.get(eventKey),
          duplicate: doc._id.toString(),
          id: doc.id,
          time: doc.time || doc.VisitTime
        });
      } else {
        eventKeyMap.set(eventKey, doc._id.toString());
      }
    });

    console.log(`Found ${duplicates.length} potential duplicates among ${legacyRecords.length} legacy records`);
    console.log(`Duplicate rate: ${((duplicates.length / legacyRecords.length) * 100).toFixed(2)}%\n`);

    if (duplicates.length > 0) {
      console.log('Sample duplicates (first 10):');
      console.log(JSON.stringify(duplicates.slice(0, 10), null, 2));
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
