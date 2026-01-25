#!/usr/bin/env node

const mongoose = require('mongoose');
const Visit = require('../src/models/visit');
const Person = require('../src/models/person');

async function investigate() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('INVESTIGATING ORPHANED VISIT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const visitId = '67e145f836b76ab28218fd30';
  const visit = await Visit.findById(visitId).lean();

  if (visit) {
    console.log('Visit details:');
    console.log('  ID:', visit._id);
    console.log('  Profile:', visit.Profile);
    console.log('  Sales Nav ID:', visit.SalesNavId || 'N/A');
    console.log('  DuxSoup ID:', visit.id || 'N/A');
    console.log('  Created:', visit.createdAt);
    console.log('');
  } else {
    console.log('Visit not found!\n');
    await mongoose.disconnect();
    return;
  }

  const personId = 'ACoAAANOuMAB4T9MdLec6tmFBdLkRvwzVsjwVcE';
  console.log(`Checking if person ${personId} exists...`);

  const person = await Person.findById(personId).lean();

  if (person) {
    console.log('✓ Person FOUND');
    console.log('  Name:', person.snapshot?.fullName || 'Unknown');
    console.log('  Aliases:', person.aliases?.length || 0);
  } else {
    console.log('✗ Person NOT FOUND in database');
    console.log('');

    // Check if there's a person with this as an alias
    console.log('Checking if this ID exists as an alias...');
    const personWithAlias = await Person.findOne({
      'aliases.value': personId
    }).lean();

    if (personWithAlias) {
      console.log('✓ Found person with this Sales Nav ID as alias:');
      console.log('  Person ID:', personWithAlias._id);
      console.log('  Name:', personWithAlias.snapshot?.fullName || 'Unknown');
      console.log('  Canonical ID:', personWithAlias.canonical_id);
      console.log('  Aliases:');
      personWithAlias.aliases?.forEach(alias => {
        const marker = alias.value === personId ? ' ← MATCH' : '';
        console.log(`    - ${alias.type}: ${alias.value}${marker}`);
      });
      console.log('');
      console.log('→ The visit should reference person:', personWithAlias._id);
    } else {
      console.log('✗ No person found with this ID as alias either');
      console.log('');
      console.log('This suggests the person record was never created or was deleted.');
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await mongoose.disconnect();
}

investigate().catch(console.error);
