const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const database = require('../src/utils/database');
const Person = require('../src/models/person');
const identityMatcher = require('../src/utils/identityMatcher');

async function testMatching() {
  await database.connect();

  // Test case: Riya Thosar from CSV
  const csvRow = {
    Profile: 'https://www.linkedin.com/in/riyathosar/',
    SalesProfile: 'https://www.linkedin.com/sales/people/ACoAAACU3sMBTjIb1jDvcDxI0oTFkKSTULI5V00,name,fjDE',
    PublicProfile: '',
    RecruiterProfile: '',
    id: 'id.9756355',
  };

  console.log('\n========================================');
  console.log('TESTING CSV MATCHING FOR RIYA THOSAR');
  console.log('========================================\n');

  // Extract identifiers
  const identifiers = identityMatcher.extractIdentifiers(csvRow);
  console.log('Extracted identifiers:');
  console.log(JSON.stringify(identifiers, null, 2));

  // Try to find by each identifier type
  console.log('\nSearching for Person records:\n');

  if (identifiers.linkedInUsername) {
    const person = await Person.findOne({
      'aliases.type': 'linkedInUsername',
      'aliases.value': identifiers.linkedInUsername,
    });
    console.log(`LinkedIn Username (${identifiers.linkedInUsername}):`, person ? 'FOUND - ' + person._id : 'NOT FOUND');
  }

  if (identifiers.salesNavId) {
    const person = await Person.findOne({
      'aliases.type': 'salesNavId',
      'aliases.value': identifiers.salesNavId,
    });
    console.log(`Sales Nav ID (${identifiers.salesNavId}):`, person ? 'FOUND - ' + person._id : 'NOT FOUND');
  }

  if (identifiers.profileUrl) {
    const person = await Person.findOne({
      'aliases.type': 'profileUrl',
      'aliases.value': identifiers.profileUrl,
    });
    console.log(`Profile URL (${identifiers.profileUrl}):`, person ? 'FOUND - ' + person._id : 'NOT FOUND');
  }

  // Try broader search
  console.log('\n--- Broader searches ---\n');

  const byAnyAlias = await Person.findOne({
    'aliases.value': { $in: Object.values(identifiers).filter(v => v) }
  });
  console.log('By any alias value:', byAnyAlias ? 'FOUND - ' + byAnyAlias._id : 'NOT FOUND');

  // Check a sample of CSV Sales Nav IDs against DB
  console.log('\n========================================');
  console.log('CHECKING SALES NAV ID COVERAGE');
  console.log('========================================\n');

  const sampleSalesNavIds = [
    'ACoAAAOp_GgBB5xIe1UsUcokRenyVryVDfOYAfI', // Mahesh Chandra
    'ACoAAACU3sMBTjIb1jDvcDxI0oTFkKSTULI5V00', // Riya Thosar
    'ACoAAABEeJcBd-GeOVyWm0BEm_MMXBJron_Xh6E', // Mark Rapier
  ];

  for (const salesNavId of sampleSalesNavIds) {
    const person = await Person.findOne({
      'aliases.value': salesNavId
    });
    console.log(`${salesNavId.substring(0, 20)}...:`, person ? 'FOUND' : 'NOT FOUND');
  }

  console.log('\n========================================\n');

  await database.disconnect();
}

testMatching().catch(console.error);
