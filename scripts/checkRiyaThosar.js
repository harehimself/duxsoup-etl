const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const database = require('../src/utils/database');
const Person = require('../src/models/person');
const Scan = require('../src/models/scan');

async function checkRiyaThosar() {
  await database.connect();

  console.log('\n========================================');
  console.log('CHECKING RIYA THOSAR');
  console.log('========================================\n');

  // Check scan collection
  const scan = await Scan.findOne({
    Profile: "https://www.linkedin.com/in/riyathosar/"
  });

  console.log('Scan record:', scan ? 'FOUND' : 'NOT FOUND');
  if (scan) {
    console.log('  Scan ID:', scan._id);
    console.log('  DuxSoup ID:', scan.id);
    console.log('  Profile:', scan.Profile);
    console.log('  First Name:', scan['First Name']);
    console.log('  Last Name:', scan['Last Name']);
    console.log('  Scan Time:', scan.ScanTime);
  }

  console.log('');

  // Check if a Person record exists for this scan
  // Try multiple ways to find the person
  const byUsername = await Person.findOne({
    'aliases.value': 'riyathosar'
  });
  console.log('Person by username "riyathosar":', byUsername ? 'FOUND' : 'NOT FOUND');

  const byProfileUrl = await Person.findOne({
    'aliases.value': { $regex: 'riyathosar', $options: 'i' }
  });
  console.log('Person by profile URL pattern:', byProfileUrl ? 'FOUND' : 'NOT FOUND');

  const byObservationRef = scan ? await Person.findOne({
    'observations.scans': scan._id
  }) : null;
  console.log('Person with this scan reference:', byObservationRef ? 'FOUND' : 'NOT FOUND');

  if (byObservationRef) {
    console.log('\n  Person _id:', byObservationRef._id);
    console.log('  Name:', byObservationRef.snapshot?.fullName);
    console.log('  Aliases:', byObservationRef.aliases?.map(a => `${a.type}:${a.value}`).join(', '));
    console.log('  Scans count:', byObservationRef.observations?.scans?.length || 0);
  }

  console.log('\n========================================\n');

  await database.disconnect();
}

checkRiyaThosar().catch(console.error);
