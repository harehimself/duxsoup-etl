const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const database = require('../src/utils/database');
const Scan = require('../src/models/scan');
const Person = require('../src/models/person');

async function check() {
  await database.connect();

  console.log('\n========================================');
  console.log('CHECKING CSV PROFILES IN SCANS');
  console.log('========================================\n');

  // Check if CSV profiles exist in Scans
  const csvProfiles = [
    'https://www.linkedin.com/in/mahesh-chandra-wipro/',
    'https://www.linkedin.com/in/riyathosar/',
    'https://www.linkedin.com/in/markrapier/',
    'https://www.linkedin.com/in/nansasheriff/',
  ];

  for (const profileUrl of csvProfiles) {
    const scan = await Scan.findOne({ Profile: profileUrl });
    const person = await Person.findOne({ 'aliases.value': profileUrl.replace('https://', '').replace('http://', '') });

    console.log(`${profileUrl}`);
    console.log(`  In Scans: ${scan ? 'YES' : 'NO'}`);
    console.log(`  In People: ${person ? 'YES - ' + person._id : 'NO'}`);
    console.log('');
  }

  // Count total scans and people
  const totalScans = await Scan.countDocuments({});
  const totalPeople = await Person.countDocuments({});

  console.log('========================================');
  console.log(`Total Scans: ${totalScans}`);
  console.log(`Total People: ${totalPeople}`);
  console.log('========================================\n');

  await database.disconnect();
}

check().catch(console.error);
