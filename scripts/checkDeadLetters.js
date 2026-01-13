const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const database = require('../src/utils/database');
const DeadLetter = require('../src/models/deadLetter');
const Scan = require('../src/models/scan');

async function checkDeadLetters() {
  await database.connect();

  console.log('\n========================================');
  console.log('CHECKING DEAD LETTERS');
  console.log('========================================\n');

  const totalDeadLetters = await DeadLetter.countDocuments({});
  console.log('Total dead letters:', totalDeadLetters);

  const scanDeadLetters = await DeadLetter.countDocuments({ sourceType: 'scan' });
  console.log('Scan-related dead letters:', scanDeadLetters);

  // Check if Riya Thosar's scan is in dead letters
  const riyaScan = await Scan.findOne({
    Profile: "https://www.linkedin.com/in/riyathosar/"
  });

  if (riyaScan) {
    const riyaDeadLetter = await DeadLetter.findOne({
      observation_id: riyaScan._id
    });

    console.log('\nRiya Thosar scan in dead letters:', riyaDeadLetter ? 'YES' : 'NO');

    if (riyaDeadLetter) {
      console.log('  Error:', riyaDeadLetter.error?.message);
      console.log('  Status:', riyaDeadLetter.status);
    }
  }

  // Sample some dead letters to see common errors
  if (totalDeadLetters > 0) {
    console.log('\n--- Sample Dead Letters ---\n');
    const samples = await DeadLetter.find({}).limit(5);
    samples.forEach((dl, i) => {
      console.log(`${i + 1}. Source: ${dl.sourceType}`);
      console.log(`   Error: ${dl.error?.message}`);
      console.log(`   Status: ${dl.status}`);
      console.log('');
    });
  }

  console.log('========================================\n');

  await database.disconnect();
}

checkDeadLetters().catch(console.error);
