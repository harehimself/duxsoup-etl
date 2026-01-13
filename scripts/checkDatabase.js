const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const database = require('../src/utils/database');
const Person = require('../src/models/person');

async function checkDatabase() {
  await database.connect();

  const total = await Person.countDocuments({});
  console.log(`\nTotal people in database: ${total}\n`);

  if (total > 0) {
    // Sample 5 people to see their structure
    const samples = await Person.find({}).limit(5);

    console.log('Sample records:\n');
    samples.forEach((p, i) => {
      console.log(`${i + 1}. _id: ${p._id}`);
      console.log(`   Name: ${p.snapshot?.fullName || 'N/A'}`);
      console.log(`   Aliases: ${p.aliases?.map(a => `${a.type}:${a.value.substring(0, 30)}`).join(', ')}`);
      console.log('');
    });

    // Count by alias type
    const withSalesNav = await Person.countDocuments({ 'aliases.type': 'salesNavId' });
    const withProfileUrl = await Person.countDocuments({ 'aliases.type': 'profileUrl' });
    const withLinkedInUsername = await Person.countDocuments({ 'aliases.type': 'linkedInUsername' });

    console.log('Alias coverage:');
    console.log(`  salesNavId: ${withSalesNav} (${Math.round((withSalesNav/total)*100)}%)`);
    console.log(`  profileUrl: ${withProfileUrl} (${Math.round((withProfileUrl/total)*100)}%)`);
    console.log(`  linkedInUsername: ${withLinkedInUsername} (${Math.round((withLinkedInUsername/total)*100)}%)`);
  } else {
    console.log('Database is empty!');
  }

  await database.disconnect();
}

checkDatabase().catch(console.error);
