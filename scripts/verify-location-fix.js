#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');

async function verifyFix() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // Check the specific person from user's example
  const person = await Person.findById('ACwAAABE0YMB0WAofZciCEd0njPbFS-QC2vD7dU');
  
  console.log('Person: Jeff Dyson');
  console.log('Location fields:');
  console.log(`  location: "${person.snapshot.location}"`);
  console.log(`  city: "${person.snapshot.city}"`);
  console.log(`  state: "${person.snapshot.state}"`);
  console.log(`  stateCode: "${person.snapshot.stateCode}"`);
  console.log(`  country: "${person.snapshot.country}"`);
  console.log(`  countryCode: "${person.snapshot.countryCode}"`);
  console.log(`  locationType: "${person.snapshot.locationType}"`);
  
  // Check some other common problem locations
  console.log('\n\nChecking other problem locations:');
  
  const examples = await Person.aggregate([
    {
      $match: {
        'snapshot.location': {
          $in: [
            'New York City Metropolitan Area',
            'Greater Boston',
            'Charlotte Metro',
            'Washington DC-Baltimore Area'
          ]
        }
      }
    },
    {
      $project: {
        location: '$snapshot.location',
        city: '$snapshot.city',
        state: '$snapshot.state',
        country: '$snapshot.country'
      }
    },
    { $limit: 4 }
  ]);
  
  examples.forEach(ex => {
    console.log(`\n"${ex.location}"`);
    console.log(`  → city: ${ex.city}, state: ${ex.state}, country: ${ex.country}`);
  });
  
  await mongoose.disconnect();
}

verifyFix().catch(console.error);
