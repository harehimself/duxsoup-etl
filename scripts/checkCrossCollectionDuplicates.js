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

    // Get existing event_keys
    console.log('Loading existing event_keys...');
    const existingRecords = await Visit.find({ event_key: { $ne: null } })
      .select('event_key')
      .lean();
    const existingEventKeys = new Set(existingRecords.map(r => r.event_key));
    console.log(`Loaded ${existingEventKeys.size} existing event_keys\n`);

    // Check legacy records against existing
    console.log('Checking legacy records against existing event_keys...');
    const legacyRecords = await Visit.find({ event_key: null }).lean();
    console.log(`Analyzing ${legacyRecords.length} legacy records...\n`);

    const wouldBeDuplicates = [];
    legacyRecords.forEach(doc => {
      const eventKey = computeEventKey(doc);
      if (!eventKey) return;

      if (existingEventKeys.has(eventKey)) {
        wouldBeDuplicates.push({
          legacyId: doc._id.toString(),
          computedEventKey: eventKey,
          id: doc.id,
          time: doc.time || doc.VisitTime
        });
      }
    });

    console.log(`Found ${wouldBeDuplicates.length} legacy records that would conflict with existing event_keys`);
    console.log(`Conflict rate: ${((wouldBeDuplicates.length / legacyRecords.length) * 100).toFixed(2)}%\n`);

    if (wouldBeDuplicates.length > 0) {
      console.log('Sample conflicts (first 10):');
      console.log(JSON.stringify(wouldBeDuplicates.slice(0, 10), null, 2));
    } else {
      console.log('✅ All legacy records have unique event_keys!');
      console.log('✅ Safe to proceed with backfill - no duplicates will be created.');
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
