const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const database = require('../src/utils/database');
const Scan = require('../src/models/scan');
const Person = require('../src/models/person');

async function count() {
  await database.connect();

  console.log('\nAnalyzing unprocessed scans...\n');

  // Sample 1000 scans and check if they have Person records
  const scans = await Scan.find({}).limit(1000);

  let unprocessed = 0;
  let processed = 0;

  for (const scan of scans) {
    // Check if Person record exists with this scan in observations
    const person = await Person.findOne({
      'observations.scans': scan._id
    });

    if (person) {
      processed++;
    } else {
      unprocessed++;
    }
  }

  console.log('Sample of 1000 scans:');
  console.log(`  Processed (have Person): ${processed}`);
  console.log(`  Unprocessed (no Person): ${unprocessed}`);
  console.log(`  Unprocessed %: ${Math.round((unprocessed / 1000) * 100)}%`);

  const totalScans = await Scan.countDocuments({});
  const estimatedUnprocessed = Math.round((unprocessed / 1000) * totalScans);

  console.log(`\nEstimated total unprocessed scans: ${estimatedUnprocessed.toLocaleString()} out of ${totalScans.toLocaleString()}`);

  console.log('\n');

  await database.disconnect();
}

count().catch(console.error);
