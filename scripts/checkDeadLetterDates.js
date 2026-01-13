const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const database = require('../src/utils/database');
const DeadLetter = require('../src/models/deadLetter');

async function checkDeadLetterDates() {
  await database.connect();

  // Get date range of dead letters
  const oldest = await DeadLetter.findOne({}).sort({ createdAt: 1 });
  const newest = await DeadLetter.findOne({}).sort({ createdAt: -1 });

  console.log('\n========================================');
  console.log('DEAD LETTER DATE RANGE');
  console.log('========================================\n');

  if (oldest) {
    console.log('Oldest:', oldest.createdAt);
  }
  if (newest) {
    console.log('Newest:', newest.createdAt);
  }

  // Count by status
  const statuses = await DeadLetter.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  console.log('\nDead letters by status:');
  statuses.forEach(s => {
    console.log(`  ${s._id}: ${s.count}`);
  });

  console.log('\n========================================\n');

  await database.disconnect();
}

checkDeadLetterDates().catch(console.error);
