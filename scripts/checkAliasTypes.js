const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const database = require('../src/utils/database');
const Person = require('../src/models/person');

async function checkAliasTypes() {
  await database.connect();

  // Get all unique alias types
  const aliasTypes = await Person.aggregate([
    { $unwind: '$aliases' },
    { $group: { _id: '$aliases.type', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  console.log('\n========================================');
  console.log('ALIAS TYPES IN DATABASE');
  console.log('========================================\n');

  aliasTypes.forEach(type => {
    console.log(`${type._id}: ${type.count}`);
  });

  console.log('\n========================================\n');

  await database.disconnect();
}

checkAliasTypes().catch(console.error);
