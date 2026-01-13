#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');

async function checkUnparsedMetros() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // Find people with location but no state/country parsed
  const unparsed = await Person.aggregate([
    {
      $match: {
        'snapshot.location': { $exists: true, $ne: null, $ne: '' },
        $or: [
          { 'snapshot.country': null },
          { 'snapshot.state': null }
        ]
      }
    },
    {
      $group: {
        _id: '$snapshot.location',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 50 }
  ]);
  
  console.log('Top 50 unparsed locations:\n');
  unparsed.forEach(loc => {
    console.log(`${loc.count.toString().padStart(5)} - ${loc._id}`);
  });
  
  await mongoose.disconnect();
}

checkUnparsedMetros().catch(console.error);
