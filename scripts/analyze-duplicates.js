const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../src/utils/database');
const Person = require('../src/models/person');

async function analyzeDuplicates() {
  await database.connect();

  console.log('Analyzing potential duplicate persons...\n');

  // Find all people with firstName + lastName
  const people = await Person.find(
    {
      'snapshot.firstName': { $exists: true, $ne: null, $ne: '' },
      'snapshot.lastName': { $exists: true, $ne: null, $ne: '' }
    },
    {
      _id: 1,
      canonical_id: 1,
      'snapshot.firstName': 1,
      'snapshot.lastName': 1,
      'snapshot.fullName': 1,
      aliases: 1
    }
  ).lean();

  console.log(`Total people with names: ${people.length}`);

  // Group by full name
  const nameGroups = {};
  for (const person of people) {
    const fullName = person.snapshot?.fullName?.toLowerCase().trim();
    if (!fullName) continue;

    if (!nameGroups[fullName]) {
      nameGroups[fullName] = [];
    }
    nameGroups[fullName].push(person);
  }

  // Find duplicates
  const duplicates = Object.entries(nameGroups).filter(([name, records]) => records.length > 1);

  console.log(`\nPeople with duplicate names: ${duplicates.length}`);

  let totalDuplicateRecords = 0;
  for (const [name, records] of duplicates) {
    totalDuplicateRecords += records.length;
  }
  console.log(`Total duplicate records: ${totalDuplicateRecords}\n`);

  // Analyze first 10 duplicates
  console.log('Sample duplicates (first 10):\n');
  duplicates.slice(0, 10).forEach(([name, records], idx) => {
    console.log(`${idx + 1}. ${name} (${records.length} records)`);
    records.forEach(rec => {
      const idTypes = rec.aliases.map(a => a.type).join(', ');
      const idPreview = rec._id.length > 20 ? rec._id.substring(0, 20) + '...' : rec._id;
      console.log(`   - ID: ${idPreview} | Aliases: ${idTypes}`);
    });
    console.log('');
  });

  // Check for Sales Nav vs Username split
  let salesNavOnly = 0;
  let usernameOnly = 0;
  let both = 0;

  duplicates.forEach(([name, records]) => {
    records.forEach(rec => {
      const hasSalesNav = rec.aliases.some(a => a.type === 'salesNavId');
      const hasUsername = rec.aliases.some(a => a.type === 'linkedInUsername');

      if (hasSalesNav && hasUsername) both++;
      else if (hasSalesNav) salesNavOnly++;
      else if (hasUsername) usernameOnly++;
    });
  });

  console.log('\nDuplicate identity breakdown:');
  console.log(`  - Sales Nav ID only: ${salesNavOnly}`);
  console.log(`  - LinkedIn username only: ${usernameOnly}`);
  console.log(`  - Both identifiers: ${both}`);

  await database.disconnect();
}

analyzeDuplicates().catch(console.error);
