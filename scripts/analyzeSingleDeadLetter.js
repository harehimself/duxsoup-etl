const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const database = require('../src/utils/database');
const DeadLetter = require('../src/models/deadLetter');
const Scan = require('../src/models/scan');
const Visit = require('../src/models/visit');

async function analyzeSingleDeadLetter() {
  await database.connect();

  // Get one scan-based dead letter
  const scanDeadLetter = await DeadLetter.findOne({ sourceType: 'scan' });

  if (scanDeadLetter) {
    console.log('\n========================================');
    console.log('SCAN DEAD LETTER ANALYSIS');
    console.log('========================================\n');

    console.log('Dead Letter ID:', scanDeadLetter._id);
    console.log('Observation ID:', scanDeadLetter.observation_id);
    console.log('Error:', scanDeadLetter.error?.message);
    console.log('Created:', scanDeadLetter.createdAt);

    // Get the actual scan
    const scan = await Scan.findById(scanDeadLetter.observation_id);
    if (scan) {
      console.log('\nOriginal Scan Data:');
      console.log('  DuxSoup ID:', scan.id);
      console.log('  Profile:', scan.Profile);
      console.log('  First Name:', scan['First Name']);
      console.log('  Last Name:', scan['Last Name']);
      console.log('  Scan Time:', scan.ScanTime);

      console.log('\nIdentity Hints from Dead Letter:');
      console.log('  person_id:', scanDeadLetter.identity_hints?.person_id);
      console.log('  source:', scanDeadLetter.identity_hints?.source);
      console.log('  sales_nav_id:', scanDeadLetter.identity_hints?.sales_nav_id);
      console.log('  numeric_id:', scanDeadLetter.identity_hints?.numeric_id);
      console.log('  profile_url:', scanDeadLetter.identity_hints?.profile_url);

      // Try to extract identifiers using identityMatcher
      const identityMatcher = require('../src/utils/identityMatcher');
      const identifiers = identityMatcher.extractIdentifiers({
        Profile: scan.Profile,
        SalesProfile: scan.SalesProfile,
        PublicProfile: scan.PublicProfile,
        RecruiterProfile: scan.RecruiterProfile,
        id: scan.id,
      });

      console.log('\nExtracted Identifiers:');
      console.log(JSON.stringify(identifiers, null, 2));
    }
  }

  console.log('\n========================================\n');

  await database.disconnect();
}

analyzeSingleDeadLetter().catch(console.error);
