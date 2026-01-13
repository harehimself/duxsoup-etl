const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const database = require('../src/utils/database');
const DeadLetter = require('../src/models/deadLetter');
const Scan = require('../src/models/scan');

async function check() {
  await database.connect();

  // Get Riya's scan
  const scan = await Scan.findOne({ Profile: 'https://www.linkedin.com/in/riyathosar/' });

  console.log('\n========================================');
  console.log('RIYA THOSAR SCAN CHECK');
  console.log('========================================\n');

  if (scan) {
    console.log('Scan ID:', scan._id);
    console.log('DuxSoup ID:', scan.id);
    console.log('Scan Time:', scan.ScanTime);

    // Check if there's a dead letter for this scan
    const deadLetter = await DeadLetter.findOne({ observation_id: scan._id });
    console.log('Dead letter exists:', !!deadLetter);

    if (deadLetter) {
      console.log('Dead letter status:', deadLetter.status);
      console.log('Created at:', deadLetter.createdAt);
    }
  }

  console.log('\n========================================');
  console.log('REMAINING DEAD LETTERS');
  console.log('========================================\n');

  // Check total dead letters by status
  const pending = await DeadLetter.countDocuments({ status: 'pending' });
  const replayed = await DeadLetter.countDocuments({ status: 'replayed' });
  const failedAgain = await DeadLetter.countDocuments({ status: 'failed_again' });

  console.log('Pending:', pending);
  console.log('Replayed:', replayed);
  console.log('Failed again:', failedAgain);

  console.log('\n========================================\n');

  await database.disconnect();
}

check().catch(console.error);
